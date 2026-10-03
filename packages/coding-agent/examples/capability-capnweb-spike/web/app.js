import { newWebSocketRpcSession, RpcTarget } from "/vendor/capnweb.js";

const protocolVersion = 1;
const notifyBinding = { id: "pi.notify", version: 1 };
const clientId = sessionStorage.getItem("pi-capnweb-client") ?? `web-${crypto.randomUUID()}`;
sessionStorage.setItem("pi-capnweb-client", clientId);

const connection = document.querySelector(".connection");
const connectionLabel = document.querySelector("#connection-label");
const transcript = document.querySelector("#transcript");
const emptyState = document.querySelector("#empty-state");
const form = document.querySelector("#prompt-form");
const prompt = document.querySelector("#prompt");
const send = document.querySelector("#send");
const testNotify = document.querySelector("#test-notify");
const notification = document.querySelector("#notification");

let connected = false;
let busy = false;
let assistantContent;
let notificationTimer;

function setConnection(state, label) {
	connection.dataset.state = state;
	connectionLabel.textContent = label;
	connected = state === "connected";
	send.disabled = !connected || busy;
	testNotify.disabled = !connected || busy;
}

function appendMessage(role, text, className = role.toLowerCase()) {
	emptyState?.remove();
	const message = document.createElement("article");
	message.className = `message ${className}`;
	const label = document.createElement("p");
	label.className = "role";
	label.textContent = role;
	const content = document.createElement("p");
	content.className = "content";
	content.textContent = text;
	message.append(label, content);
	transcript.append(message);
	transcript.scrollTop = transcript.scrollHeight;
	return content;
}

function showNotification(message) {
	clearTimeout(notificationTimer);
	notification.hidden = false;
	notification.textContent = message;
	notification.classList.remove("is-flying");
	void notification.offsetWidth;
	notification.classList.add("is-flying");
	notificationTimer = setTimeout(() => {
		notification.hidden = true;
		notification.classList.remove("is-flying");
	}, 2400);
}

function handleEvent(event) {
	switch (event.type) {
		case "ready":
			setConnection("connected", "Binding online");
			break;
		case "user_prompt":
			appendMessage(event.clientId === clientId ? "You" : "Peer", event.text, "user");
			break;
		case "assistant_start":
			assistantContent = undefined;
			break;
		case "assistant_delta":
			if (!assistantContent) assistantContent = appendMessage("Pi", "", "assistant");
			assistantContent.textContent += event.text;
			transcript.scrollTop = transcript.scrollHeight;
			break;
		case "assistant_end":
			assistantContent = undefined;
			break;
		case "tool_start":
			appendMessage("Tool", event.name, "tool");
			break;
		case "error":
			appendMessage("Error", event.message, "error");
			break;
	}
}

class BrowserClientBindings extends RpcTarget {
	async event(event) {
		handleEvent(event);
	}

	async notify(input) {
		if (typeof input?.message !== "string" || input.message.length === 0) {
			throw new Error("Invalid notify input");
		}
		showNotification(input.message);
		return { displayed: true };
	}
}

async function awaitRpc(call) {
	try {
		return await call;
	} finally {
		call[Symbol.dispose]();
	}
}

const rpcUrl = new URL("/api/rpc", window.location.href);
rpcUrl.protocol = rpcUrl.protocol === "https:" ? "wss:" : "ws:";
const server = newWebSocketRpcSession(rpcUrl.toString(), new BrowserClientBindings(), {
	limits: { maxMessageSize: 64 * 1024 },
});
server.onRpcBroken((error) => {
	setConnection("error", "Disconnected");
	appendMessage("Error", error instanceof Error ? error.message : String(error), "error");
});

try {
	await awaitRpc(
		server.connect({
			clientId,
			protocolVersion,
			bindings: [notifyBinding],
		}),
	);
} catch (error) {
	setConnection("error", error instanceof Error ? error.message : String(error));
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	const text = prompt.value.trim();
	if (!text || busy) return;
	busy = true;
	setConnection("connected", "Pi is working");
	prompt.value = "";
	try {
		await awaitRpc(server.prompt(text));
	} catch (error) {
		appendMessage("Error", error instanceof Error ? error.message : String(error), "error");
	} finally {
		busy = false;
		setConnection("connected", "Binding online");
		prompt.focus();
	}
});

prompt.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		form.requestSubmit();
	}
});

testNotify.addEventListener("click", async () => {
	if (busy) return;
	busy = true;
	setConnection("connected", "Invoking binding");
	try {
		await awaitRpc(server.command("notify", { message: "Browser binding confirmed." }));
	} catch (error) {
		appendMessage("Error", error instanceof Error ? error.message : String(error), "error");
	} finally {
		busy = false;
		setConnection("connected", "Binding online");
	}
});

window.addEventListener("beforeunload", () => server[Symbol.dispose]());

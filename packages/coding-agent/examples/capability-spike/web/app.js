const notifyAction = { id: "pi.notify", version: 1 };
const clientId = sessionStorage.getItem("pi-capability-client") ?? `web-${crypto.randomUUID()}`;
sessionStorage.setItem("pi-capability-client", clientId);

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

async function api(path, options) {
	const response = await fetch(path, {
		...options,
		headers: { "content-type": "application/json", ...options?.headers },
	});
	const body = await response.json();
	if (!response.ok || body.ok === false) throw new Error(body.error ?? `Request failed with ${response.status}`);
	return body;
}

async function registerCapabilities() {
	await api(`/api/clients/${encodeURIComponent(clientId)}/capabilities`, {
		method: "PUT",
		body: JSON.stringify({ actions: [notifyAction] }),
	});
	setConnection("connected", "Capability online");
}

async function answerAction(event) {
	if (event.action.id !== notifyAction.id || event.action.version !== notifyAction.version) {
		await postActionResult(event.requestId, { clientId, ok: false, error: "Unsupported action" });
		return;
	}
	const message = event.input?.message;
	if (typeof message !== "string" || !message) {
		await postActionResult(event.requestId, { clientId, ok: false, error: "Invalid notify input" });
		return;
	}
	showNotification(message);
	await postActionResult(event.requestId, { clientId, ok: true, result: { displayed: true } });
}

async function postActionResult(requestId, result) {
	await api(`/api/action-results/${encodeURIComponent(requestId)}`, {
		method: "POST",
		body: JSON.stringify(result),
	});
}

function handleEvent(event) {
	switch (event.type) {
		case "ready":
			void registerCapabilities().catch((error) => setConnection("error", error.message));
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
		case "action_request":
			void answerAction(event).catch((error) => appendMessage("Error", error.message, "error"));
			break;
	}
}

const events = new EventSource(`/api/events?clientId=${encodeURIComponent(clientId)}`);
events.onmessage = ({ data }) => handleEvent(JSON.parse(data));
events.onerror = () => setConnection("error", "Reconnecting");

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	const text = prompt.value.trim();
	if (!text || busy) return;
	busy = true;
	setConnection("connected", "Pi is working");
	prompt.value = "";
	try {
		await api("/api/prompt", {
			method: "POST",
			body: JSON.stringify({ clientId, text }),
		});
	} catch (error) {
		appendMessage("Error", error instanceof Error ? error.message : String(error), "error");
	} finally {
		busy = false;
		setConnection("connected", "Capability online");
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
	setConnection("connected", "Invoking directly");
	try {
		await api("/api/commands/notify", {
			method: "POST",
			body: JSON.stringify({ clientId, message: "Browser capability confirmed." }),
		});
	} catch (error) {
		appendMessage("Error", error instanceof Error ? error.message : String(error), "error");
	} finally {
		busy = false;
		setConnection("connected", "Capability online");
	}
});

window.addEventListener("beforeunload", () => events.close());

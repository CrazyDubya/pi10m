import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { newWebSocketRpcSession, type RpcPromise, RpcTarget } from "capnweb";
import { Value } from "typebox/value";
import {
	type ClientBindingApi,
	type NotifyInput,
	type NotifyOutput,
	notifyBinding,
	protocolVersion,
	type ServerApi,
	type ServerEvent,
} from "./protocol.ts";

const baseUrl = process.env.PI_CAPNWEB_SPIKE_URL ?? "http://127.0.0.1:8788";
const rpcUrl = new URL("/api/rpc", baseUrl);
rpcUrl.protocol = rpcUrl.protocol === "https:" ? "wss:" : "ws:";
const clientId = `tui-${randomUUID()}`;

const readline = createInterface({ input: process.stdin, output: process.stdout, prompt: "\x1b[1mYou ›\x1b[0m " });
let assistantLineOpen = false;
let busy = false;
let runActive = false;

function printLine(text: string): void {
	if (assistantLineOpen) {
		process.stdout.write("\n");
		assistantLineOpen = false;
	}
	process.stdout.write(`\r\x1b[2K${text}\n`);
}

function restorePromptIfIdle(): void {
	if (!runActive && !busy) readline.prompt(true);
}

function handleEvent(event: ServerEvent): void {
	switch (event.type) {
		case "run_start":
			runActive = true;
			process.stdout.write("\r\x1b[2K");
			break;
		case "run_end":
			runActive = false;
			restorePromptIfIdle();
			break;
		case "assistant_start":
			if (assistantLineOpen) process.stdout.write("\n");
			process.stdout.write("\r\x1b[2K\x1b[36mPi  ›\x1b[0m ");
			assistantLineOpen = true;
			break;
		case "assistant_delta":
			process.stdout.write(event.text);
			break;
		case "assistant_end":
			if (assistantLineOpen) process.stdout.write("\n");
			assistantLineOpen = false;
			break;
		case "tool_start":
			printLine(`\x1b[2m[tool: ${event.name}]\x1b[0m`);
			break;
		case "tool_end":
			break;
		case "error":
			printLine(`\x1b[31m${event.message}\x1b[0m`);
			restorePromptIfIdle();
			break;
		default:
			break;
	}
}

class TuiClientBindings extends RpcTarget implements ClientBindingApi {
	async event(event: ServerEvent): Promise<void> {
		handleEvent(event);
	}

	async notify(input: NotifyInput): Promise<NotifyOutput> {
		if (!Value.Check(notifyBinding.input, input)) throw new Error("Invalid notify input");
		printLine(`\x1b[33m${input.message}\x1b[0m`);
		restorePromptIfIdle();
		return { displayed: true };
	}
}

async function awaitRpc(call: RpcPromise<void>): Promise<void> {
	try {
		await call;
	} finally {
		call[Symbol.dispose]();
	}
}

const server = newWebSocketRpcSession<ServerApi>(rpcUrl.toString(), new TuiClientBindings(), {
	limits: { maxMessageSize: 64 * 1024 },
});
server.onRpcBroken((error: unknown) => {
	printLine(`\x1b[31mRPC connection closed: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
});
await awaitRpc(
	server.connect({
		clientId,
		protocolVersion,
		bindings: [{ id: notifyBinding.id, version: notifyBinding.version }],
	}),
);

console.log(`\x1b[2mConnected as ${clientId}. Use /notify <message> to invoke the binding without the LLM.\x1b[0m`);
readline.prompt();

readline.on("line", (line) => {
	const text = line.trim();
	if (!text) {
		readline.prompt();
		return;
	}
	if (busy) {
		printLine("\x1b[33mThe shared session is busy.\x1b[0m");
		return;
	}
	busy = true;
	const operation = text.startsWith("/notify ")
		? server.command("notify", { message: text.slice("/notify ".length) })
		: server.prompt(text);
	void awaitRpc(operation)
		.catch((error: unknown) => printLine(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`))
		.finally(() => {
			busy = false;
			restorePromptIfIdle();
		});
});

readline.once("close", () => {
	server[Symbol.dispose]();
	process.stdout.write("\n");
});

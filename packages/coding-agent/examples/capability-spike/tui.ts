import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { ActionResultMessage, ServerEvent } from "./protocol.ts";
import { notifyAction } from "./protocol.ts";

const baseUrl = process.env.PI_SPIKE_URL ?? "http://127.0.0.1:8787";
const clientId = `tui-${randomUUID()}`;
const eventsAbort = new AbortController();

interface JsonResponse {
	ok?: boolean;
	error?: string;
}

async function request(path: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(`${baseUrl}${path}`, {
		...init,
		headers: { "content-type": "application/json", ...init.headers },
	});
	const body = (await response.json()) as JsonResponse;
	if (!response.ok || body.ok === false) throw new Error(body.error ?? `Request failed with ${response.status}`);
	return body;
}

function isServerEvent(value: unknown): value is ServerEvent {
	return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

const eventResponse = await fetch(`${baseUrl}/api/events?clientId=${encodeURIComponent(clientId)}`, {
	headers: { accept: "text/event-stream" },
	signal: eventsAbort.signal,
});
if (!eventResponse.ok || !eventResponse.body) {
	throw new Error(`Could not connect to ${baseUrl}: ${eventResponse.status} ${eventResponse.statusText}`);
}

await request(`/api/clients/${encodeURIComponent(clientId)}/capabilities`, {
	method: "PUT",
	body: JSON.stringify({ actions: [{ id: notifyAction.id, version: notifyAction.version }] }),
});

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

async function answerAction(event: Extract<ServerEvent, { type: "action_request" }>): Promise<void> {
	if (event.action.id !== notifyAction.id || event.action.version !== notifyAction.version) {
		await postActionResult(event.requestId, { clientId, ok: false, error: "Unsupported action" });
		return;
	}
	const input = typeof event.input === "object" && event.input !== null ? event.input : undefined;
	const message = input && "message" in input && typeof input.message === "string" ? input.message : undefined;
	if (!message) {
		await postActionResult(event.requestId, { clientId, ok: false, error: "Invalid notify input" });
		return;
	}
	printLine(`\x1b[33m${message}\x1b[0m`);
	await postActionResult(event.requestId, { clientId, ok: true, result: { displayed: true } });
	restorePromptIfIdle();
}

async function postActionResult(requestId: string, result: ActionResultMessage): Promise<void> {
	await request(`/api/action-results/${encodeURIComponent(requestId)}`, {
		method: "POST",
		body: JSON.stringify(result),
	});
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
		case "action_request":
			void answerAction(event).catch((error: unknown) => printLine(`\x1b[31m${String(error)}\x1b[0m`));
			break;
		default:
			break;
	}
}

async function consumeEvents(): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of eventResponse.body!) {
		buffer += decoder.decode(chunk, { stream: true });
		let boundary = buffer.indexOf("\n\n");
		while (boundary !== -1) {
			const frame = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			for (const line of frame.split("\n")) {
				if (!line.startsWith("data: ")) continue;
				const parsed: unknown = JSON.parse(line.slice(6));
				if (isServerEvent(parsed)) handleEvent(parsed);
			}
			boundary = buffer.indexOf("\n\n");
		}
	}
}

void consumeEvents().catch((error: unknown) => {
	if (!eventsAbort.signal.aborted) {
		printLine(`\x1b[31mEvent stream closed: ${String(error)}\x1b[0m`);
		runActive = false;
		restorePromptIfIdle();
	}
});

console.log(`\x1b[2mConnected as ${clientId}. Use /notify <message> to invoke the capability without the LLM.\x1b[0m`);
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
		? request("/api/commands/notify", {
				method: "POST",
				body: JSON.stringify({ clientId, message: text.slice("/notify ".length) }),
			})
		: request("/api/prompt", {
				method: "POST",
				body: JSON.stringify({ clientId, text }),
			});
	void operation
		.catch((error: unknown) => printLine(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`))
		.finally(() => {
			busy = false;
			restorePromptIfIdle();
		});
});

readline.once("close", () => {
	eventsAbort.abort();
	process.stdout.write("\n");
});

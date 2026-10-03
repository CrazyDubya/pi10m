import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AgentHarness,
	type AgentHarnessEvent,
	type AgentHarnessTool,
	InMemorySessionStorage,
	Session,
} from "@earendil-works/pi-agent-core";
import { createModels, type Model } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { CapabilityError, CapabilityRegistry } from "./capability-registry.ts";
import {
	type MessageEndHandler,
	type NotifyExtensionContext,
	notifyExtension,
	type ServerCommand,
	type ServerExtensionApi,
} from "./extension.ts";
import type { ActionRegistration, ActionResultMessage, ServerEvent } from "./protocol.ts";

const host = process.env.PI_SPIKE_HOST ?? "127.0.0.1";
const port = Number(process.env.PI_SPIKE_PORT ?? "8787");
const modelSpec = process.env.PI_SPIKE_MODEL ?? "openai/gpt-5.4-nano";
const [providerId, modelId] = modelSpec.split("/", 2);
if (!providerId || !modelId) {
	throw new Error(`PI_SPIKE_MODEL must use provider/model syntax, received ${modelSpec}`);
}

const models = createModels();
models.setProvider(openaiProvider());
models.setProvider(anthropicProvider());
function createFallbackModel(provider: string, id: string): Model<"openai-responses" | "anthropic-messages"> {
	const common = {
		id,
		name: id,
		reasoning: false,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	};
	if (provider === "openai") {
		return {
			...common,
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			input: ["text"],
		};
	}
	if (provider === "anthropic") {
		return {
			...common,
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			input: ["text"],
		};
	}
	throw new Error(`Unsupported provider ${provider}. This spike registers openai and anthropic.`);
}
const model = models.getModel(providerId, modelId) ?? createFallbackModel(providerId, modelId);

const registry = new CapabilityRegistry();
const tools: AgentHarnessTool<NotifyExtensionContext>[] = [];
const commands = new Map<string, ServerCommand>();
const messageEndHandlers: MessageEndHandler[] = [];
const extensionApi: ServerExtensionApi = {
	registerTool(tool) {
		tools.push(tool);
	},
	registerCommand(name, command) {
		commands.set(name, command);
	},
	on(type, handler) {
		if (type === "message_end") messageEndHandlers.push(handler);
	},
};
notifyExtension(extensionApi);

let activeOriginClientId: string | undefined;
let promptInFlight = false;

function contextFor(clientId: string): NotifyExtensionContext {
	return {
		clientActions: {
			invoke: (action, input, options) => registry.invoke(clientId, action, input, options),
		},
	};
}

const harness = new AgentHarness({
	session: new Session(new InMemorySessionStorage()),
	models,
	model,
	thinkingLevel: "off",
	tools,
	toolContext: () => {
		if (!activeOriginClientId) throw new Error("No originating client is bound to this turn");
		return contextFor(activeOriginClientId);
	},
	systemPrompt: [
		"You are a concise assistant.",
		"When asked for the capital of France, respond with exactly Paris and nothing else.",
		"When the user asks for a notification, call the notify tool with the exact message they want shown.",
	].join(" "),
});

harness.subscribe(async (event, signal) => {
	for (const wireEvent of toServerEvents(event)) registry.broadcast(wireEvent);
	if (event.type === "message_end" && messageEndHandlers.length > 0) {
		if (!activeOriginClientId) throw new Error("No originating client is bound to this assistant response");
		const context = contextFor(activeOriginClientId);
		for (const handler of messageEndHandlers) await handler(event, context, signal);
	}
});

function toServerEvents(event: AgentHarnessEvent): ServerEvent[] {
	switch (event.type) {
		case "agent_start":
			return [{ type: "run_start" }];
		case "agent_end":
			return [{ type: "run_end" }];
		case "message_start":
			return event.message.role === "assistant" ? [{ type: "assistant_start" }] : [];
		case "message_update":
			return event.assistantMessageEvent.type === "text_delta"
				? [{ type: "assistant_delta", text: event.assistantMessageEvent.delta }]
				: [];
		case "message_end":
			if (event.message.role !== "assistant") return [];
			return [
				{ type: "assistant_end" },
				...(event.message.errorMessage ? [{ type: "error" as const, message: event.message.errorMessage }] : []),
			];
		case "tool_execution_start":
			return [{ type: "tool_start", name: event.toolName }];
		case "tool_execution_end":
			return [{ type: "tool_end", name: event.toolName, isError: event.isError }];
		default:
			return [];
	}
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 64 * 1024) throw new Error("Request body exceeds 64 KiB");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function requireClientId(value: unknown): string {
	if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) {
		throw new Error("Invalid clientId");
	}
	return value;
}

function parseActions(value: unknown): ActionRegistration[] {
	if (!Array.isArray(value)) throw new Error("actions must be an array");
	return value.map((candidate) => {
		const action = objectRecord(candidate);
		if (!action || typeof action.id !== "string" || typeof action.version !== "number") {
			throw new Error("Invalid action registration");
		}
		return { id: action.id, version: action.version };
	});
}

function errorStatus(error: unknown): number {
	if (!(error instanceof CapabilityError)) return 400;
	return error.code === "client_unavailable" || error.code === "action_unavailable" ? 409 : 400;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "web");
const staticFiles = new Map([
	["/", { path: join(webRoot, "index.html"), type: "text/html; charset=utf-8" }],
	["/app.js", { path: join(webRoot, "app.js"), type: "text/javascript; charset=utf-8" }],
	["/styles.css", { path: join(webRoot, "styles.css"), type: "text/css; charset=utf-8" }],
]);

const server = createServer(async (request, response) => {
	try {
		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
		const staticFile = request.method === "GET" ? staticFiles.get(url.pathname) : undefined;
		if (staticFile) {
			response.writeHead(200, { "content-type": staticFile.type, "cache-control": "no-store" });
			response.end(await readFile(staticFile.path));
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/events") {
			const clientId = requireClientId(url.searchParams.get("clientId"));
			response.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
			});
			response.flushHeaders();
			const disconnect = registry.connect(clientId, (event) => {
				response.write(`data: ${JSON.stringify(event)}\n\n`);
			});
			const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
			request.once("close", () => {
				clearInterval(heartbeat);
				disconnect();
			});
			return;
		}

		if (
			request.method === "PUT" &&
			url.pathname.startsWith("/api/clients/") &&
			url.pathname.endsWith("/capabilities")
		) {
			const clientId = requireClientId(url.pathname.slice("/api/clients/".length, -"/capabilities".length));
			const body = objectRecord(await readJson(request));
			registry.register(clientId, parseActions(body?.actions));
			sendJson(response, 200, { ok: true });
			return;
		}

		if (request.method === "POST" && url.pathname.startsWith("/api/action-results/")) {
			const requestId = url.pathname.slice("/api/action-results/".length);
			const body = objectRecord(await readJson(request));
			const message: ActionResultMessage = {
				clientId: requireClientId(body?.clientId),
				ok: body?.ok === true,
				result: body?.result,
				error: typeof body?.error === "string" ? body.error : undefined,
			};
			registry.handleResult(requestId, message);
			sendJson(response, 200, { ok: true });
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/prompt") {
			const body = objectRecord(await readJson(request));
			const clientId = requireClientId(body?.clientId);
			if (!registry.hasClient(clientId)) throw new CapabilityError("client_unavailable", "Client is not connected");
			if (typeof body?.text !== "string" || body.text.trim().length === 0) throw new Error("Prompt is required");
			if (promptInFlight) {
				sendJson(response, 409, { ok: false, error: "The shared session is already processing a prompt" });
				return;
			}
			promptInFlight = true;
			activeOriginClientId = clientId;
			registry.broadcast({ type: "user_prompt", clientId, text: body.text.trim() });
			try {
				const assistant = await harness.prompt(body.text.trim());
				sendJson(response, 200, { ok: assistant.stopReason !== "error", error: assistant.errorMessage });
			} finally {
				activeOriginClientId = undefined;
				promptInFlight = false;
			}
			return;
		}

		if (request.method === "POST" && url.pathname.startsWith("/api/commands/")) {
			const name = url.pathname.slice("/api/commands/".length);
			const command = commands.get(name);
			if (!command) {
				sendJson(response, 404, { ok: false, error: `Unknown command ${name}` });
				return;
			}
			const body = objectRecord(await readJson(request));
			const clientId = requireClientId(body?.clientId);
			const result = await command(body, contextFor(clientId));
			sendJson(response, 200, { ok: true, result });
			return;
		}

		sendJson(response, 404, { ok: false, error: "Not found" });
	} catch (error) {
		sendJson(response, errorStatus(error), { ok: false, error: errorMessage(error) });
	}
});

server.listen(port, host, async () => {
	const auth = await models.checkAuth(providerId);
	console.log(`Capability spike listening at http://${host}:${port}`);
	console.log(`Model: ${modelSpec}${auth ? ` (${auth.source})` : " (provider auth not configured)"}`);
	console.log("Open the web URL or run: npx tsx packages/coding-agent/examples/capability-spike/tui.ts");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		server.close(() => process.exit(0));
	});
}

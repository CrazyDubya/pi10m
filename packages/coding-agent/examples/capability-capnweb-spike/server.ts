import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
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
import { RpcSession, type RpcStub, RpcTarget } from "capnweb";
import { Value } from "typebox/value";
import { WebSocketServer } from "ws";
import { BindingRegistry, type ConnectedClient } from "./binding-registry.ts";
import {
	type MessageEndHandler,
	type NotifyExtensionContext,
	notifyExtension,
	type ServerCommand,
	type ServerExtensionApi,
} from "./extension.ts";
import {
	type ClientBindingApi,
	type ClientRegistration,
	clientRegistrationSchema,
	type ServerApi,
	type ServerEvent,
} from "./protocol.ts";
import { NodeWebSocketTransport } from "./ws-transport.ts";

const host = process.env.PI_CAPNWEB_SPIKE_HOST ?? "127.0.0.1";
const port = Number(process.env.PI_CAPNWEB_SPIKE_PORT ?? "8788");
const modelSpec = process.env.PI_CAPNWEB_SPIKE_MODEL ?? "openai/gpt-5.4-nano";
const [providerId, modelId] = modelSpec.split("/", 2);
if (!providerId || !modelId) {
	throw new Error(`PI_CAPNWEB_SPIKE_MODEL must use provider/model syntax, received ${modelSpec}`);
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
const registry = new BindingRegistry();
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

let activeOriginClient: ConnectedClient | undefined;
let promptInFlight = false;

function contextFor(client: ConnectedClient): NotifyExtensionContext {
	return {
		clientBindings: {
			notify: (input, options) => registry.notify(client, input, options),
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
		if (!activeOriginClient) throw new Error("No originating client is bound to this turn");
		return contextFor(activeOriginClient);
	},
	systemPrompt: [
		"You are a concise assistant.",
		"When asked for the capital of France, respond with exactly Paris and nothing else.",
		"When the user asks for a notification, call the notify tool with the exact message they want shown.",
	].join(" "),
});

harness.subscribe(async (event, signal) => {
	for (const wireEvent of toServerEvents(event)) await registry.broadcast(wireEvent);
	if (event.type === "message_end" && messageEndHandlers.length > 0) {
		if (!activeOriginClient) throw new Error("No originating client is bound to this assistant response");
		const context = contextFor(activeOriginClient);
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

async function runPrompt(client: ConnectedClient, text: string): Promise<void> {
	if (promptInFlight) throw new Error("The shared session is already processing a prompt");
	promptInFlight = true;
	activeOriginClient = client;
	await registry.broadcast({ type: "user_prompt", clientId: client.id, text });
	try {
		const assistant = await harness.prompt(text);
		if (assistant.stopReason === "error") throw new Error(assistant.errorMessage ?? "Agent run failed");
	} finally {
		activeOriginClient = undefined;
		promptInFlight = false;
	}
}

class PiServerConnection extends RpcTarget implements ServerApi {
	readonly #remoteClient: () => RpcStub<ClientBindingApi>;
	#client: ConnectedClient | undefined;

	constructor(remoteClient: () => RpcStub<ClientBindingApi>) {
		super();
		this.#remoteClient = remoteClient;
	}

	async connect(registration: ClientRegistration): Promise<void> {
		if (this.#client) throw new Error("This RPC session is already registered");
		if (!Value.Check(clientRegistrationSchema, registration)) throw new Error("Invalid client registration");
		const client = registry.register(registration, this.#remoteClient());
		this.#client = client;
		try {
			await registry.send(client, { type: "ready", clientId: client.id, bindings: registration.bindings });
		} catch (error) {
			registry.unregister(client);
			this.#client = undefined;
			throw error;
		}
	}

	async prompt(text: string): Promise<void> {
		const client = this.#requireClient();
		if (typeof text !== "string" || text.trim().length === 0) throw new Error("Prompt is required");
		await runPrompt(client, text.trim());
	}

	async command(name: string, input: unknown): Promise<void> {
		const client = this.#requireClient();
		if (typeof name !== "string") throw new Error("Command name must be a string");
		const command = commands.get(name);
		if (!command) throw new Error(`Unknown command ${name}`);
		await command(input, contextFor(client));
	}

	[Symbol.dispose](): void {
		if (!this.#client) return;
		registry.unregister(this.#client);
		this.#client = undefined;
	}

	#requireClient(): ConnectedClient {
		if (!this.#client?.connected) throw new Error("RPC client has not connected");
		return this.#client;
	}
}

function sendStatic(response: ServerResponse, path: string, type: string): Promise<void> {
	return readFile(path).then((body) => {
		response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
		response.end(body);
	});
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(body));
}

const exampleRoot = dirname(fileURLToPath(import.meta.url));
const webRoot = join(exampleRoot, "web");
const capnwebBrowserModule = fileURLToPath(import.meta.resolve("capnweb"));
const staticFiles = new Map([
	["/", { path: join(webRoot, "index.html"), type: "text/html; charset=utf-8" }],
	["/app.js", { path: join(webRoot, "app.js"), type: "text/javascript; charset=utf-8" }],
	["/styles.css", { path: join(webRoot, "styles.css"), type: "text/css; charset=utf-8" }],
	["/vendor/capnweb.js", { path: capnwebBrowserModule, type: "text/javascript; charset=utf-8" }],
]);

const httpServer = createServer(async (request, response) => {
	try {
		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
		const staticFile = request.method === "GET" ? staticFiles.get(url.pathname) : undefined;
		if (staticFile) {
			await sendStatic(response, staticFile.path, staticFile.type);
			return;
		}
		sendJson(response, 404, { ok: false, error: "Not found" });
	} catch (error) {
		sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
	}
});

const wsServer = new WebSocketServer({
	server: httpServer,
	path: "/api/rpc",
	maxPayload: 64 * 1024,
	perMessageDeflate: false,
});
wsServer.on("connection", (socket) => {
	let remoteClient: RpcStub<ClientBindingApi> | undefined;
	const connection = new PiServerConnection(() => {
		if (!remoteClient) throw new Error("Remote client binding is not ready");
		return remoteClient;
	});
	const session = new RpcSession<ClientBindingApi>(new NodeWebSocketTransport(socket), connection, {
		limits: { maxMessageSize: 64 * 1024 },
	});
	remoteClient = session.getRemoteMain();
	socket.once("close", () => connection[Symbol.dispose]());
});

httpServer.listen(port, host, async () => {
	const auth = await models.checkAuth(providerId);
	console.log(`Cap'n Web capability spike listening at http://${host}:${port}`);
	console.log(`Model: ${modelSpec}${auth ? ` (${auth.source})` : " (provider auth not configured)"}`);
	console.log("Run the TUI with: npm run tui --prefix packages/coding-agent/examples/capability-capnweb-spike");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		wsServer.close();
		httpServer.close(() => process.exit(0));
	});
}

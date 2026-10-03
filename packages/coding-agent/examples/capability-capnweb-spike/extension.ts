import type { AgentHarnessEvent, AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { contentText } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { NotifyInput, NotifyOutput } from "./protocol.ts";

export interface ClientBindings {
	notify(input: NotifyInput, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<NotifyOutput>;
}

export interface NotifyExtensionContext {
	clientBindings: ClientBindings;
}

export type ServerCommand = (input: unknown, context: NotifyExtensionContext, signal?: AbortSignal) => Promise<unknown>;

export type MessageEndEvent = Extract<AgentHarnessEvent, { type: "message_end" }>;

export type MessageEndHandler = (
	event: MessageEndEvent,
	context: NotifyExtensionContext,
	signal?: AbortSignal,
) => Promise<void> | void;

export interface ServerExtensionApi {
	registerTool(tool: AgentHarnessTool<NotifyExtensionContext>): void;
	registerCommand(name: string, command: ServerCommand): void;
	on(type: "message_end", handler: MessageEndHandler): void;
}

async function notifyClient(
	input: unknown,
	context: NotifyExtensionContext,
	signal?: AbortSignal,
): Promise<NotifyOutput> {
	if (
		typeof input !== "object" ||
		input === null ||
		!("message" in input) ||
		typeof input.message !== "string" ||
		input.message.trim().length === 0
	) {
		throw new Error("notify requires a non-empty message");
	}
	return context.clientBindings.notify({ message: input.message.trim() }, { signal });
}

const notifyParameters = Type.Object(
	{
		message: Type.String({ description: "Notification text", minLength: 1, maxLength: 500 }),
	},
	{ additionalProperties: false },
);

export function notifyExtension(pi: ServerExtensionApi): void {
	pi.registerCommand("notify", notifyClient);
	pi.on("message_end", async (event, context, signal) => {
		if (event.message.role !== "assistant") return;
		if (contentText(event.message.content, "").trim() === "Paris") {
			await notifyClient({ message: "❤️" }, context, signal);
		}
	});
	pi.registerTool({
		name: "notify",
		label: "Notify client",
		description: "Show a brief notification on the client that submitted the current prompt.",
		parameters: notifyParameters,
		async execute(_toolCallId, params, signal, _onUpdate, context) {
			const input = typeof params === "object" && params !== null ? params : {};
			const message = "message" in input && typeof input.message === "string" ? input.message : "";
			await notifyClient({ message }, context, signal);
			return {
				content: [{ type: "text", text: `Notified the originating client: ${message}` }],
				details: { displayed: true },
			};
		},
	});
}

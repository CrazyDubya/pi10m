import { randomUUID } from "node:crypto";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ActionRegistration, ActionResultMessage, ClientAction, ServerEvent } from "./protocol.ts";

interface ClientConnection {
	id: string;
	actions: Map<string, number>;
	send(event: ServerEvent): void;
}

interface PendingInvocation {
	clientId: string;
	action: ClientAction<TSchema, TSchema>;
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: NodeJS.Timeout;
	removeAbortListener?: () => void;
}

export class CapabilityError extends Error {
	public code:
		| "client_unavailable"
		| "action_unavailable"
		| "invalid_input"
		| "invalid_output"
		| "aborted"
		| "timeout"
		| "remote_error";

	constructor(
		code:
			| "client_unavailable"
			| "action_unavailable"
			| "invalid_input"
			| "invalid_output"
			| "aborted"
			| "timeout"
			| "remote_error",
		message: string,
	) {
		super(message);
		this.name = "CapabilityError";
		this.code = code;
	}
}

export class CapabilityRegistry {
	private readonly clients = new Map<string, ClientConnection>();
	private readonly pending = new Map<string, PendingInvocation>();

	connect(clientId: string, send: (event: ServerEvent) => void): () => void {
		this.disconnect(clientId, "Client reconnected");
		const connection: ClientConnection = { id: clientId, actions: new Map(), send };
		this.clients.set(clientId, connection);
		connection.send({ type: "ready", clientId });

		return () => {
			if (this.clients.get(clientId) === connection) {
				this.disconnect(clientId, "Client disconnected");
			}
		};
	}

	hasClient(clientId: string): boolean {
		return this.clients.has(clientId);
	}

	register(clientId: string, actions: ActionRegistration[]): void {
		const client = this.clients.get(clientId);
		if (!client) {
			throw new CapabilityError("client_unavailable", `Client ${clientId} is not connected`);
		}
		client.actions = new Map(actions.map((action) => [action.id, action.version]));
		client.send({ type: "capabilities_updated", actions });
	}

	async invoke<TInputSchema extends TSchema, TOutputSchema extends TSchema>(
		clientId: string,
		action: ClientAction<TInputSchema, TOutputSchema>,
		input: unknown,
		options: { signal?: AbortSignal; timeoutMs?: number } = {},
	): Promise<Static<TOutputSchema>> {
		if (!Value.Check(action.input, input)) {
			throw new CapabilityError("invalid_input", `Input does not match ${action.id}@${action.version}`);
		}
		const client = this.clients.get(clientId);
		if (!client) {
			throw new CapabilityError("client_unavailable", `Client ${clientId} is not connected`);
		}
		if (client.actions.get(action.id) !== action.version) {
			throw new CapabilityError(
				"action_unavailable",
				`Client ${clientId} does not provide ${action.id}@${action.version}`,
			);
		}
		if (options.signal?.aborted) {
			throw new CapabilityError("aborted", `${action.id} was aborted`);
		}

		const requestId = randomUUID();
		const timeoutMs = options.timeoutMs ?? 10_000;
		const result = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.rejectInvocation(
					requestId,
					new CapabilityError("timeout", `${action.id} timed out after ${timeoutMs}ms`),
				);
				client.send({ type: "action_cancel", requestId });
			}, timeoutMs);
			const pending: PendingInvocation = {
				clientId,
				action,
				resolve,
				reject,
				timer,
			};
			if (options.signal) {
				const onAbort = () => {
					this.rejectInvocation(requestId, new CapabilityError("aborted", `${action.id} was aborted`));
					client.send({ type: "action_cancel", requestId });
				};
				options.signal.addEventListener("abort", onAbort, { once: true });
				pending.removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
			}
			this.pending.set(requestId, pending);
		});

		client.send({
			type: "action_request",
			requestId,
			action: { id: action.id, version: action.version },
			input,
		});
		const output = await result;
		if (!Value.Check(action.output, output)) {
			throw new CapabilityError("invalid_output", `Output does not match ${action.id}@${action.version}`);
		}
		return output;
	}

	handleResult(requestId: string, message: ActionResultMessage): void {
		const pending = this.pending.get(requestId);
		if (!pending) return;
		if (pending.clientId !== message.clientId) {
			throw new CapabilityError("remote_error", `Client ${message.clientId} cannot answer request ${requestId}`);
		}
		this.pending.delete(requestId);
		clearTimeout(pending.timer);
		pending.removeAbortListener?.();
		if (!message.ok) {
			pending.reject(new CapabilityError("remote_error", message.error || `${pending.action.id} failed`));
			return;
		}
		if (!Value.Check(pending.action.output, message.result)) {
			pending.reject(
				new CapabilityError(
					"invalid_output",
					`Output does not match ${pending.action.id}@${pending.action.version}`,
				),
			);
			return;
		}
		pending.resolve(message.result);
	}

	broadcast(event: ServerEvent): void {
		for (const client of this.clients.values()) {
			client.send(event);
		}
	}

	private rejectInvocation(requestId: string, error: Error): void {
		const pending = this.pending.get(requestId);
		if (!pending) return;
		this.pending.delete(requestId);
		clearTimeout(pending.timer);
		pending.removeAbortListener?.();
		pending.reject(error);
	}

	private disconnect(clientId: string, reason: string): void {
		if (!this.clients.delete(clientId)) return;
		for (const [requestId, pending] of this.pending) {
			if (pending.clientId === clientId) {
				this.rejectInvocation(requestId, new CapabilityError("client_unavailable", reason));
			}
		}
	}
}

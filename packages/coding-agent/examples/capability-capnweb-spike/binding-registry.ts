import type { RpcStub } from "capnweb";
import { Value } from "typebox/value";
import {
	type ClientBindingApi,
	type ClientRegistration,
	type NotifyInput,
	type NotifyOutput,
	notifyBinding,
	type ServerEvent,
} from "./protocol.ts";

export class BindingError extends Error {
	readonly code:
		| "client_unavailable"
		| "binding_unavailable"
		| "invalid_input"
		| "invalid_output"
		| "aborted"
		| "timeout";

	constructor(
		code: "client_unavailable" | "binding_unavailable" | "invalid_input" | "invalid_output" | "aborted" | "timeout",
		message: string,
	) {
		super(message);
		this.name = "BindingError";
		this.code = code;
	}
}

export interface ConnectedClient {
	readonly id: string;
	readonly bindings: ReadonlyMap<string, number>;
	readonly rpc: RpcStub<ClientBindingApi>;
	connected: boolean;
}

export class BindingRegistry {
	readonly #clientsById = new Map<string, ConnectedClient>();

	register(registration: ClientRegistration, rpc: RpcStub<ClientBindingApi>): ConnectedClient {
		if (this.#clientsById.has(registration.clientId)) {
			throw new BindingError("client_unavailable", `Client ${registration.clientId} is already connected`);
		}
		const client: ConnectedClient = {
			id: registration.clientId,
			bindings: new Map(registration.bindings.map((binding) => [binding.id, binding.version])),
			rpc,
			connected: true,
		};
		this.#clientsById.set(client.id, client);
		return client;
	}

	unregister(client: ConnectedClient): void {
		if (this.#clientsById.get(client.id) !== client) return;
		client.connected = false;
		this.#clientsById.delete(client.id);
	}

	async send(client: ConnectedClient, event: ServerEvent): Promise<void> {
		this.#requireConnected(client);
		const call = client.rpc.event(event);
		try {
			await call;
		} finally {
			call[Symbol.dispose]();
		}
	}

	async broadcast(event: ServerEvent): Promise<void> {
		await Promise.all(
			[...this.#clientsById.values()].map(async (client) => {
				try {
					await this.send(client, event);
				} catch {
					this.unregister(client);
				}
			}),
		);
	}

	async notify(
		client: ConnectedClient,
		input: unknown,
		options: { signal?: AbortSignal; timeoutMs?: number } = {},
	): Promise<NotifyOutput> {
		this.#requireConnected(client);
		if (client.bindings.get(notifyBinding.id) !== notifyBinding.version) {
			throw new BindingError(
				"binding_unavailable",
				`Client ${client.id} does not provide ${notifyBinding.id}@${notifyBinding.version}`,
			);
		}
		if (!Value.Check(notifyBinding.input, input)) {
			throw new BindingError("invalid_input", `Input does not match ${notifyBinding.id}@${notifyBinding.version}`);
		}
		if (options.signal?.aborted) {
			throw new BindingError("aborted", `${notifyBinding.id} was aborted`);
		}

		const rpcCall = client.rpc.notify(input as NotifyInput);
		const timeoutMs = options.timeoutMs ?? 10_000;
		let rejectCancellation: ((error: Error) => void) | undefined;
		const cancellation = new Promise<never>((_resolve, reject) => {
			rejectCancellation = reject;
		});
		const timer = setTimeout(() => {
			rejectCancellation?.(new BindingError("timeout", `${notifyBinding.id} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		const onAbort = () => {
			rejectCancellation?.(new BindingError("aborted", `${notifyBinding.id} was aborted`));
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });

		try {
			const output = await Promise.race([rpcCall, cancellation]);
			if (!Value.Check(notifyBinding.output, output)) {
				throw new BindingError(
					"invalid_output",
					`Output does not match ${notifyBinding.id}@${notifyBinding.version}`,
				);
			}
			return { displayed: true };
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			rpcCall[Symbol.dispose]();
		}
	}

	#requireConnected(client: ConnectedClient): void {
		if (!client.connected || this.#clientsById.get(client.id) !== client) {
			throw new BindingError("client_unavailable", `Client ${client.id} is not connected`);
		}
	}
}

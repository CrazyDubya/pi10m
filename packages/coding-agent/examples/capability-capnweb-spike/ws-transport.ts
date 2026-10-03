import type { RpcTransport } from "capnweb";
import type WebSocket from "ws";

interface Receiver {
	resolve(message: string): void;
	reject(error: Error): void;
}

/** Adapts the Node `ws` server socket to Cap'n Web without an unsafe type cast. */
export class NodeWebSocketTransport implements RpcTransport {
	readonly #socket: WebSocket;
	readonly #messages: string[] = [];
	readonly #receivers: Receiver[] = [];
	#closedError: Error | undefined;

	constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.on("message", (data, isBinary) => {
			if (isBinary) {
				this.abort(new Error("Binary Cap'n Web frames are not supported"));
				return;
			}
			this.#deliver(data.toString());
		});
		socket.once("close", () => this.#fail(new Error("WebSocket closed")));
		socket.once("error", (error) => this.#fail(error));
	}

	send(message: string): Promise<void> {
		if (this.#closedError || this.#socket.readyState !== 1) {
			return Promise.reject(this.#closedError ?? new Error("WebSocket is not open"));
		}
		return new Promise<void>((resolve, reject) => {
			this.#socket.send(message, (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	receive(): Promise<string> {
		const message = this.#messages.shift();
		if (message !== undefined) return Promise.resolve(message);
		if (this.#closedError) return Promise.reject(this.#closedError);
		return new Promise<string>((resolve, reject) => {
			this.#receivers.push({ resolve, reject });
		});
	}

	abort(reason: unknown): void {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		this.#fail(error);
		if (this.#socket.readyState === 0 || this.#socket.readyState === 1) {
			this.#socket.close(1011, "RPC session aborted");
		}
	}

	#deliver(message: string): void {
		const receiver = this.#receivers.shift();
		if (receiver) receiver.resolve(message);
		else this.#messages.push(message);
	}

	#fail(error: Error): void {
		if (this.#closedError) return;
		this.#closedError = error;
		for (const receiver of this.#receivers.splice(0)) receiver.reject(error);
	}
}

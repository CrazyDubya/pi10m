import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import type { Duplex } from "node:stream";
import * as tls from "node:tls";
import { getProxyForUrl } from "./proxy-env.ts";

type ProxyResolver = (url: string) => string;
type ConnectionCallback = (error: Error | null, socket: Duplex) => void;

interface AgentWithAddRequest {
	addRequest(req: http.ClientRequest, options: http.RequestOptions): void;
}

type ProxyRequestOptions = http.RequestOptions & {
	servername?: string;
};

export interface EnvHttpProxyAgentOptions extends http.AgentOptions {
	getProxyForUrl?: ProxyResolver;
}

export interface EnvHttpsProxyAgentOptions extends https.AgentOptions {
	getProxyForUrl?: ProxyResolver;
}

export interface EnvProxyAgentsOptions extends http.AgentOptions, https.AgentOptions {
	getProxyForUrl?: ProxyResolver;
}

export interface EnvProxyAgents {
	httpAgent: http.Agent;
	httpsAgent: https.Agent;
}

export const UNSUPPORTED_PROXY_PROTOCOL_MESSAGE =
	"Unsupported proxy protocol. SOCKS and PAC proxy URLs are no longer supported; use an HTTP or HTTPS proxy URL.";

const MAX_CONNECT_RESPONSE_BYTES = 64 * 1024;

function toPort(value: string | number | null | undefined, defaultPort: number): number {
	if (typeof value === "number") return value;
	if (typeof value === "string" && value.length > 0) return Number.parseInt(value, 10);
	return defaultPort;
}

function stripPort(host: string): string {
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		return end === -1 ? host : host.slice(1, end);
	}

	const firstColon = host.indexOf(":");
	const lastColon = host.lastIndexOf(":");
	if (firstColon !== -1 && firstColon === lastColon) {
		const maybePort = host.slice(lastColon + 1);
		if (/^\d+$/.test(maybePort)) return host.slice(0, lastColon);
	}
	return host;
}

function getHostname(options: ProxyRequestOptions): string {
	const value = options.hostname || options.host || "localhost";
	return stripPort(String(value));
}

function formatHost(hostname: string): string {
	return net.isIPv6(hostname) ? `[${hostname}]` : hostname;
}

function buildTargetUrl(protocol: "http:" | "https:", options: ProxyRequestOptions): string {
	const defaultPort = protocol === "https:" ? 443 : 80;
	const hostname = getHostname(options);
	const port = toPort(options.port, defaultPort);
	const portSuffix = port === defaultPort ? "" : `:${port}`;
	return `${protocol}//${formatHost(hostname)}${portSuffix}`;
}

function callConnectionCallbackWithError(callback: ConnectionCallback, error: Error): void {
	(callback as (error: Error) => void)(error);
}

function addRequest(agent: http.Agent, req: http.ClientRequest, options: http.RequestOptions): void {
	(http.Agent.prototype as unknown as AgentWithAddRequest).addRequest.call(agent, req, options);
}

function parseProxyUrl(proxy: string): URL {
	const proxyUrl = new URL(proxy);
	if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") {
		throw new Error(`${UNSUPPORTED_PROXY_PROTOCOL_MESSAGE} Got ${proxyUrl.protocol}`);
	}
	return proxyUrl;
}

function getProxyAuthorization(proxyUrl: URL): string | undefined {
	if (!proxyUrl.username && !proxyUrl.password) return undefined;
	const auth = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
	return `Basic ${Buffer.from(auth).toString("base64")}`;
}

function setProxyRequestHeaders(req: http.ClientRequest, proxyUrl: URL, keepAlive: boolean): void {
	const authorization = getProxyAuthorization(proxyUrl);
	if (authorization) {
		req.setHeader("Proxy-Authorization", authorization);
	}
	if (!req.hasHeader("Proxy-Connection")) {
		req.setHeader("Proxy-Connection", keepAlive ? "Keep-Alive" : "close");
	}
}

function hasLeadingUrlScheme(value: string): boolean {
	return /^[a-z][a-z\d+.-]*:\/\//i.test(value);
}

function getHttpRequestUrl(req: http.ClientRequest, options: ProxyRequestOptions): string {
	const hostHeader = req.getHeader("host");
	const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
	const fallbackHost = formatHost(getHostname(options));
	const baseHost = typeof host === "string" && host.length > 0 ? host : fallbackHost;
	const url = hasLeadingUrlScheme(req.path) ? new URL(req.path) : new URL(req.path, `http://${baseHost}`);
	const port = toPort(options.port, 80);
	if (!url.port && port !== 80) {
		url.port = String(port);
	}
	return url.toString();
}

function getProxyConnectionOptions(proxyUrl: URL): net.NetConnectOpts & tls.ConnectionOptions {
	const host = proxyUrl.hostname.replace(/^\[|\]$/g, "");
	const port = proxyUrl.port ? Number.parseInt(proxyUrl.port, 10) : proxyUrl.protocol === "https:" ? 443 : 80;
	return {
		ALPNProtocols: ["http/1.1"],
		host,
		port,
		...(proxyUrl.protocol === "https:" && !net.isIP(host) ? { servername: host } : {}),
	};
}

function openProxySocket(proxyUrl: URL): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const connectOptions = getProxyConnectionOptions(proxyUrl);
		const socket: net.Socket =
			proxyUrl.protocol === "https:" ? tls.connect(connectOptions) : net.connect(connectOptions);

		const cleanup = () => {
			socket.removeListener("connect", onConnect);
			socket.removeListener("secureConnect", onConnect);
			socket.removeListener("error", onError);
		};
		const onConnect = () => {
			cleanup();
			resolve(socket);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		socket.once(proxyUrl.protocol === "https:" ? "secureConnect" : "connect", onConnect);
		socket.once("error", onError);
	});
}

interface ProxyConnectResponse {
	statusCode: number;
	statusText: string;
	headers: http.IncomingHttpHeaders;
}

function parseProxyConnectResponse(socket: net.Socket): Promise<ProxyConnectResponse> {
	return new Promise((resolve, reject) => {
		const buffers: Buffer[] = [];
		let buffersLength = 0;

		const cleanup = () => {
			socket.removeListener("data", onData);
			socket.removeListener("end", onEnd);
			socket.removeListener("error", onError);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onEnd = () => {
			cleanup();
			reject(new Error("Proxy connection ended before receiving CONNECT response"));
		};
		const onData = (chunk: Buffer) => {
			buffers.push(chunk);
			buffersLength += chunk.length;
			if (buffersLength > MAX_CONNECT_RESPONSE_BYTES) {
				cleanup();
				reject(new Error("Proxy CONNECT response exceeded the maximum header size"));
				return;
			}

			const buffered = Buffer.concat(buffers, buffersLength);
			const endOfHeaders = buffered.indexOf("\r\n\r\n");
			if (endOfHeaders === -1) return;

			cleanup();
			const extra = buffered.subarray(endOfHeaders + 4);
			if (extra.length > 0) {
				socket.unshift(extra);
			}

			try {
				resolve(parseProxyConnectHeaders(buffered.subarray(0, endOfHeaders).toString("ascii")));
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		};

		socket.on("data", onData);
		socket.once("end", onEnd);
		socket.once("error", onError);
	});
}

function parseProxyConnectHeaders(headerText: string): ProxyConnectResponse {
	const [statusLine, ...headerLines] = headerText.split("\r\n");
	const statusMatch = statusLine?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/);
	if (!statusMatch) {
		throw new Error("Invalid proxy CONNECT response status line");
	}

	const headers: http.IncomingHttpHeaders = {};
	for (const line of headerLines) {
		if (!line) continue;
		const colon = line.indexOf(":");
		if (colon === -1) throw new Error(`Invalid proxy CONNECT response header: ${line}`);
		const key = line.slice(0, colon).toLowerCase();
		const value = line.slice(colon + 1).trimStart();
		const current = headers[key];
		if (typeof current === "string") {
			headers[key] = [current, value];
		} else if (Array.isArray(current)) {
			current.push(value);
		} else {
			headers[key] = value;
		}
	}

	return {
		statusCode: Number.parseInt(statusMatch[1], 10),
		statusText: statusMatch[2] || "",
		headers,
	};
}

function buildConnectPayload(targetHost: string, targetPort: number, proxyUrl: URL, keepAlive: boolean): string {
	const host = formatHost(targetHost);
	const headers: Record<string, string> = {
		Host: `${host}:${targetPort}`,
		"Proxy-Connection": keepAlive ? "Keep-Alive" : "close",
	};
	const authorization = getProxyAuthorization(proxyUrl);
	if (authorization) {
		headers["Proxy-Authorization"] = authorization;
	}

	let payload = `CONNECT ${host}:${targetPort} HTTP/1.1\r\n`;
	for (const [name, value] of Object.entries(headers)) {
		payload += `${name}: ${value}\r\n`;
	}
	return `${payload}\r\n`;
}

function buildTlsOptions(options: ProxyRequestOptions, socket: net.Socket): tls.ConnectionOptions {
	const {
		host: _host,
		hostname: _hostname,
		path: _path,
		port: _port,
		protocol: _protocol,
		socketPath: _socketPath,
		...tlsOptions
	} = options;
	const targetHost = getHostname(options);
	return {
		...tlsOptions,
		socket,
		...(options.servername === undefined && !net.isIP(targetHost) ? { servername: targetHost } : {}),
	};
}

async function connectHttpsThroughProxy(
	proxyUrl: URL,
	options: ProxyRequestOptions,
	keepAlive: boolean,
): Promise<tls.TLSSocket> {
	const socket = await openProxySocket(proxyUrl);
	let upgradedToTls = false;

	try {
		const targetHost = getHostname(options);
		const targetPort = toPort(options.port, 443);
		const responsePromise = parseProxyConnectResponse(socket);
		socket.write(buildConnectPayload(targetHost, targetPort, proxyUrl, keepAlive));
		const response = await responsePromise;

		if (response.statusCode !== 200) {
			const statusText = response.statusText ? ` ${response.statusText}` : "";
			throw new Error(`Proxy CONNECT failed with status ${response.statusCode}${statusText}`);
		}

		const tlsSocket = tls.connect(buildTlsOptions(options, socket));
		upgradedToTls = true;
		return tlsSocket;
	} catch (error) {
		if (!upgradedToTls) {
			socket.destroy();
		}
		throw error;
	}
}

export class EnvHttpProxyAgent extends http.Agent {
	private readonly keepAliveEnabled: boolean;
	private readonly resolveProxy: ProxyResolver;

	constructor(options: EnvHttpProxyAgentOptions = {}) {
		const { getProxyForUrl: resolver, ...agentOptions } = options;
		super(agentOptions);
		this.keepAliveEnabled = options.keepAlive ?? false;
		this.resolveProxy = resolver || getProxyForUrl;
	}

	addRequest(req: http.ClientRequest, options: ProxyRequestOptions): void {
		let proxyUrl: URL | undefined;
		try {
			const proxy = this.resolveProxy(buildTargetUrl("http:", options));
			proxyUrl = proxy ? parseProxyUrl(proxy) : undefined;
		} catch (error) {
			const requestError = error instanceof Error ? error : new Error(String(error));
			queueMicrotask(() => {
				req.emit("error", requestError);
				req.destroy();
			});
			return;
		}

		if (proxyUrl) {
			req.path = getHttpRequestUrl(req, options);
			setProxyRequestHeaders(req, proxyUrl, this.keepAliveEnabled);
		}

		addRequest(this, req, options);
	}

	override createConnection(options: ProxyRequestOptions, callback?: ConnectionCallback): Duplex | null | undefined {
		try {
			const proxy = this.resolveProxy(buildTargetUrl("http:", options));
			if (!proxy) {
				return super.createConnection(options, callback);
			}

			const proxyUrl = parseProxyUrl(proxy);
			return proxyUrl.protocol === "https:"
				? tls.connect(getProxyConnectionOptions(proxyUrl))
				: net.connect(getProxyConnectionOptions(proxyUrl));
		} catch (error) {
			if (callback) {
				callConnectionCallbackWithError(callback, error instanceof Error ? error : new Error(String(error)));
				return undefined;
			}
			throw error;
		}
	}
}

export class EnvHttpsProxyAgent extends https.Agent {
	private readonly keepAliveEnabled: boolean;
	private readonly resolveProxy: ProxyResolver;

	constructor(options: EnvHttpsProxyAgentOptions = {}) {
		const { getProxyForUrl: resolver, ...agentOptions } = options;
		super(agentOptions);
		this.keepAliveEnabled = options.keepAlive ?? false;
		this.resolveProxy = resolver || getProxyForUrl;
	}

	override createConnection(options: ProxyRequestOptions, callback?: ConnectionCallback): Duplex | null | undefined {
		try {
			const proxy = this.resolveProxy(buildTargetUrl("https:", options));
			if (!proxy) {
				return super.createConnection(options, callback);
			}

			const proxyUrl = parseProxyUrl(proxy);
			if (!callback) {
				throw new Error("A callback is required for HTTPS proxy connections");
			}

			connectHttpsThroughProxy(proxyUrl, options, this.keepAliveEnabled).then(
				(socket) => callback(null, socket),
				(error: unknown) =>
					callConnectionCallbackWithError(callback, error instanceof Error ? error : new Error(String(error))),
			);
			return undefined;
		} catch (error) {
			if (callback) {
				callConnectionCallbackWithError(callback, error instanceof Error ? error : new Error(String(error)));
				return undefined;
			}
			throw error;
		}
	}
}

export function createEnvProxyAgents(options: EnvProxyAgentsOptions = {}): EnvProxyAgents {
	return {
		httpAgent: new EnvHttpProxyAgent(options),
		httpsAgent: new EnvHttpsProxyAgent(options),
	};
}

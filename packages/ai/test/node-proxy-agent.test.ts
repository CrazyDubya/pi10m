import { Buffer } from "node:buffer";
import { once } from "node:events";
import * as http from "node:http";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
import * as net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EnvHttpProxyAgent, EnvHttpsProxyAgent } from "../src/utils/node-proxy-agent.ts";

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6BQBGN7QX+PBv
gVIxRkVmk/1e1v+njs6TusQrPFfiGFqx4HqQ8aavyo24v5dHsLHcltxP4u8Ryt9/
Fo5sBhpaVCTvbGkUyfv8HUz2m9gSEKHxyRA3d0W2JlSiFqPzv0JhapxLjRfOdxc5
8FPx4MqJDQDnExcemTmvBCtyiWL/xmwh//cqm1j3H52ri+7W6olaGkil45xGKE0A
8IgMvG+VgzTNnmKSeYRGeWVAW4RdjVRQcntDCImUWDGAh1P3hxsoz9C5ehhvJbQD
vXM8c/XRMAaOQ/iGxpjqs/jxRZZpceZkYYMjOKpP1gJfEwVYxOWKKQ9eDSgJrf2N
iIOqYPzfAgMBAAECggEBAKRRNJvSKsieQq0MvDEAlN92zHKRUoWNdVczvINAq5Tx
1HOaCkqs24QfVa8jtptCLurfbD85A9tgrKoTn702auLtvy6rQet2PJvIuiqBIY1b
meH9rNCCEFdFZq9DdpIimZ150hQ+zw+3TRIGA/D+k4oarXhw+ZQy36yE72geig/K
kjgWoSX6ry78AOtlKnJGUJqgyzW/220ljzuJSW3Ry6aTDRUMkUi8k8z6o8Ku8YnM
PIW3eN9zh3qAsT/OGf2UFE1bnSj1tKXTqXPvt5h+9XiZ3rvQreyQW9Ns0kNJCHSZ
R775WeI3LpEhq6kFCcEGTozCLjgZ9eLI8zk7fLFF0KECgYEA3aVsqczZ3Py+3jtO
vbwCb5jJ+VmF4moC7FMvaXp6v+Cy35D5LKTnCvELJRChe83jzzH23m16nZQMT+cp
3yq+H1m6jgXhzbgDXwri/dngVpjLmoBp/P421q6Sx8OhYokRVhRwLlB9hqHnq0It
59uKUEyZ1/+xtrqpeYrzAUc1We8CgYEA1tn3auc3toKt+dE5Zxw9HtmCe9FQ/VUX
MbzYP0bXTl/JcwKulYPODhT8Q2ihspea88GCFqHt0MULPFD7hnaW0d9G9DBg3xH2
dqKJnZ7vl8+PdN5mhumjhPaST5av6v40mP8EjOkerW5UzkbTorfRKFCesZlEhd0d
I01jvSdePBECgYBPuw0uu7D3TLgAS0dU+0fJCyZEm06NFuN8TaQ1hkiXs2XFBGqO
A7fU+Mawi537YiH7y5Zphupfuvz+1UH7tG1165ovMrB6hyI3Uzw6YuDPZeF/74ew
6WWirmPAln/8aSAiXfHIx02QW7dxpLnMuO21WwjQaXttJxKF1VT69bmcYwKBgQCb
UFYbYapUtYMu5KCqeS917ab1+wqhF7H8spdgpsVeUsA98+JhEzcR1vnFgQ3jHNVX
ALwZwFU6ZjcJE0HAolnEvbN9MrvUhhe1CyqQVyS8ib8arOtQ+/TJWbXK8xOYvMsp
DrErbBpRJUEJHQpAxsDcc+tEV5fBbWZy7q77PkpRAQKBgGd3cYOMIyB3EbFpZTEc
suv6urzMY+ezHWVdDTwzb2O9TaPUY8ovF0qjp0aD5u+zeUfZ8Sg3XVP0ceriLubw
bIBazJUHN2zO8W1iMSnQ1TqbHn02IR/ySMJbE1BH2KGEDKbSIcRPMNNVqJx+Civ+
5r0i4ZclQDLWp6VaabdukwJ4
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQCAip8jY3MesjANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjYwNTEzMTIwNTQwWhcNMzYwNTEwMTIwNTQwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC6
BQBGN7QX+PBvgVIxRkVmk/1e1v+njs6TusQrPFfiGFqx4HqQ8aavyo24v5dHsLHc
ltxP4u8Ryt9/Fo5sBhpaVCTvbGkUyfv8HUz2m9gSEKHxyRA3d0W2JlSiFqPzv0Jh
apxLjRfOdxc58FPx4MqJDQDnExcemTmvBCtyiWL/xmwh//cqm1j3H52ri+7W6ola
Gkil45xGKE0A8IgMvG+VgzTNnmKSeYRGeWVAW4RdjVRQcntDCImUWDGAh1P3hxso
z9C5ehhvJbQDvXM8c/XRMAaOQ/iGxpjqs/jxRZZpceZkYYMjOKpP1gJfEwVYxOWK
KQ9eDSgJrf2NiIOqYPzfAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAAtg3Gs68TVQ
EGPGCnjoR7CFET9/yyaxlehI4djJsAHK3CM82lFLcu64NzkmbirSLzFbU2eW/LcY
R/er/QML1L6t0cUOhIA9sM0nMakZ0gPHZwRAHTYySIUU3qfLPobSQbKLpCfErpzp
sfcIpR93fxHQUTx58D2GwwBCFhTzaH4dBdykArzuMXZ8Ywd+btD3HVPF9ARZIFBp
R0voLArplJfZYx9P73nbSqfN1pycE1iTlvsjbsrihuR/3hKOJfOEkIu242hasvVw
R+xvp78sGTgV8McCWqM7uuDg41Iiv9osEgVP81TxpcoNksWuJVduEl9gX/vXxglC
0YhuPJ0qWj8=
-----END CERTIFICATE-----`;

const servers: Array<http.Server | https.Server> = [];
const sockets = new Set<net.Socket>();

async function listen(server: http.Server | https.Server): Promise<number> {
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	server.listen(0, "127.0.0.1");
	servers.push(server);
	await once(server, "listening");
	return (server.address() as AddressInfo).port;
}

function closeServer(server: http.Server | https.Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function requestText(
	client: typeof http | typeof https,
	options: http.RequestOptions | https.RequestOptions,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = client.request(options, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		});
		req.once("error", reject);
		req.end();
	});
}

afterEach(async () => {
	for (const socket of sockets) {
		socket.destroy();
	}
	sockets.clear();
	await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("node proxy agents", () => {
	it("sends HTTP requests through an HTTP proxy", async () => {
		const target = http.createServer((_request, response) => {
			response.end("direct");
		});
		const targetPort = await listen(target);

		let proxiedUrl: string | undefined;
		let proxyAuthorization: string | string[] | undefined;
		const proxy = http.createServer((request, response) => {
			proxiedUrl = request.url;
			proxyAuthorization = request.headers["proxy-authorization"];
			response.end("proxied");
		});
		const proxyPort = await listen(proxy);

		const agent = new EnvHttpProxyAgent({
			getProxyForUrl: () => `http://user:pass@127.0.0.1:${proxyPort}`,
		});

		const text = await requestText(http, {
			agent,
			hostname: "127.0.0.1",
			path: "/callback?next=https://example.com/after",
			port: targetPort,
		});
		agent.destroy();

		expect(text).toBe("proxied");
		expect(proxiedUrl).toBe(`http://127.0.0.1:${targetPort}/callback?next=https://example.com/after`);
		expect(proxyAuthorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
	});

	it("tunnels HTTPS requests through an HTTP proxy", async () => {
		const target = https.createServer({ key: TEST_KEY, cert: TEST_CERT }, (_request, response) => {
			response.end("secure target");
		});
		const targetPort = await listen(target);

		let connectUrl: string | undefined;
		let proxyAuthorization: string | string[] | undefined;
		const proxy = http.createServer();
		proxy.on("connect", (request, clientSocket, head) => {
			connectUrl = request.url;
			proxyAuthorization = request.headers["proxy-authorization"];

			const serverSocket = net.connect(targetPort, "127.0.0.1", () => {
				clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
				if (head.length > 0) serverSocket.write(head);
				serverSocket.pipe(clientSocket);
				clientSocket.pipe(serverSocket);
			});
			serverSocket.once("error", (error) => clientSocket.destroy(error));
			clientSocket.once("error", () => serverSocket.destroy());
		});
		const proxyPort = await listen(proxy);

		const agent = new EnvHttpsProxyAgent({
			getProxyForUrl: () => `http://user:pass@127.0.0.1:${proxyPort}`,
			rejectUnauthorized: false,
		});

		const text = await requestText(https, {
			agent,
			hostname: "127.0.0.1",
			path: "/secure",
			port: targetPort,
		});
		agent.destroy();

		expect(text).toBe("secure target");
		expect(connectUrl).toBe(`127.0.0.1:${targetPort}`);
		expect(proxyAuthorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
	});

	it("closes the proxy socket when CONNECT parsing fails", async () => {
		const proxy = http.createServer();
		proxy.on("connect", (_request, clientSocket) => {
			clientSocket.write("not-http\r\n\r\n");
		});
		const proxyPort = await listen(proxy);

		let destroyedProxySocket = false;
		const originalDestroy = net.Socket.prototype.destroy;
		net.Socket.prototype.destroy = function patchedDestroy(this: net.Socket, error?: Error): net.Socket {
			if (this.remotePort === proxyPort) {
				destroyedProxySocket = true;
			}
			return originalDestroy.call(this, error);
		};

		const agent = new EnvHttpsProxyAgent({
			getProxyForUrl: () => `http://127.0.0.1:${proxyPort}`,
			rejectUnauthorized: false,
		});

		try {
			await expect(
				requestText(https, {
					agent,
					hostname: "127.0.0.1",
					path: "/secure",
					port: 443,
				}),
			).rejects.toThrow(/Invalid proxy CONNECT response status line/);
			expect(destroyedProxySocket).toBe(true);
		} finally {
			net.Socket.prototype.destroy = originalDestroy;
			agent.destroy();
		}
	});

	it("rejects SOCKS and PAC proxy URLs explicitly", async () => {
		const agent = new EnvHttpProxyAgent({
			getProxyForUrl: () => "socks5://127.0.0.1:1080",
		});

		await expect(
			requestText(http, {
				agent,
				hostname: "127.0.0.1",
				path: "/",
				port: 9,
			}),
		).rejects.toThrow(/SOCKS and PAC proxy URLs are no longer supported/);
		agent.destroy();

		const pacAgent = new EnvHttpProxyAgent({
			getProxyForUrl: () => "pac+http://127.0.0.1/proxy.pac",
		});

		await expect(
			requestText(http, {
				agent: pacAgent,
				hostname: "127.0.0.1",
				path: "/",
				port: 9,
			}),
		).rejects.toThrow(/SOCKS and PAC proxy URLs are no longer supported/);
		pacAgent.destroy();
	});
});

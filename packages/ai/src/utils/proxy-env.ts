/*
 * Adapted from proxy-from-env.
 *
 * The MIT License
 *
 * Copyright (C) 2016-2018 Rob Wu <rob@robwu.nl>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const DEFAULT_PORTS: Record<string, number> = {
	ftp: 21,
	gopher: 70,
	http: 80,
	https: 443,
	ws: 80,
	wss: 443,
};

const PROXY_ENV_KEYS = [
	"npm_config_http_proxy",
	"http_proxy",
	"npm_config_https_proxy",
	"https_proxy",
	"npm_config_ws_proxy",
	"ws_proxy",
	"npm_config_wss_proxy",
	"wss_proxy",
	"npm_config_proxy",
	"all_proxy",
] as const;

function getEnv(key: string): string {
	if (typeof process === "undefined") return "";
	return process.env[key.toLowerCase()] || process.env[key.toUpperCase()] || "";
}

function getDefaultPort(protocol: string): number {
	return DEFAULT_PORTS[protocol] || 0;
}

function parseUrl(value: string | URL): URL | undefined {
	try {
		return typeof value === "string" ? new URL(value) : value;
	} catch {
		return undefined;
	}
}

function shouldProxy(hostname: string, port: number): boolean {
	const noProxy = (getEnv("npm_config_no_proxy") || getEnv("no_proxy")).toLowerCase();
	if (!noProxy) return true;
	if (noProxy === "*") return false;

	const lowerHostname = hostname.toLowerCase();
	return noProxy.split(/[,\s]/).every((entry) => {
		if (!entry) return true;

		const match = entry.match(/^(.+):(\d+)$/);
		let entryHostname = match ? match[1] : entry;
		const entryPort = match ? Number.parseInt(match[2], 10) : 0;
		if (entryPort && entryPort !== port) return true;

		if (!/^[.*]/.test(entryHostname)) {
			return lowerHostname !== entryHostname;
		}

		if (entryHostname.startsWith("*")) {
			entryHostname = entryHostname.slice(1);
		}
		return !lowerHostname.endsWith(entryHostname);
	});
}

/**
 * Resolve the HTTP proxy URL for a target URL from standard proxy environment variables.
 *
 * Matches proxy-from-env precedence for the env vars Pi has historically supported:
 * npm_config_<scheme>_proxy, <scheme>_proxy, npm_config_proxy, all_proxy, and no_proxy.
 */
export function getProxyForUrl(value: string | URL): string {
	const parsedUrl = parseUrl(value);
	if (!parsedUrl?.protocol || !parsedUrl.host) return "";

	const protocol = parsedUrl.protocol.slice(0, -1);
	const hostname = parsedUrl.host.replace(/:\d*$/, "").toLowerCase();
	if (!hostname) return "";

	const port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : getDefaultPort(protocol);
	if (!shouldProxy(hostname, port)) return "";

	let proxy =
		getEnv(`npm_config_${protocol}_proxy`) ||
		getEnv(`${protocol}_proxy`) ||
		getEnv("npm_config_proxy") ||
		getEnv("all_proxy");
	if (proxy && !proxy.includes("://")) {
		proxy = `${protocol}://${proxy}`;
	}
	return proxy;
}

export function hasProxyEnvironment(): boolean {
	if (typeof process === "undefined") return false;
	return PROXY_ENV_KEYS.some((key) => getEnv(key).length > 0);
}

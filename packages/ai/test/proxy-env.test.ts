import { afterEach, describe, expect, it } from "vitest";
import { getProxyForUrl, hasProxyEnvironment } from "../src/utils/proxy-env.ts";

const PROXY_ENV_KEYS = [
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
	"ALL_PROXY",
	"all_proxy",
	"NO_PROXY",
	"no_proxy",
	"npm_config_http_proxy",
	"npm_config_https_proxy",
	"npm_config_proxy",
	"npm_config_no_proxy",
];

const savedEnv = new Map<string, string | undefined>();

function clearProxyEnv(): void {
	for (const key of PROXY_ENV_KEYS) {
		if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
		delete process.env[key];
	}
}

function setProxyEnv(env: Record<string, string>): void {
	clearProxyEnv();
	for (const [key, value] of Object.entries(env)) {
		process.env[key] = value;
	}
}

afterEach(() => {
	for (const key of PROXY_ENV_KEYS) {
		const value = savedEnv.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	savedEnv.clear();
});

describe("proxy env resolution", () => {
	it("uses scheme-specific proxy variables", () => {
		setProxyEnv({ HTTPS_PROXY: "http://proxy.example:8080" });

		expect(getProxyForUrl("https://api.example/v1")).toBe("http://proxy.example:8080");
		expect(hasProxyEnvironment()).toBe(true);
	});

	it("adds the target scheme when a proxy URL has no scheme", () => {
		setProxyEnv({ http_proxy: "proxy.example:8080" });

		expect(getProxyForUrl("http://api.example/v1")).toBe("http://proxy.example:8080");
	});

	it("honors NO_PROXY exact hosts, suffixes, wildcards, and ports", () => {
		setProxyEnv({
			HTTPS_PROXY: "http://proxy.example:8080",
			NO_PROXY: "api.example,.internal,*.corp,other.example:8443",
		});

		expect(getProxyForUrl("https://api.example/v1")).toBe("");
		expect(getProxyForUrl("https://service.internal/v1")).toBe("");
		expect(getProxyForUrl("https://build.corp/v1")).toBe("");
		expect(getProxyForUrl("https://other.example:443/v1")).toBe("http://proxy.example:8080");
		expect(getProxyForUrl("https://other.example:8443/v1")).toBe("");
	});

	it("falls back to ALL_PROXY", () => {
		setProxyEnv({ ALL_PROXY: "http://proxy.example:8080" });

		expect(getProxyForUrl("https://api.example/v1")).toBe("http://proxy.example:8080");
	});
});

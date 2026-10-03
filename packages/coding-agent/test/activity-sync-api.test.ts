import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getActivitySyncWatermark, uploadSessionAnalytics } from "../src/core/activity-sync/api.ts";
import type { PiDevApiError } from "../src/core/pi-dev/http.ts";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("activity sync api", () => {
	it("reads watermarks", async () => {
		vi.stubEnv("PI_DEV_URL", "https://example.test");
		const urls: string[] = [];
		const fetchMock: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			urls.push(request.url);
			expect(request.headers.get("Authorization")).toBe("Bearer access-2");
			return jsonResponse({ ok: true, watermark: "2026-01-01T00:00:00.000Z" });
		};

		const watermark = await getActivitySyncWatermark("access-2", "device-1", {
			fetch: fetchMock,
		});

		expect(watermark.watermark).toBe("2026-01-01T00:00:00.000Z");
		expect(urls).toEqual(["https://example.test/analytics/activity/device-1"]);
	});

	it("uploads compressed NDJSON with sync headers and surfaces API errors", async () => {
		vi.stubEnv("PI_DEV_URL", "https://example.test");
		let request: Request | undefined;
		const fetchMock: typeof fetch = async (input, init) => {
			request = new Request(input, init);
			return jsonResponse(
				{
					ok: true,
					accepted: true,
					received_bytes: 10,
					watermark: "2026-01-02T00:00:00.000Z",
				},
				202,
			);
		};

		const response = await uploadSessionAnalytics({
			fetch: fetchMock,
			accessToken: "access-1",
			deviceId: "device-1",
			watermark: "2026-01-02T00:00:00.000Z",
			idempotencyKey: "retry-key",
			body: Buffer.from("payload"),
			contentEncoding: "zstd",
		});

		expect(response.accepted).toBe(true);
		expect(request?.headers.get("Authorization")).toBe("Bearer access-1");
		expect(request?.headers.get("Content-Type")).toBe("application/x-ndjson");
		expect(request?.headers.get("Content-Encoding")).toBe("zstd");
		expect(request?.headers.get("Pi-Sync-Watermark")).toBe("2026-01-02T00:00:00.000Z");
		expect(request?.headers.get("Idempotency-Key")).toBe("retry-key");

		const failingFetch: typeof fetch = async () =>
			jsonResponse({ ok: false, error: "invalid_payload", description: "bad line" }, 400);
		await expect(
			uploadSessionAnalytics({
				fetch: failingFetch,
				accessToken: "access-1",
				deviceId: "device-1",
				watermark: "2026-01-02T00:00:00.000Z",
				idempotencyKey: "retry-key",
				body: Buffer.from("payload"),
				contentEncoding: "zstd",
			}),
		).rejects.toMatchObject({
			name: "PiDevApiError",
			status: 400,
			errorCode: "invalid_payload",
			description: "bad line",
			operation: "POST /analytics/activity/:deviceId",
			message: "POST /analytics/activity/:deviceId failed: invalid_payload: bad line",
		} satisfies Partial<PiDevApiError>);
	});
});

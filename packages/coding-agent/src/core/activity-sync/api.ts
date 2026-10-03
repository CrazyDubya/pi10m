import type { Buffer } from "node:buffer";
import {
	getPiDevApiUrl,
	getPiDevFetch,
	isRecord,
	type PiDevApiOptions,
	readJson,
	requireNumber,
	requireString,
	throwIfPiDevNotOk,
} from "../pi-dev/http.ts";
export interface ActivitySyncWatermarkResponse {
	ok: true;
	watermark: string | null;
}

export interface ActivitySyncUploadResponse {
	ok: true;
	accepted: true;
	received_bytes: number;
	watermark: string;
}

export type ActivitySyncApiOptions = PiDevApiOptions;

export interface UploadSessionAnalyticsOptions extends ActivitySyncApiOptions {
	accessToken: string;
	deviceId: string;
	watermark: string;
	idempotencyKey: string;
	body: Buffer;
	contentEncoding: "zstd";
}

function parseWatermarkResponse(json: unknown): ActivitySyncWatermarkResponse {
	if (!isRecord(json) || json.ok !== true || (json.watermark !== null && typeof json.watermark !== "string")) {
		throw new Error("Invalid activity sync watermark response");
	}
	return { ok: true, watermark: json.watermark };
}

function parseUploadResponse(json: unknown): ActivitySyncUploadResponse {
	if (!isRecord(json) || json.ok !== true || json.accepted !== true) {
		throw new Error("Invalid activity sync upload response");
	}
	return {
		ok: true,
		accepted: true,
		received_bytes: requireNumber(json, "received_bytes", "activity sync upload response"),
		watermark: requireString(json, "watermark", "activity sync upload response"),
	};
}

export async function getActivitySyncWatermark(
	accessToken: string,
	deviceId: string,
	options: ActivitySyncApiOptions = {},
): Promise<ActivitySyncWatermarkResponse> {
	const response = await getPiDevFetch(options.fetch)(getPiDevApiUrl(`/analytics/activity/${deviceId}`), {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	await throwIfPiDevNotOk(response, "GET /analytics/activity/:deviceId");
	return parseWatermarkResponse(await readJson(response));
}

export async function uploadSessionAnalytics(
	options: UploadSessionAnalyticsOptions,
): Promise<ActivitySyncUploadResponse> {
	const response = await getPiDevFetch(options.fetch)(getPiDevApiUrl(`/analytics/activity/${options.deviceId}`), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${options.accessToken}`,
			"Content-Type": "application/x-ndjson",
			"Content-Encoding": options.contentEncoding,
			"Pi-Sync-Watermark": options.watermark,
			"Idempotency-Key": options.idempotencyKey,
		},
		body: options.body,
	});
	await throwIfPiDevNotOk(response, "POST /analytics/activity/:deviceId");
	return parseUploadResponse(await readJson(response));
}

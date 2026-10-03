import { Buffer } from "node:buffer";
import { promisify } from "node:util";
import { zstdCompress } from "node:zlib";
import type { SessionAnalyticsRecord } from "./session-analytics.ts";

export const ACTIVITY_SYNC_CONTENT_ENCODING = "zstd";
export const ACTIVITY_SYNC_MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
export const ACTIVITY_SYNC_MAX_DECOMPRESSED_BYTES = 75 * 1024 * 1024;

export interface BuildActivitySyncPayloadsOptions {
	records: SessionAnalyticsRecord[];
	scanCutoff: string;
	serverWatermark: string | null;
	maxCompressedBytes?: number;
	maxDecompressedBytes?: number;
	compress?: (input: Buffer) => Promise<Buffer>;
}

export interface ActivitySyncPayload {
	records: SessionAnalyticsRecord[];
	recordCount: number;
	firstRecordTimestamp: string;
	lastRecordTimestamp: string;
	watermark: string;
	contentEncoding: typeof ACTIVITY_SYNC_CONTENT_ENCODING;
	body: Buffer;
	decompressedBytes: number;
	compressedBytes: number;
}

type EncodedActivitySyncPayload = Omit<ActivitySyncPayload, "watermark" | "contentEncoding">;

function parseIsoTime(value: string): number {
	const time = new Date(value).getTime();
	if (Number.isNaN(time)) throw new Error(`Invalid session analytics timestamp: ${value}`);
	return time;
}

export function getSessionAnalyticsRecordTimestamp(record: SessionAnalyticsRecord): string {
	const timestamp = record.recordType === "entry" ? record.timestamp : (record.createdAt ?? record.modifiedAt);
	if (!timestamp) {
		throw new Error(`Session analytics ${record.recordType} record is missing a timestamp`);
	}
	parseIsoTime(timestamp);
	return timestamp;
}

export function compareSessionAnalyticsRecords(a: SessionAnalyticsRecord, b: SessionAnalyticsRecord): number {
	const aTimestamp = getSessionAnalyticsRecordTimestamp(a);
	const bTimestamp = getSessionAnalyticsRecordTimestamp(b);
	const byTime = parseIsoTime(aTimestamp) - parseIsoTime(bTimestamp);
	if (byTime !== 0) return byTime;
	if (a.recordType !== b.recordType) return a.recordType === "session" ? -1 : 1;
	const aSessionId = a.sessionId;
	const bSessionId = b.sessionId;
	const bySession = aSessionId.localeCompare(bSessionId);
	if (bySession !== 0) return bySession;
	const aEntryId = a.recordType === "entry" ? a.entryId : "";
	const bEntryId = b.recordType === "entry" ? b.entryId : "";
	return aEntryId.localeCompare(bEntryId);
}

export function sortSessionAnalyticsRecords(records: SessionAnalyticsRecord[]): SessionAnalyticsRecord[] {
	return [...records].sort(compareSessionAnalyticsRecords);
}

export function serializeSessionAnalyticsNdjson(records: SessionAnalyticsRecord[]): Buffer {
	if (records.length === 0) throw new Error("Session analytics upload has no records");
	return Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

async function compressActivitySyncNdjson(
	input: Buffer,
	compress: ((input: Buffer) => Promise<Buffer>) | undefined,
): Promise<Buffer> {
	if (compress) return compress(input);
	if (typeof zstdCompress !== "function") {
		throw new Error(
			"Activity sync requires Node zstd compression support, but node:zlib.zstdCompress is unavailable",
		);
	}
	const compressed = await promisify(zstdCompress)(input);
	return Buffer.from(compressed);
}

function getRecordGroups(records: SessionAnalyticsRecord[]): SessionAnalyticsRecord[][] {
	const groups: SessionAnalyticsRecord[][] = [];
	for (const record of records) {
		const timestamp = getSessionAnalyticsRecordTimestamp(record);
		const previousGroup = groups.at(-1);
		if (previousGroup && getSessionAnalyticsRecordTimestamp(previousGroup[0]) === timestamp) {
			previousGroup.push(record);
		} else {
			groups.push([record]);
		}
	}
	return groups;
}

function getPayloadWatermark(
	payload: EncodedActivitySyncPayload,
	isFinalPayload: boolean,
	scanCutoff: string,
	serverWatermark: string | null,
): string {
	if (isFinalPayload) return scanCutoff;
	if (serverWatermark && parseIsoTime(payload.lastRecordTimestamp) <= parseIsoTime(serverWatermark))
		return serverWatermark;
	return payload.lastRecordTimestamp;
}

async function encodeActivitySyncPayload(
	records: SessionAnalyticsRecord[],
	maxCompressedBytes: number,
	maxDecompressedBytes: number,
	compress: ((input: Buffer) => Promise<Buffer>) | undefined,
): Promise<EncodedActivitySyncPayload | undefined> {
	const ndjson = serializeSessionAnalyticsNdjson(records);
	if (ndjson.byteLength > maxDecompressedBytes) return undefined;
	const body = await compressActivitySyncNdjson(ndjson, compress);
	if (body.byteLength > maxCompressedBytes) return undefined;
	return {
		records,
		recordCount: records.length,
		firstRecordTimestamp: getSessionAnalyticsRecordTimestamp(records[0]),
		lastRecordTimestamp: getSessionAnalyticsRecordTimestamp(records[records.length - 1]),
		body,
		decompressedBytes: ndjson.byteLength,
		compressedBytes: body.byteLength,
	};
}

function withPayloadWatermark(payload: EncodedActivitySyncPayload, watermark: string): ActivitySyncPayload {
	return {
		...payload,
		watermark,
		contentEncoding: ACTIVITY_SYNC_CONTENT_ENCODING,
	};
}

export async function buildActivitySyncPayloads(
	options: BuildActivitySyncPayloadsOptions,
): Promise<ActivitySyncPayload[]> {
	if (options.records.length === 0) throw new Error("Session analytics upload has no records");
	const maxCompressedBytes = options.maxCompressedBytes ?? ACTIVITY_SYNC_MAX_COMPRESSED_BYTES;
	const maxDecompressedBytes = options.maxDecompressedBytes ?? ACTIVITY_SYNC_MAX_DECOMPRESSED_BYTES;
	const sortedRecords = sortSessionAnalyticsRecords(options.records);
	const compress = options.compress;

	const singlePayload = await encodeActivitySyncPayload(
		sortedRecords,
		maxCompressedBytes,
		maxDecompressedBytes,
		compress,
	);
	if (singlePayload) return [withPayloadWatermark(singlePayload, options.scanCutoff)];

	const batches: EncodedActivitySyncPayload[] = [];
	let current: EncodedActivitySyncPayload | undefined;
	for (const group of getRecordGroups(sortedRecords)) {
		const candidateRecords = current ? [...current.records, ...group] : group;
		const candidate = await encodeActivitySyncPayload(
			candidateRecords,
			maxCompressedBytes,
			maxDecompressedBytes,
			compress,
		);
		if (candidate) {
			current = candidate;
			continue;
		}

		if (!current) throw new Error("Session analytics records with the same timestamp exceed the upload size limit");
		batches.push(current);
		const next = await encodeActivitySyncPayload(group, maxCompressedBytes, maxDecompressedBytes, compress);
		if (!next) throw new Error("Session analytics records with the same timestamp exceed the upload size limit");
		current = next;
	}
	if (current) batches.push(current);

	return batches.map((batch, index) =>
		withPayloadWatermark(
			batch,
			getPayloadWatermark(batch, index === batches.length - 1, options.scanCutoff, options.serverWatermark),
		),
	);
}

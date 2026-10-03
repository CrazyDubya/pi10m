import { projectSessionForAnalytics, type SessionAnalyticsRecord } from "./session-analytics.ts";
import { discoverSessions, type SessionDiscoveryProgressCallback } from "./session-discovery.ts";
import { readSessionFile } from "./session-file.ts";

export interface BuildSessionAnalyticsUploadOptions {
	/** Server watermark from GET /analytics/activity/:deviceId. */
	serverWatermark: string | null;
	/** Root sessions directory. Defaults to ~/.pi/agent/sessions. */
	sessionsRoot?: string;
	scanCutoff?: Date;
	signal?: AbortSignal;
	onDiscoveryProgress?: SessionDiscoveryProgressCallback;
}

export interface BuildSessionAnalyticsUploadResult {
	records: SessionAnalyticsRecord[];
	scanCutoff: string;
	filesScanned: number;
	malformedFiles: number;
}

function parseIsoTime(value: string): number | undefined {
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? undefined : time;
}

function getRecordTimestamp(record: SessionAnalyticsRecord): string | undefined {
	if (record.recordType === "entry") return record.timestamp;
	return record.createdAt ?? record.modifiedAt;
}

function recordIsBeforeScanCutoff(record: SessionAnalyticsRecord, scanCutoffTime: number): boolean {
	const timestamp = getRecordTimestamp(record);
	if (!timestamp) return false;
	const recordTime = parseIsoTime(timestamp);
	return recordTime !== undefined && recordTime < scanCutoffTime;
}

export async function buildSessionAnalyticsUpload(
	options: BuildSessionAnalyticsUploadOptions,
): Promise<BuildSessionAnalyticsUploadResult> {
	const scanCutoff = options.scanCutoff ?? new Date();
	const scanCutoffTime = scanCutoff.getTime();
	const serverWatermarkTime = options.serverWatermark ? parseIsoTime(options.serverWatermark) : undefined;
	const sessions = await discoverSessions({
		sessionsRoot: options.sessionsRoot,
		signal: options.signal,
		onProgress: options.onDiscoveryProgress,
	});
	const records: SessionAnalyticsRecord[] = [];
	let filesScanned = 0;
	let malformedFiles = 0;

	for (const session of sessions) {
		if (options.signal?.aborted) break;
		if (serverWatermarkTime !== undefined && session.modifiedAt.getTime() <= serverWatermarkTime) continue;
		filesScanned++;
		const parsed = await readSessionFile(session.path).catch(() => undefined);
		if (!parsed) {
			malformedFiles++;
			continue;
		}
		const projectedRecords = projectSessionForAnalytics(parsed.header, parsed.entries, {
			modifiedAt: session.modifiedAt,
		});
		records.push(...projectedRecords.filter((record) => recordIsBeforeScanCutoff(record, scanCutoffTime)));
	}

	return {
		records,
		scanCutoff: scanCutoff.toISOString(),
		filesScanned,
		malformedFiles,
	};
}

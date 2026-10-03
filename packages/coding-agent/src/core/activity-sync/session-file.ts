import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionEntry, SessionHeader } from "../session-manager.ts";

export interface ParsedSessionFile {
	header: SessionHeader;
	entries: SessionEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSessionHeader(value: unknown): SessionHeader | undefined {
	if (!isRecord(value)) return undefined;
	if (value.type !== "session") return undefined;
	if (typeof value.id !== "string" || !value.id) return undefined;
	if (typeof value.timestamp !== "string" || !value.timestamp) return undefined;
	if (typeof value.cwd !== "string") return undefined;
	if (value.version !== undefined && typeof value.version !== "number") return undefined;
	if (value.parentSession !== undefined && typeof value.parentSession !== "string") return undefined;
	return {
		type: "session",
		version: value.version,
		id: value.id,
		timestamp: value.timestamp,
		cwd: value.cwd,
		parentSession: value.parentSession,
	};
}

function parseSessionEntry(value: unknown): SessionEntry | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.type !== "string" || value.type === "session") return undefined;
	if (typeof value.id !== "string" || !value.id) return undefined;
	if (value.parentId !== null && typeof value.parentId !== "string") return undefined;
	if (typeof value.timestamp !== "string" || !value.timestamp) return undefined;
	// Projection handles entry-type-specific fields defensively; the file boundary only requires the common session entry shape.
	return value as unknown as SessionEntry;
}

async function readSessionJsonl(path: string, includeEntries: boolean): Promise<ParsedSessionFile | undefined> {
	const stream = createReadStream(path, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	let header: SessionHeader | undefined;
	const entries: SessionEntry[] = [];

	try {
		for await (const line of lines) {
			if (!line.trim()) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line) as unknown;
			} catch {
				return undefined;
			}

			if (!header) {
				header = parseSessionHeader(parsed);
				if (!header) return undefined;
				if (!includeEntries) return { header, entries };
				continue;
			}

			const entry = parseSessionEntry(parsed);
			if (!entry) return undefined;
			entries.push(entry);
		}
	} finally {
		lines.close();
		stream.destroy();
	}

	return header ? { header, entries } : undefined;
}

export async function readSessionHeader(path: string): Promise<SessionHeader | undefined> {
	return (await readSessionJsonl(path, false))?.header;
}

export async function readSessionFile(path: string): Promise<ParsedSessionFile | undefined> {
	return readSessionJsonl(path, true);
}

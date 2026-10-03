import { describe, expect, it } from "vitest";
import { CURSOR_MARKER, stripCursorMarker } from "../src/tui.ts";

describe("native hardware cursor", () => {
	it("keeps the reverse-video cursor when native mode is off", () => {
		const line = `ab${CURSOR_MARKER}\x1b[7mX\x1b[27mcd`;
		expect(stripCursorMarker(line, false)).toBe("ab\x1b[7mX\x1b[27mcd");
	});

	it("drops the reverse-video software cursor in native mode", () => {
		const line = `ab${CURSOR_MARKER}\x1b[7mX\x1b[27mcd`;
		expect(stripCursorMarker(line, true)).toBe("abXcd");
	});
});

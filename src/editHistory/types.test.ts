import { describe, it, expect } from "vitest";
import {
	type VersionSnapshot,
	type FileHistoryEntry,
	type EditHistoryData,
	DEFAULT_EDIT_HISTORY_DATA,
} from "./types";

describe("VersionSnapshot", () => {
	it("can hold a base version with full content", () => {
		const snap: VersionSnapshot = {
			ts: 1713123500000,
			device: "Alice-Laptop",
			content: "# Full content",
		};
		expect(snap.content).toBe("# Full content");
		expect(snap.hunks).toBeUndefined();
	});

	it("can hold a delta version with line hunks", () => {
		const snap: VersionSnapshot = {
			ts: 1713123800000,
			device: "Bob-Phone",
			hunks: [{ s: 0, d: 0, a: ["added text"] }],
		};
		expect(snap.hunks).toEqual([{ s: 0, d: 0, a: ["added text"] }]);
		expect(snap.content).toBeUndefined();
	});
});

describe("FileHistoryEntry", () => {
	it("holds path, baseIndex, and versions array", () => {
		const entry: FileHistoryEntry = {
			path: "notes/project-plan.md",
			baseIndex: 0,
			versions: [
				{ ts: 1713123500000, device: "Alice-Laptop", content: "# Hello" },
			],
		};
		expect(entry.path).toBe("notes/project-plan.md");
		expect(entry.baseIndex).toBe(0);
		expect(entry.versions).toHaveLength(1);
	});
});

describe("EditHistoryData", () => {
	it("has version and entries map", () => {
		const data: EditHistoryData = {
			version: 2,
			entries: {},
		};
		expect(data.version).toBe(2);
		expect(Object.keys(data.entries)).toHaveLength(0);
	});

	it("maps file IDs to FileHistoryEntry", () => {
		const data: EditHistoryData = {
			version: 2,
			entries: {
				"abc123": {
					path: "notes/test.md",
					baseIndex: 0,
					versions: [
						{ ts: 1000, device: "Dev1", content: "hello" },
					],
				},
			},
		};
		expect(data.entries["abc123"]).toBeDefined();
		expect(data.entries["abc123"]!.path).toBe("notes/test.md");
	});
});

describe("DEFAULT_EDIT_HISTORY_DATA", () => {
	it("returns a fresh empty EditHistoryData with version 2", () => {
		const data = DEFAULT_EDIT_HISTORY_DATA();
		expect(data).toEqual({ version: 2, entries: {} });
	});

	it("returns a new object each call (no shared mutation)", () => {
		const a = DEFAULT_EDIT_HISTORY_DATA();
		const b = DEFAULT_EDIT_HISTORY_DATA();
		a.entries["x"] = {
			path: "test.md",
			baseIndex: 0,
			versions: [],
		};
		expect(b.entries["x"]).toBeUndefined();
	});
});

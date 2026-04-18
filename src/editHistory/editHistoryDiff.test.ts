import { describe, it, expect } from "vitest";
import { computeLineHunks } from "./editHistoryDiff";

describe("computeLineHunks", () => {
	it("emits a single replace-one-line hunk for middle-line substitution", () => {
		const hunks = computeLineHunks("a\nb\nc", "a\nX\nc");
		expect(hunks).toEqual([{ s: 1, d: 1, a: ["X"] }]);
	});

	it("returns a single insert-everything hunk when old is empty", () => {
		const hunks = computeLineHunks("", "a\nb\nc");
		expect(hunks).toEqual([{ s: 0, d: 0, a: ["a", "b", "c"] }]);
	});

	it("returns a single delete-everything hunk when new is empty", () => {
		const hunks = computeLineHunks("a\nb\nc", "");
		expect(hunks).toEqual([{ s: 0, d: 3, a: [] }]);
	});

	it("returns empty array when content is unchanged", () => {
		expect(computeLineHunks("x\ny\nz", "x\ny\nz")).toEqual([]);
	});

	it("emits one hunk at s=0 for prepended lines", () => {
		const hunks = computeLineHunks("a\nb", "HEAD\na\nb");
		expect(hunks).toEqual([{ s: 0, d: 0, a: ["HEAD"] }]);
	});

	it("emits one hunk at s=N for appended lines", () => {
		// diff-match-patch line-mode treats "b" (no trailing newline) as a
		// distinct token from "b\n", so appending produces a single hunk that
		// replaces the old last line with [<old last line>, ...appended lines].
		// Roundtrips cleanly through applyLineHunks.
		const hunks = computeLineHunks("a\nb", "a\nb\nTAIL");
		expect(hunks).toEqual([{ s: 1, d: 1, a: ["b", "TAIL"] }]);
	});

	it("emits a d>0, a=[] hunk for a pure deletion", () => {
		const hunks = computeLineHunks("a\nb\nc", "a\nc");
		expect(hunks).toEqual([{ s: 1, d: 1, a: [] }]);
	});

	it("emits one hunk with d>0 and a.length>0 for a multi-line replacement", () => {
		const hunks = computeLineHunks("a\nX\nY\nb", "a\nP\nQ\nR\nb");
		expect(hunks).toEqual([{ s: 1, d: 2, a: ["P", "Q", "R"] }]);
	});

	it("emits two hunks for two disjoint changes", () => {
		const hunks = computeLineHunks("a\nb\nc\nd\ne", "A\nb\nc\nd\nE");
		expect(hunks.length).toBe(2);
		expect(hunks[0]).toEqual({ s: 0, d: 1, a: ["A"] });
		expect(hunks[1]).toEqual({ s: 4, d: 1, a: ["E"] });
	});
});

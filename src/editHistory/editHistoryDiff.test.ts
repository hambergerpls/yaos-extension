import { describe, it, expect } from "vitest";
import { computeLineHunks, applyLineHunks, reconstructVersion } from "./editHistoryDiff";
import type { FileHistoryEntry } from "./types";

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
		const hunks = computeLineHunks("a\nb", "a\nb\nTAIL");
		expect(hunks).toEqual([{ s: 2, d: 0, a: ["TAIL"] }]);
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

	it("treats trailing newline as a retained empty line", () => {
		// "a\nb\n" is 2 real lines + a trailing empty line (convention).
		// Changing "b" to "B" while keeping the trailing newline produces s=1, d=1.
		const hunks = computeLineHunks("a\nb\n", "a\nB\n");
		expect(hunks).toEqual([{ s: 1, d: 1, a: ["B"] }]);
	});
});

describe("applyLineHunks", () => {
	it("splices a single replace-one-line hunk", () => {
		const result = applyLineHunks("a\nb\nc", [{ s: 1, d: 1, a: ["X"] }]);
		expect(result).toBe("a\nX\nc");
	});

	it("is identity when hunks is empty", () => {
		expect(applyLineHunks("a\nb\nc", [])).toBe("a\nb\nc");
	});

	it("prepends lines for a hunk at s=0 with d=0", () => {
		expect(applyLineHunks("a\nb", [{ s: 0, d: 0, a: ["HEAD"] }])).toBe("HEAD\na\nb");
	});

	it("appends lines for a hunk at s=N with d=0", () => {
		expect(applyLineHunks("a\nb", [{ s: 2, d: 0, a: ["TAIL"] }])).toBe("a\nb\nTAIL");
	});

	it("produces full content from empty base", () => {
		expect(applyLineHunks("", [{ s: 0, d: 0, a: ["a", "b", "c"] }])).toBe("a\nb\nc");
	});

	it("produces empty string when all lines are deleted", () => {
		expect(applyLineHunks("a\nb\nc", [{ s: 0, d: 3, a: [] }])).toBe("");
	});

	it("applies multiple disjoint hunks", () => {
		const result = applyLineHunks(
			"a\nb\nc\nd\ne",
			[
				{ s: 0, d: 1, a: ["A"] },
				{ s: 4, d: 1, a: ["E"] },
			],
		);
		expect(result).toBe("A\nb\nc\nd\nE");
	});
});

describe("computeLineHunks + applyLineHunks roundtrip", () => {
	const cases: Array<[string, string]> = [
		["", ""],
		["a", "a"],
		["a\nb\nc", "a\nb\nc"],
		["", "hello"],
		["hello", ""],
		["", "a\nb\nc"],
		["a\nb\nc", ""],
		["a\nb\nc", "a\nX\nc"],
		["a\nb\nc", "a\nb\nc\nd"],
		["a\nb\nc", "HEAD\na\nb\nc"],
		["a\nb\nc\nd\ne", "A\nb\nc\nd\nE"],
		["one\ntwo\nthree", "one\ntwo\nthree\nfour\nfive"],
		["alpha\nbeta\ngamma", "alpha\ngamma"],
		["a\nb", "x\ny"],
		["line1\nline2\nline3\n", "line1\nMODIFIED\nline3\n"],
		["trailing\n", "trailing\nextra\n"],
		["no-trailing", "no-trailing\n"],
		["with-trailing\n", "without-trailing"],
		["a\n\nb", "a\nc\nb"],
		["a\nb\nc\nd\ne\nf\ng\nh", "a\nB\nc\nd\ne\nf\ng\nH"],
	];

	for (const [old, next] of cases) {
		it(`roundtrips ${JSON.stringify(old)} → ${JSON.stringify(next)}`, () => {
			const hunks = computeLineHunks(old, next);
			expect(applyLineHunks(old, hunks)).toBe(next);
		});
	}
});

describe("reconstructVersion", () => {
	it("returns base content when requesting the base version", () => {
		const entry: FileHistoryEntry = {
			path: "t.md",
			baseIndex: 0,
			versions: [
				{ ts: 1, device: "d", content: "hello" },
				{ ts: 2, device: "d", hunks: [{ s: 1, d: 0, a: ["world"] }] },
			],
		};
		expect(reconstructVersion(entry, 0)).toBe("hello");
	});

	it("applies a single hunks-delta from the base", () => {
		const entry: FileHistoryEntry = {
			path: "t.md", baseIndex: 0,
			versions: [
				{ ts: 1, device: "d", content: "hello" },
				{ ts: 2, device: "d", hunks: [{ s: 1, d: 0, a: ["world"] }] },
			],
		};
		expect(reconstructVersion(entry, 1)).toBe("hello\nworld");
	});

	it("applies multiple hunks-deltas in sequence", () => {
		const entry: FileHistoryEntry = {
			path: "t.md", baseIndex: 0,
			versions: [
				{ ts: 1, device: "d", content: "a" },
				{ ts: 2, device: "d", hunks: [{ s: 1, d: 0, a: ["b"] }] },
				{ ts: 3, device: "d", hunks: [{ s: 2, d: 0, a: ["c"] }] },
			],
		};
		expect(reconstructVersion(entry, 2)).toBe("a\nb\nc");
	});
});

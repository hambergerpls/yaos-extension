import { describe, it, expect } from "vitest";
import {
	computeDiff,
	applyDiff,
	reconstructVersion,
	computeDiffSummary,
	segmentLines,
	buildHunks,
	DEFAULT_CONTEXT_LINES,
	type DiffSummary,
	type DiffLine,
	type HunkItem,
} from "./editHistoryDiff";
import type { FileHistoryEntry, VersionSnapshot } from "./types";

describe("computeDiff", () => {
	it("returns empty diff for identical content", () => {
		const result = computeDiff("hello world", "hello world");
		expect(result).toEqual([[0, "hello world"]]);
	});

	it("computes an insert diff", () => {
		const result = computeDiff("hello", "hello world");
		const inserted = result.filter(([op]) => op === 1);
		expect(inserted.length).toBeGreaterThan(0);
	});

	it("computes a delete diff", () => {
		const result = computeDiff("hello world", "hello");
		const deleted = result.filter(([op]) => op === -1);
		expect(deleted.length).toBeGreaterThan(0);
	});

	it("roundtrips: applyDiff(oldContent, computeDiff(old, new)) === new", () => {
		const oldContent = "line1\nline2\nline3\n";
		const newContent = "line1\nmodified line2\nline3\nline4\n";
		const diff = computeDiff(oldContent, newContent);
		expect(applyDiff(oldContent, diff)).toBe(newContent);
	});
});

describe("applyDiff", () => {
	it("reproduces the original when diff says keep all", () => {
		const content = "some text here";
		const diff: [number, string][] = [[0, content]];
		expect(applyDiff("", diff)).toBe(content);
	});

	it("applies insert operations", () => {
		const diff: [number, string][] = [[1, "inserted"]];
		expect(applyDiff("", diff)).toBe("inserted");
	});

	it("applies delete operations", () => {
		const diff: [number, string][] = [[-1, "del"], [0, "ete me"]];
		expect(applyDiff("delete me", diff)).toBe("ete me");
	});

	it("applies mixed operations in order", () => {
		const diff: [number, string][] = [
			[0, "abc"],
			[-1, "XXX"],
			[1, "YYY"],
			[0, "def"],
		];
		expect(applyDiff("abcXXXdef", diff)).toBe("abcYYYdef");
	});
});

describe("reconstructVersion", () => {
	it("returns base content when requesting the base version", () => {
		const entry: FileHistoryEntry = {
			path: "test.md",
			baseIndex: 0,
			versions: [
				{ ts: 1000, device: "Dev1", content: "original" },
				{ ts: 2000, device: "Dev2", diff: [[1, " more"]] },
			],
		};
		expect(reconstructVersion(entry, 0)).toBe("original");
	});

	it("applies a single delta from the base", () => {
		const entry: FileHistoryEntry = {
			path: "test.md",
			baseIndex: 0,
			versions: [
				{ ts: 1000, device: "Dev1", content: "hello" },
				{ ts: 2000, device: "Dev2", diff: [[0, "hello"], [1, " world"]] },
			],
		};
		expect(reconstructVersion(entry, 1)).toBe("hello world");
	});

	it("applies multiple deltas in sequence", () => {
		const entry: FileHistoryEntry = {
			path: "test.md",
			baseIndex: 0,
			versions: [
				{ ts: 1000, device: "Dev1", content: "a" },
				{ ts: 2000, device: "Dev2", diff: [[0, "a"], [1, "b"]] },
				{ ts: 3000, device: "Dev3", diff: [[0, "ab"], [1, "c"]] },
			],
		};
		expect(reconstructVersion(entry, 2)).toBe("abc");
	});

	it("works with a rebased (non-zero) baseIndex", () => {
		const entry: FileHistoryEntry = {
			path: "test.md",
			baseIndex: 2,
			versions: [
				{ ts: 1000, device: "Dev1", diff: [[1, "x"]] },
				{ ts: 2000, device: "Dev2", diff: [[1, "x"]] },
				{ ts: 3000, device: "Dev3", content: "rebased" },
				{ ts: 4000, device: "Dev1", diff: [[0, "rebased"], [1, "!"]] },
			],
		};
		expect(reconstructVersion(entry, 3)).toBe("rebased!");
	});

	it("returns null when version index is out of bounds", () => {
		const entry: FileHistoryEntry = {
			path: "test.md",
			baseIndex: 0,
			versions: [{ ts: 1000, device: "Dev1", content: "hi" }],
		};
		expect(reconstructVersion(entry, 5)).toBeNull();
	});

	it("returns null when base version has no content (corrupt chain)", () => {
		const entry: FileHistoryEntry = {
			path: "test.md",
			baseIndex: 0,
			versions: [{ ts: 1000, device: "Dev1", diff: [[1, "x"]] }],
		};
		expect(reconstructVersion(entry, 0)).toBeNull();
	});

	it("returns null for empty versions array", () => {
		const entry: FileHistoryEntry = {
			path: "test.md",
			baseIndex: 0,
			versions: [],
		};
		expect(reconstructVersion(entry, 0)).toBeNull();
	});
});

describe("computeDiffSummary", () => {
	it("returns zero counts for an equal-only diff", () => {
		const diff: [number, string][] = [[0, "hello world"]];
		expect(computeDiffSummary(diff)).toEqual({ added: 0, removed: 0 });
	});

	it("counts added lines", () => {
		const diff: [number, string][] = [[1, "new line 1\nnew line 2\n"]];
		expect(computeDiffSummary(diff)).toEqual({ added: 2, removed: 0 });
	});

	it("counts removed lines", () => {
		const diff: [number, string][] = [[-1, "gone line 1\ngone line 2\ngone line 3\n"]];
		expect(computeDiffSummary(diff)).toEqual({ added: 0, removed: 3 });
	});

	it("counts mixed additions and removals across multiple ops", () => {
		const diff: [number, string][] = [
			[0, "keep\n"],
			[-1, "old line\n"],
			[1, "new line\n"],
		];
		expect(computeDiffSummary(diff)).toEqual({ added: 1, removed: 1 });
	});

	it("does not count trailing content without newline as a line", () => {
		const diff: [number, string][] = [[1, "no newline here"]];
		expect(computeDiffSummary(diff)).toEqual({ added: 1, removed: 0 });
	});

	it("counts a single newline-only insert as 1 line", () => {
		const diff: [number, string][] = [[1, "\n"]];
		expect(computeDiffSummary(diff)).toEqual({ added: 1, removed: 0 });
	});
});

describe("segmentLines", () => {
	it("segments a single retain op into one retain line", () => {
		const result: DiffLine[] = segmentLines([[0, "hello"]]);
		expect(result).toEqual([{ kind: "retain", text: "hello" }]);
	});

	it("splits a multi-line retain into per-line rows", () => {
		const result = segmentLines([[0, "a\nb\nc"]]);
		expect(result).toEqual([
			{ kind: "retain", text: "a" },
			{ kind: "retain", text: "b" },
			{ kind: "retain", text: "c" },
		]);
	});

	it("drops trailing newline (no empty row)", () => {
		const result = segmentLines([[0, "a\n"]]);
		expect(result).toEqual([{ kind: "retain", text: "a" }]);
	});

	it("emits retain then add for insert at end of line", () => {
		const result = segmentLines([[0, "old\n"], [1, "new"]]);
		expect(result).toEqual([
			{ kind: "retain", text: "old" },
			{ kind: "add", text: "new" },
		]);
	});

	it("emits retain then del for delete at end of line", () => {
		const result = segmentLines([[0, "keep\n"], [-1, "gone"]]);
		expect(result).toEqual([
			{ kind: "retain", text: "keep" },
			{ kind: "del", text: "gone" },
		]);
	});

	it("emits del+add pair for a changed line (substitution)", () => {
		const result = segmentLines([[0, "hello "], [-1, "world"], [1, "there"]]);
		expect(result).toEqual([
			{ kind: "del", text: "hello world" },
			{ kind: "add", text: "hello there" },
		]);
	});

	it("emits del+add pair then retain for change followed by unchanged line", () => {
		const result = segmentLines([
			[0, "hello "],
			[-1, "world"],
			[1, "there"],
			[0, "\nnext"],
		]);
		expect(result).toEqual([
			{ kind: "del", text: "hello world" },
			{ kind: "add", text: "hello there" },
			{ kind: "retain", text: "next" },
		]);
	});

	it("splits a multi-line insert into per-line add rows", () => {
		const result = segmentLines([
			[0, "a\n"],
			[1, "x\ny\n"],
			[0, "b"],
		]);
		expect(result).toEqual([
			{ kind: "retain", text: "a" },
			{ kind: "add", text: "x" },
			{ kind: "add", text: "y" },
			{ kind: "retain", text: "b" },
		]);
	});

	it("splits a multi-line delete into per-line del rows", () => {
		const result = segmentLines([
			[0, "a\n"],
			[-1, "x\ny\n"],
			[0, "b"],
		]);
		expect(result).toEqual([
			{ kind: "retain", text: "a" },
			{ kind: "del", text: "x" },
			{ kind: "del", text: "y" },
			{ kind: "retain", text: "b" },
		]);
	});

	it("emits retain/del/retain when a full line is deleted", () => {
		const result = segmentLines([[0, "a\n"], [-1, "b\n"], [0, "c"]]);
		expect(result).toEqual([
			{ kind: "retain", text: "a" },
			{ kind: "del", text: "b" },
			{ kind: "retain", text: "c" },
		]);
	});

	it("emits retain/add/retain when a full line is inserted", () => {
		const result = segmentLines([[0, "a\n"], [1, "b\n"], [0, "c"]]);
		expect(result).toEqual([
			{ kind: "retain", text: "a" },
			{ kind: "add", text: "b" },
			{ kind: "retain", text: "c" },
		]);
	});
});

describe("buildHunks", () => {
	it("returns empty array when there are no changes", () => {
		const lines: DiffLine[] = [
			{ kind: "retain", text: "a" },
			{ kind: "retain", text: "b" },
		];
		expect(buildHunks(lines, 3)).toEqual([]);
	});

	it("emits one hunk for a single add with no surrounding retains", () => {
		const lines: DiffLine[] = [{ kind: "add", text: "x" }];
		expect(buildHunks(lines, 3)).toEqual([
			{ kind: "hunk", lines: [{ kind: "add", text: "x" }] },
		]);
	});

	it("emits one hunk with all 5 lines when ≤ context on each side", () => {
		const lines: DiffLine[] = [
			{ kind: "retain", text: "r1" },
			{ kind: "retain", text: "r2" },
			{ kind: "add", text: "a" },
			{ kind: "retain", text: "r3" },
			{ kind: "retain", text: "r4" },
		];
		const result = buildHunks(lines, 3);
		expect(result.length).toBe(1);
		expect(result[0]!.kind).toBe("hunk");
		expect((result[0] as any).lines.length).toBe(5);
	});
});

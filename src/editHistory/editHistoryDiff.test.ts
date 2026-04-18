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
});

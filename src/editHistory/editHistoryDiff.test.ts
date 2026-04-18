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
});

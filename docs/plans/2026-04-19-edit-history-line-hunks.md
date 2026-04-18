# Edit History — Line-Oriented Hunk Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace character-level `DiffOp[]` (`fast-diff`) in edit-history delta storage with minimal line-hunks `{s,d,a}` (`diff-match-patch` line-mode), reducing on-disk file size by ~90% on typical edits. Breaking schema change from `version: 1` to `version: 2` with silent wipe on upgrade.

**Architecture:** `VersionSnapshot.diff: DiffOp[]` → `VersionSnapshot.hunks: LineHunk[]` where `LineHunk = {s:number, d:number, a:string[]}`. Old lines are implicit (derived from the reconstructed previous version). `computeLineHunks(old,new)` uses `diff-match-patch`'s `diff_linesToChars_` / `diff_charsToLines_` line-mode trick. `applyLineHunks(base, hunks)` splits the base on `\n`, splices each hunk in ascending `s`, rejoins. Sidebar renderer derives a `DiffLine[]` view model by walking `prevLines` + `hunks`, then feeds existing `buildHunks` windowing + existing row-rendering DOM code. All legacy char-op types (`DiffOp`, `computeDiff`, `applyDiff`, `segmentLines`) are deleted.

**Tech Stack:** TypeScript strict, Vitest, esbuild, `diff-match-patch` (replaces `fast-diff`), Obsidian `ItemView` DOM API, jsdom for tests.

**Pre-reading:** `src/AGENTS.md` module graph, `src/editHistory/types.ts`, `src/editHistory/editHistoryDiff.ts` (current implementation), `src/editHistory/editHistoryView.ts:284-367` (the two diff rendering branches being migrated), and the two prior executed plans `docs/plans/2026-04-18-edit-history-inline-diff.md` + `docs/plans/2026-04-18-edit-history-github-hunks.md` for code style conventions.

**Commit protocol** (inherited from prior sessions):
- One commit per step (RED commit, GREEN commit, each added test case = own commit).
- Commit messages: `test(editHistory): RED — <behavior>`, `feat(editHistory): GREEN — <behavior>`, `refactor(editHistory): <what>`, `chore(deps): swap fast-diff for diff-match-patch`, `docs(editHistory): update AGENTS.md for line-hunks`.
- Do NOT push. User will approve push explicitly at end.
- Verification before every commit: `npx vitest run` fully green (except intentionally RED tests, which are committed immediately after verifying they fail for the right reason — then GREEN in the next commit).
- Build verification at end: `npm run build` exits 0.

---

## Baseline (must verify before starting)

Run:
```bash
npx vitest run
npm run build
git status --short
```

Expected:
- Vitest: 448 tests passing.
- Build: exits 0.
- Git: clean working tree.

If any of those fail, **stop and report** — do not start the plan on a dirty baseline.

---

## Task 1: Save this plan

**Files:**
- Create: `docs/plans/2026-04-19-edit-history-line-hunks.md`

**Step 1:** The file you're reading is the plan. If you're executing in a fresh session, this file already exists.

**Step 2:** Commit.

```bash
git add docs/plans/2026-04-19-edit-history-line-hunks.md
git commit -m "docs: add plan for line-oriented hunk storage"
```

---

## Task 2: Add `diff-match-patch` dependency, remove `fast-diff`

**Files:**
- Modify: `package.json`

**Step 1: Swap deps**

Run:
```bash
npm install diff-match-patch
npm install --save-dev @types/diff-match-patch
npm uninstall fast-diff @types/fast-diff
```

**Step 2: Verify dep swap**

Check `package.json`:
- `dependencies` contains `diff-match-patch`, not `fast-diff`.
- `devDependencies` contains `@types/diff-match-patch`, not `@types/fast-diff`.

**Step 3: Verify build is broken (expected)**

```bash
npm run build
```

Expected: TypeScript errors in `editHistoryDiff.ts` because `fast-diff` no longer exists. This is expected. Tests will also fail. Do NOT commit yet — we commit the dep swap together with the first replacement code in Task 4 to avoid a broken intermediate state in the git log.

**Step 4: Stash the changes temporarily**

```bash
git stash push -m "dep-swap-pending" -- package.json package-lock.json
```

Leave `node_modules/` as-is (it now has `diff-match-patch`). We restore the stashed manifest changes in Task 4 so the first GREEN commit includes both the dep swap and the first new code.

---

## Task 3: Add `LineHunk` type and bump schema version

**Files:**
- Modify: `src/editHistory/types.ts`

**Step 1: Replace file contents**

```ts
export interface LineHunk {
	/** 0-indexed line in the reconstructed previous version where deletion starts. */
	s: number;
	/** Number of old lines deleted (consumed from previous version starting at `s`). */
	d: number;
	/** New lines inserted at position `s` (each entry is one line, no trailing `\n`). */
	a: string[];
}

export interface VersionSnapshot {
	ts: number;
	device: string;
	/** Full-text base snapshot. Present on the first version and every rebase. */
	content?: string;
	/** Line-oriented delta against the immediately preceding version. */
	hunks?: LineHunk[];
}

export interface FileHistoryEntry {
	path: string;
	baseIndex: number;
	versions: VersionSnapshot[];
}

export interface EditHistoryData {
	version: 2;
	entries: Record<string, FileHistoryEntry>;
}

export function DEFAULT_EDIT_HISTORY_DATA(): EditHistoryData {
	return { version: 2, entries: {} };
}
```

**Step 2: Do NOT compile yet.** Many callers still reference `diff`, `DiffOp`, etc. We'll fix them in subsequent tasks. Commit the types anyway — they compile in isolation.

**Step 3: Commit**

```bash
git add src/editHistory/types.ts
git commit -m "refactor(editHistory): types — add LineHunk, bump schema to v2"
```

---

## Task 4: RED + GREEN — `computeLineHunks` for a single-line substitution

**Files:**
- Modify: `src/editHistory/editHistoryDiff.ts`
- Modify: `src/editHistory/editHistoryDiff.test.ts`

**Step 1: Unstash the dep-swap from Task 2**

```bash
git stash pop
```

`package.json` / `package-lock.json` now show `diff-match-patch` in place of `fast-diff`.

**Step 2: Replace `src/editHistory/editHistoryDiff.ts` entirely with a stub that compiles.**

The stub exports only `LineHunk` (re-exported from types), empty impls, and no char-op types.

```ts
import DiffMatchPatch from "diff-match-patch";
import type { FileHistoryEntry, LineHunk } from "./types";

export type { LineHunk } from "./types";

export interface DiffSummary {
	added: number;
	removed: number;
}

export function computeLineHunks(_oldContent: string, _newContent: string): LineHunk[] {
	throw new Error("not implemented");
}

export function applyLineHunks(_base: string, _hunks: LineHunk[]): string {
	throw new Error("not implemented");
}

export function reconstructVersion(
	_entry: FileHistoryEntry,
	_versionIndex: number,
): string | null {
	throw new Error("not implemented");
}

export function computeDiffSummary(_hunks: LineHunk[]): DiffSummary {
	throw new Error("not implemented");
}

export type DiffLine =
	| { kind: "retain"; text: string }
	| { kind: "add"; text: string }
	| { kind: "del"; text: string };

export type HunkItem =
	| { kind: "hunk"; lines: DiffLine[] }
	| { kind: "skip"; count: number };

export const DEFAULT_CONTEXT_LINES = 3;

export function buildHunks(_lines: DiffLine[], _context: number): HunkItem[] {
	throw new Error("not implemented");
}

// silence unused-import lint temporarily
void DiffMatchPatch;
```

**Step 3: Replace `src/editHistory/editHistoryDiff.test.ts` entirely**

Delete all existing content and write only the first RED test:

```ts
import { describe, it, expect } from "vitest";
import { computeLineHunks } from "./editHistoryDiff";

describe("computeLineHunks", () => {
	it("emits a single replace-one-line hunk for middle-line substitution", () => {
		const hunks = computeLineHunks("a\nb\nc", "a\nX\nc");
		expect(hunks).toEqual([{ s: 1, d: 1, a: ["X"] }]);
	});
});
```

**Step 4: Run the failing test**

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts
```

Expected: the one test fails with `Error: not implemented`. Other test files will also fail (view tests, store tests, capture tests) because they still reference removed types — that's expected. We fix them in later tasks. For now, only care that **this test** fails for the right reason.

**Step 5: Commit RED**

```bash
git add package.json package-lock.json src/editHistory/editHistoryDiff.ts src/editHistory/editHistoryDiff.test.ts
git commit -m "test(editHistory): RED — computeLineHunks single-line substitution"
```

**Step 6: Implement `computeLineHunks`**

Replace the stub body with:

```ts
export function computeLineHunks(oldContent: string, newContent: string): LineHunk[] {
	const dmp: any = new (DiffMatchPatch as any)();
	const conv = dmp.diff_linesToChars_(oldContent, newContent);
	const diffs = dmp.diff_main(conv.chars1, conv.chars2, false);
	dmp.diff_charsToLines_(diffs, conv.lineArray);

	const hunks: LineHunk[] = [];
	let oldLineCursor = 0;
	let i = 0;

	while (i < diffs.length) {
		const [op, text] = diffs[i] as [number, string];
		// Retain: just advance the cursor.
		if (op === 0) {
			oldLineCursor += countLinesInChunk(text);
			i++;
			continue;
		}
		// Start of a change run. Collect consecutive -1/+1 ops.
		const hunkStart = oldLineCursor;
		let deleted = 0;
		const added: string[] = [];
		while (i < diffs.length && (diffs[i]![0] === -1 || diffs[i]![0] === 1)) {
			const [op2, text2] = diffs[i] as [number, string];
			if (op2 === -1) {
				deleted += countLinesInChunk(text2);
			} else {
				for (const line of splitIntoLines(text2)) added.push(line);
			}
			i++;
		}
		oldLineCursor += deleted;
		hunks.push({ s: hunkStart, d: deleted, a: added });
	}

	return hunks;
}

/**
 * Count how many *lines* are in a multi-line chunk returned by
 * diff_charsToLines_. The chunk is a concatenation of full lines,
 * each ending in "\n" — EXCEPT possibly the final line if the source
 * had no trailing newline.
 *
 * Example: "a\nb\n" → 2 lines. "a\nb" → 2 lines. "" → 0 lines.
 */
function countLinesInChunk(text: string): number {
	if (text.length === 0) return 0;
	let n = 0;
	for (const ch of text) if (ch === "\n") n++;
	if (!text.endsWith("\n")) n++;
	return n;
}

/**
 * Split a multi-line chunk into individual line strings without trailing "\n".
 * "a\nb\n" → ["a", "b"]. "a\nb" → ["a", "b"]. "" → [].
 */
function splitIntoLines(text: string): string[] {
	if (text.length === 0) return [];
	const parts = text.split("\n");
	// If the chunk ends in "\n", split produces a trailing "" we drop.
	if (text.endsWith("\n")) parts.pop();
	return parts;
}
```

**Step 7: Run the test**

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts
```

Expected: the one `computeLineHunks` test passes.

**Step 8: Commit GREEN + dep swap together**

```bash
git add src/editHistory/editHistoryDiff.ts
git commit -m "feat(editHistory): GREEN — computeLineHunks via diff-match-patch line mode

Also swaps fast-diff for diff-match-patch."
```

---

## Task 5: More `computeLineHunks` cases (one commit per case)

Add each test one at a time. After each, run `npx vitest run src/editHistory/editHistoryDiff.test.ts` and confirm green, then commit.

**Files:** `src/editHistory/editHistoryDiff.test.ts`

Each case goes inside `describe("computeLineHunks", …)`.

**Case 5a: empty old → full insert**

```ts
it("returns a single insert-everything hunk when old is empty", () => {
	const hunks = computeLineHunks("", "a\nb\nc");
	expect(hunks).toEqual([{ s: 0, d: 0, a: ["a", "b", "c"] }]);
});
```

Commit: `test(editHistory): computeLineHunks empty old`.

**Case 5b: full delete**

```ts
it("returns a single delete-everything hunk when new is empty", () => {
	const hunks = computeLineHunks("a\nb\nc", "");
	expect(hunks).toEqual([{ s: 0, d: 3, a: [] }]);
});
```

Commit: `test(editHistory): computeLineHunks empty new`.

**Case 5c: no-change**

```ts
it("returns empty array when content is unchanged", () => {
	expect(computeLineHunks("x\ny\nz", "x\ny\nz")).toEqual([]);
});
```

Commit: `test(editHistory): computeLineHunks identity`.

**Case 5d: pure insertion at start**

```ts
it("emits one hunk at s=0 for prepended lines", () => {
	const hunks = computeLineHunks("a\nb", "HEAD\na\nb");
	expect(hunks).toEqual([{ s: 0, d: 0, a: ["HEAD"] }]);
});
```

Commit: `test(editHistory): computeLineHunks prepend`.

**Case 5e: pure insertion at end**

```ts
it("emits one hunk at s=N for appended lines", () => {
	const hunks = computeLineHunks("a\nb", "a\nb\nTAIL");
	expect(hunks).toEqual([{ s: 2, d: 0, a: ["TAIL"] }]);
});
```

Commit: `test(editHistory): computeLineHunks append`.

**Case 5f: pure deletion**

```ts
it("emits a d>0, a=[] hunk for a pure deletion", () => {
	const hunks = computeLineHunks("a\nb\nc", "a\nc");
	expect(hunks).toEqual([{ s: 1, d: 1, a: [] }]);
});
```

Commit: `test(editHistory): computeLineHunks pure delete`.

**Case 5g: replace multiple lines with multiple lines**

```ts
it("emits one hunk with d>0 and a.length>0 for a multi-line replacement", () => {
	const hunks = computeLineHunks("a\nX\nY\nb", "a\nP\nQ\nR\nb");
	expect(hunks).toEqual([{ s: 1, d: 2, a: ["P", "Q", "R"] }]);
});
```

Commit: `test(editHistory): computeLineHunks multi-line replacement`.

**Case 5h: two disjoint changes**

```ts
it("emits two hunks for two disjoint changes", () => {
	const hunks = computeLineHunks("a\nb\nc\nd\ne", "A\nb\nc\nd\nE");
	expect(hunks.length).toBe(2);
	expect(hunks[0]).toEqual({ s: 0, d: 1, a: ["A"] });
	expect(hunks[1]).toEqual({ s: 4, d: 1, a: ["E"] });
});
```

Commit: `test(editHistory): computeLineHunks two disjoint changes`.

**Case 5i: trailing newline preservation**

```ts
it("treats trailing newline as a retained empty line", () => {
	// "a\nb\n" is 2 real lines + a trailing empty line (convention).
	// Changing "b" to "B" while keeping the trailing newline produces s=1, d=1.
	const hunks = computeLineHunks("a\nb\n", "a\nB\n");
	expect(hunks).toEqual([{ s: 1, d: 1, a: ["B"] }]);
});
```

Commit: `test(editHistory): computeLineHunks trailing newline`.

At this point run the full test file and confirm all 9 `computeLineHunks` cases pass:

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t computeLineHunks
```

Expected: 9 passing, 0 failing.

---

## Task 6: RED + GREEN — `applyLineHunks`

**Files:** `src/editHistory/editHistoryDiff.ts`, `src/editHistory/editHistoryDiff.test.ts`

**Step 1: Add the first RED test (middle-substitution roundtrip).**

Append a new describe block to the test file:

```ts
describe("applyLineHunks", () => {
	it("splices a single replace-one-line hunk", () => {
		const result = applyLineHunks("a\nb\nc", [{ s: 1, d: 1, a: ["X"] }]);
		expect(result).toBe("a\nX\nc");
	});
});
```

Update the import at the top:

```ts
import { computeLineHunks, applyLineHunks } from "./editHistoryDiff";
```

**Step 2: Run, confirm fail**

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t applyLineHunks
```

Expected: fails with `not implemented`.

**Step 3: Commit RED**

```bash
git add src/editHistory/editHistoryDiff.test.ts
git commit -m "test(editHistory): RED — applyLineHunks single substitution"
```

**Step 4: Implement `applyLineHunks`**

Replace the `applyLineHunks` stub in `editHistoryDiff.ts` with:

```ts
export function applyLineHunks(base: string, hunks: LineHunk[]): string {
	// Split preserving the convention that a trailing "\n" appears as a final "" element.
	const baseLines = base === "" ? [] : base.split("\n");

	const out: string[] = [];
	let cursor = 0;
	for (const h of hunks) {
		// Copy retained lines before this hunk.
		for (let i = cursor; i < h.s; i++) out.push(baseLines[i]!);
		// Skip d old lines.
		cursor = h.s + h.d;
		// Emit added lines.
		for (const line of h.a) out.push(line);
	}
	// Copy trailing retained lines.
	for (let i = cursor; i < baseLines.length; i++) out.push(baseLines[i]!);

	return out.join("\n");
}
```

**Step 5: Run**

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t applyLineHunks
```

Expected: 1 passing.

**Step 6: Commit GREEN**

```bash
git add src/editHistory/editHistoryDiff.ts
git commit -m "feat(editHistory): GREEN — applyLineHunks"
```

---

## Task 7: More `applyLineHunks` cases

Each in own commit, same pattern as Task 5.

**Case 7a: empty hunks is identity**

```ts
it("is identity when hunks is empty", () => {
	expect(applyLineHunks("a\nb\nc", [])).toBe("a\nb\nc");
});
```

**Case 7b: insert at start**

```ts
it("prepends lines for a hunk at s=0 with d=0", () => {
	expect(applyLineHunks("a\nb", [{ s: 0, d: 0, a: ["HEAD"] }])).toBe("HEAD\na\nb");
});
```

**Case 7c: append at end**

```ts
it("appends lines for a hunk at s=N with d=0", () => {
	expect(applyLineHunks("a\nb", [{ s: 2, d: 0, a: ["TAIL"] }])).toBe("a\nb\nTAIL");
});
```

**Case 7d: empty base, full insert**

```ts
it("produces full content from empty base", () => {
	expect(applyLineHunks("", [{ s: 0, d: 0, a: ["a", "b", "c"] }])).toBe("a\nb\nc");
});
```

**Case 7e: full delete**

```ts
it("produces empty string when all lines are deleted", () => {
	expect(applyLineHunks("a\nb\nc", [{ s: 0, d: 3, a: [] }])).toBe("");
});
```

**Case 7f: multiple disjoint hunks applied in order**

```ts
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
```

Commit each as `test(editHistory): applyLineHunks <description>`.

---

## Task 8: Roundtrip property tests

**Files:** `src/editHistory/editHistoryDiff.test.ts`

**Step 1:** Add a roundtrip describe block. Each pair is a hand-picked old/new, asserts `applyLineHunks(old, computeLineHunks(old, new)) === new`.

```ts
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
```

**Step 2: Run**

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t roundtrip
```

Expected: all 20 roundtrip cases pass. If any fail, **STOP** and investigate — this is the correctness core of the migration. The most likely failure modes:
- Trailing-newline mismatch: `applyLineHunks` adds/drops a `\n` relative to expected.
- `""` base edge case: `"".split("\n") === [""]` vs our `=== []`. Our `base === "" ? [] : base.split("\n")` guard handles it; verify.
- `countLinesInChunk` off-by-one on chunks without trailing `\n`.

If a specific case fails, add a focused unit test for that case inside `computeLineHunks` or `applyLineHunks` and fix in isolation before resuming the roundtrip block.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryDiff.test.ts
git commit -m "test(editHistory): computeLineHunks + applyLineHunks roundtrip property cases"
```

---

## Task 9: RED + GREEN — `reconstructVersion` on `hunks`

**Files:** `src/editHistory/editHistoryDiff.ts`, `src/editHistory/editHistoryDiff.test.ts`

**Step 1: Add RED test**

Append to the test file:

```ts
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
});
```

Import: `import { reconstructVersion } from "./editHistoryDiff";` and `import type { FileHistoryEntry } from "./types";`.

**Step 2: Run, confirm fail, commit RED**

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t reconstructVersion
git add src/editHistory/editHistoryDiff.test.ts
git commit -m "test(editHistory): RED — reconstructVersion base case on hunks"
```

**Step 3: Implement**

Replace the `reconstructVersion` stub with:

```ts
export function reconstructVersion(
	entry: FileHistoryEntry,
	versionIndex: number,
): string | null {
	if (versionIndex < 0 || versionIndex >= entry.versions.length) return null;

	const base = entry.versions[entry.baseIndex];
	if (!base || base.content === undefined) return null;

	let content = base.content;
	for (let i = entry.baseIndex + 1; i <= versionIndex; i++) {
		const version = entry.versions[i];
		if (!version || !version.hunks) return null;
		content = applyLineHunks(content, version.hunks);
	}
	return content;
}
```

**Step 4: Run, commit GREEN**

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t reconstructVersion
git add src/editHistory/editHistoryDiff.ts
git commit -m "feat(editHistory): GREEN — reconstructVersion walks hunks chain"
```

**Step 5: Add more reconstructVersion cases (each its own commit)**

```ts
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

it("works with a rebased (non-zero) baseIndex", () => {
	const entry: FileHistoryEntry = {
		path: "t.md", baseIndex: 2,
		versions: [
			{ ts: 1, device: "d", hunks: [{ s: 0, d: 0, a: ["x"] }] },
			{ ts: 2, device: "d", hunks: [{ s: 0, d: 0, a: ["x"] }] },
			{ ts: 3, device: "d", content: "rebased" },
			{ ts: 4, device: "d", hunks: [{ s: 1, d: 0, a: ["!"] }] },
		],
	};
	expect(reconstructVersion(entry, 3)).toBe("rebased\n!");
});

it("returns null when version index is out of bounds", () => {
	const entry: FileHistoryEntry = {
		path: "t.md", baseIndex: 0,
		versions: [{ ts: 1, device: "d", content: "hi" }],
	};
	expect(reconstructVersion(entry, 5)).toBeNull();
});

it("returns null when base has no content (corrupt chain)", () => {
	const entry: FileHistoryEntry = {
		path: "t.md", baseIndex: 0,
		versions: [{ ts: 1, device: "d", hunks: [{ s: 0, d: 0, a: ["x"] }] }],
	};
	expect(reconstructVersion(entry, 0)).toBeNull();
});

it("returns null for empty versions array", () => {
	const entry: FileHistoryEntry = { path: "t.md", baseIndex: 0, versions: [] };
	expect(reconstructVersion(entry, 0)).toBeNull();
});
```

Commit each as `test(editHistory): reconstructVersion <case>`.

---

## Task 10: RED + GREEN — `computeDiffSummary` on `LineHunk[]`

**Files:** `src/editHistory/editHistoryDiff.ts`, `src/editHistory/editHistoryDiff.test.ts`

**Step 1: RED**

```ts
describe("computeDiffSummary", () => {
	it("returns zeros for empty hunks", () => {
		expect(computeDiffSummary([])).toEqual({ added: 0, removed: 0 });
	});
});
```

Import: `import { computeDiffSummary } from "./editHistoryDiff";`.

Run + commit RED: `test(editHistory): RED — computeDiffSummary on hunks`.

**Step 2: GREEN**

```ts
export function computeDiffSummary(hunks: LineHunk[]): DiffSummary {
	let added = 0;
	let removed = 0;
	for (const h of hunks) {
		added += h.a.length;
		removed += h.d;
	}
	return { added, removed };
}
```

Commit GREEN: `feat(editHistory): GREEN — computeDiffSummary sums hunks`.

**Step 3: More cases (each own commit)**

```ts
it("sums adds across hunks", () => {
	expect(computeDiffSummary([
		{ s: 0, d: 0, a: ["a", "b"] },
		{ s: 10, d: 0, a: ["c"] },
	])).toEqual({ added: 3, removed: 0 });
});

it("sums deletes across hunks", () => {
	expect(computeDiffSummary([
		{ s: 0, d: 2, a: [] },
		{ s: 5, d: 1, a: [] },
	])).toEqual({ added: 0, removed: 3 });
});

it("sums mixed adds and deletes", () => {
	expect(computeDiffSummary([
		{ s: 0, d: 2, a: ["X"] },
		{ s: 5, d: 1, a: ["Y", "Z"] },
	])).toEqual({ added: 3, removed: 3 });
});
```

Run, commit each case.

---

## Task 11: Remove `buildHunks` stub and verify remaining diff.test.ts green

**Files:** `src/editHistory/editHistoryDiff.ts`

`buildHunks` still throws `not implemented` from the Task 4 stub. It's used by the view for windowing. We keep the same signature but restore the real implementation.

**Step 1: Replace the `buildHunks` body** with the previously-shipped implementation:

```ts
export function buildHunks(lines: DiffLine[], context: number): HunkItem[] {
	const changeIdx: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i]!.kind !== "retain") changeIdx.push(i);
	}
	if (changeIdx.length === 0) return [];

	const keep = new Array<boolean>(lines.length).fill(false);
	for (const i of changeIdx) {
		const lo = Math.max(0, i - context);
		const hi = Math.min(lines.length - 1, i + context);
		for (let j = lo; j <= hi; j++) keep[j] = true;
	}

	const items: HunkItem[] = [];
	let i = 0;
	while (i < lines.length) {
		if (keep[i]) {
			const start = i;
			while (i < lines.length && keep[i]) i++;
			items.push({ kind: "hunk", lines: lines.slice(start, i) });
		} else {
			const start = i;
			while (i < lines.length && !keep[i]) i++;
			items.push({ kind: "skip", count: i - start });
		}
	}
	return items;
}
```

**Step 2: Remove the `void DiffMatchPatch;` line** we added in Task 4.

**Step 3: Run the full diff test file**

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts
```

Expected: all tests in `editHistoryDiff.test.ts` pass. (Other files still fail — view, store, capture.)

**Step 4: Commit**

```bash
git add src/editHistory/editHistoryDiff.ts
git commit -m "feat(editHistory): restore buildHunks implementation on hunks schema"
```

**Step 5: Add focused tests for `buildHunks`** (it had coverage before; now needs re-coverage on the pure helper). Add these cases in a `describe("buildHunks", ...)` block, one commit each:

```ts
it("returns empty array for no changes", () => {
	expect(buildHunks([
		{ kind: "retain", text: "a" },
		{ kind: "retain", text: "b" },
	], 3)).toEqual([]);
});

it("emits one hunk for a single change", () => {
	expect(buildHunks([{ kind: "add", text: "x" }], 3)).toEqual([
		{ kind: "hunk", lines: [{ kind: "add", text: "x" }] },
	]);
});

it("trims leading+trailing context beyond window to skip markers", () => {
	const lines: DiffLine[] = [];
	for (let i = 0; i < 5; i++) lines.push({ kind: "retain", text: `l${i}` });
	lines.push({ kind: "add", text: "X" });
	for (let i = 0; i < 5; i++) lines.push({ kind: "retain", text: `t${i}` });
	const result = buildHunks(lines, 3);
	expect(result.length).toBe(3);
	expect(result[0]).toEqual({ kind: "skip", count: 2 });
	expect(result[1]!.kind).toBe("hunk");
	expect(result[2]).toEqual({ kind: "skip", count: 2 });
});

it("splits two distant changes into two hunks", () => {
	const lines: DiffLine[] = [{ kind: "add", text: "A" }];
	for (let i = 0; i < 10; i++) lines.push({ kind: "retain", text: `m${i}` });
	lines.push({ kind: "add", text: "B" });
	const result = buildHunks(lines, 3);
	expect(result.length).toBe(3);
	expect(result[1]).toEqual({ kind: "skip", count: 4 });
});

it("DEFAULT_CONTEXT_LINES is 3", () => {
	expect(DEFAULT_CONTEXT_LINES).toBe(3);
});
```

Import: add `buildHunks`, `DEFAULT_CONTEXT_LINES`, `type DiffLine` to imports. Commit each case.

---

## Task 12: Update `EditHistoryStore` migration + test

**Files:**
- Modify: `src/editHistory/editHistoryStore.ts`
- Modify: `src/editHistory/editHistoryStore.test.ts`

**Step 1: Update `editHistoryStore.ts` `load()` method**

Replace:

```ts
async load(): Promise<EditHistoryData> {
	try {
		const exists = await this.vault.adapter.exists(HISTORY_PATH);
		if (!exists) return DEFAULT_EDIT_HISTORY_DATA();
		const raw = await this.vault.adapter.read(HISTORY_PATH);
		return JSON.parse(raw) as EditHistoryData;
	} catch (e) {
		logWarn("editHistoryStore: failed to load", e);
		return DEFAULT_EDIT_HISTORY_DATA();
	}
}
```

With:

```ts
async load(): Promise<EditHistoryData> {
	try {
		const exists = await this.vault.adapter.exists(HISTORY_PATH);
		if (!exists) return DEFAULT_EDIT_HISTORY_DATA();
		const raw = await this.vault.adapter.read(HISTORY_PATH);
		const parsed = JSON.parse(raw) as { version?: number };
		if (parsed?.version !== 2) {
			// Breaking format upgrade: silently wipe stale entries.
			const fresh = DEFAULT_EDIT_HISTORY_DATA();
			await this.save(fresh);
			return fresh;
		}
		return parsed as EditHistoryData;
	} catch (e) {
		logWarn("editHistoryStore: failed to load", e);
		return DEFAULT_EDIT_HISTORY_DATA();
	}
}
```

**Step 2: Update existing store tests**

Read `src/editHistory/editHistoryStore.test.ts` and find every `{ version: 1, ... }` literal. Replace all with `version: 2`. The existing "returns parsed data when file exists" test will need `hunks: []` instead of `diff: []` if any test stores a version snapshot with a diff — inspect carefully. For any test case involving a `VersionSnapshot` with `diff`, rewrite to use `hunks`.

Also update `prune` tests that reference `diff`. The `prune` method in the store references `diff: undefined` when rebuilding a base — change that to `hunks: undefined`.

**Step 3: Update `editHistoryStore.ts` `prune()` method**

Find `remaining[0] = { ...remaining[0]!, content: newBaseContent, diff: undefined };` and change `diff` → `hunks`.

**Step 4: Add a new migration test**

Append to `describe("load", ...)`:

```ts
it("wipes entries on load when stored version is not 2 (v1 → v2 migration)", async () => {
	const staleV1 = {
		version: 1,
		entries: {
			"file-a": { path: "a.md", baseIndex: 0, versions: [{ ts: 1, device: "d", content: "x" }] },
		},
	};
	vault = makeVault({ [HISTORY_PATH]: JSON.stringify(staleV1) });
	const store = new EditHistoryStore(vault);

	const data = await store.load();
	expect(data).toEqual({ version: 2, entries: {} });

	// And it should have persisted the wipe
	const persisted = JSON.parse(vault.adapter.write.mock.calls[0][1]);
	expect(persisted.version).toBe(2);
	expect(persisted.entries).toEqual({});
});
```

**Step 5: Run**

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

Fix any remaining failures iteratively — most likely spots: tests that construct `VersionSnapshot` with `diff` field, or expect `version: 1`. Update to `hunks` / `version: 2`.

**Step 6: Commit**

```bash
git add src/editHistory/editHistoryStore.ts src/editHistory/editHistoryStore.test.ts
git commit -m "refactor(editHistory): v1→v2 silent wipe migration + prune uses hunks"
```

---

## Task 13: Update `EditHistoryCapture` to use `computeLineHunks`

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts`
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Update import**

```ts
import { computeLineHunks, reconstructVersion } from "./editHistoryDiff";
```

(was `import { computeDiff, reconstructVersion } from "./editHistoryDiff";`)

**Step 2: Update two call-sites** (in `batchCapture` and `captureSnapshot`)

Change:
```ts
const diff = computeDiff(lastContent, edit.content);
entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), diff });
```

To:
```ts
const hunks = computeLineHunks(lastContent, edit.content);
entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), hunks });
```

(Same change in both methods — two spots.)

**Step 3: Update `editHistoryCapture.test.ts`**

Read the file. Replace every `diff: [...]` with `hunks: [...]` in VersionSnapshot literals, and every assertion that inspects `.diff` with `.hunks`. For assertions that checked the structure of stored diffs (e.g. that a delta was computed), update to check for `hunks` being a non-empty `LineHunk[]`.

**Step 4: Run**

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

Fix iteratively.

**Step 5: Commit**

```bash
git add src/editHistory/editHistoryCapture.ts src/editHistory/editHistoryCapture.test.ts
git commit -m "refactor(editHistory): capture stores line-hunks instead of char-diff"
```

---

## Task 14: Update `EditHistoryView` renderer

**Files:**
- Modify: `src/editHistory/editHistoryView.ts`

**Step 1: Update imports**

Replace:
```ts
import {
	reconstructVersion,
	computeDiffSummary,
	computeDiff,
	segmentLines,
	buildHunks,
	DEFAULT_CONTEXT_LINES,
	type DiffOp,
} from "./editHistoryDiff";
```

With:
```ts
import {
	reconstructVersion,
	computeDiffSummary,
	computeLineHunks,
	buildHunks,
	DEFAULT_CONTEXT_LINES,
	type DiffLine,
} from "./editHistoryDiff";
import type { LineHunk } from "./types";
```

**Step 2: Update `renderEntry` summary branch**

Change `if (version.diff) { … computeDiffSummary(version.diff) … }` to `if (version.hunks) { … computeDiffSummary(version.hunks) … }`.

**Step 3: Update session aggregate summary**

Change `if (version.diff) { const sum = computeDiffSummary(version.diff); … }` to `if (version.hunks) { const sum = computeDiffSummary(version.hunks); … }`.

**Step 4: Replace `renderHunks(DiffOp[])` with `renderLineHunks(prevContent, LineHunk[])`**

Delete the old `renderHunks` method and old `renderDiffOps` method entirely.

Add:

```ts
private renderLineHunks(
	container: HTMLElement,
	prevContent: string,
	hunks: LineHunk[],
): void {
	const prevLines = prevContent === "" ? [] : prevContent.split("\n");
	const diffLines: DiffLine[] = [];
	let cursor = 0;
	for (const h of hunks) {
		for (let i = cursor; i < h.s; i++) {
			diffLines.push({ kind: "retain", text: prevLines[i] ?? "" });
		}
		for (let i = h.s; i < h.s + h.d; i++) {
			diffLines.push({ kind: "del", text: prevLines[i] ?? "" });
		}
		for (const line of h.a) {
			diffLines.push({ kind: "add", text: line });
		}
		cursor = h.s + h.d;
	}
	for (let i = cursor; i < prevLines.length; i++) {
		diffLines.push({ kind: "retain", text: prevLines[i]! });
	}

	const items = buildHunks(diffLines, DEFAULT_CONTEXT_LINES);
	for (const item of items) {
		if (item.kind === "skip") {
			const skipEl = container.createDiv({ cls: "yaos-extension-edit-history-diff-hunk-skip" });
			skipEl.textContent = `… ${item.count} unchanged lines`;
			continue;
		}
		const hunkEl = container.createDiv({ cls: "yaos-extension-edit-history-diff-hunk" });
		for (const line of item.lines) {
			let lineCls: string;
			let gutterChar: string;
			if (line.kind === "retain") {
				lineCls = "yaos-extension-edit-history-diff-retain-line";
				gutterChar = " ";
			} else if (line.kind === "add") {
				lineCls = "yaos-extension-edit-history-diff-add-line";
				gutterChar = "+";
			} else {
				lineCls = "yaos-extension-edit-history-diff-del-line";
				gutterChar = "-";
			}
			const rowEl = hunkEl.createDiv({ cls: `yaos-extension-edit-history-diff-line ${lineCls}` });
			const gutter = rowEl.createSpan({ cls: "yaos-extension-edit-history-diff-gutter" });
			gutter.textContent = gutterChar;
			const textEl = rowEl.createSpan({ cls: "yaos-extension-edit-history-diff-line-text" });
			textEl.textContent = line.text;
		}
	}
}
```

**Step 5: Rewrite `renderDiffContent`**

Replace:

```ts
private renderDiffContent(
	parent: HTMLElement,
	entry: FileHistoryEntry,
	version: VersionSnapshot,
	versionIndex: number,
): void {
	const container = parent.createDiv({ cls: "yaos-extension-edit-history-diff" });

	if (version.hunks) {
		const prev = reconstructVersion(entry, versionIndex - 1);
		if (prev === null) {
			const label = container.createSpan({ cls: "yaos-extension-edit-history-diff-unavailable" });
			label.textContent = "(diff unavailable)";
			return;
		}
		this.renderLineHunks(container, prev, version.hunks);
		return;
	}

	if (version.content === undefined) {
		const label = container.createSpan({ cls: "yaos-extension-edit-history-diff-unavailable" });
		label.textContent = "(diff unavailable)";
		return;
	}

	if (versionIndex === 0) {
		const labelEl = container.createSpan({ cls: "yaos-extension-edit-history-diff-initial-label" });
		labelEl.textContent = "Initial snapshot";
		const { text, remainingLines } = truncateByLines(version.content, 20);
		// Initial snapshot renders as a single add span (unchanged from prior behavior).
		const addSpan = container.createSpan({ cls: "yaos-extension-edit-history-diff-add" });
		addSpan.textContent = text;
		if (remainingLines > 0) {
			const marker = container.createSpan({ cls: "yaos-extension-edit-history-diff-initial-truncated" });
			marker.textContent = `… (${remainingLines} more lines)`;
		}
		return;
	}

	// Mid-chain rebase base: synthesize line-hunks against reconstructed previous.
	const prev = reconstructVersion(entry, versionIndex - 1);
	if (prev === null) {
		const label = container.createSpan({ cls: "yaos-extension-edit-history-diff-unavailable" });
		label.textContent = "(diff unavailable)";
		return;
	}
	const synthetic = computeLineHunks(prev, version.content);
	this.renderLineHunks(container, prev, synthetic);
}
```

Note: the initial-snapshot path no longer calls `renderDiffOps` (deleted). It inlines the single `.diff-add` span construction directly. Keeps the initial-snapshot test contract identical.

**Step 6: Run build (expect compile errors from view tests)**

```bash
npm run build
```

The source should compile. Tests will fail because `editHistoryView.test.ts` still references `diff` in fixtures. That's next task.

---

## Task 15: Rewrite `editHistoryView.test.ts` fixtures to `hunks`

**Files:** `src/editHistory/editHistoryView.test.ts`

**Step 1: Update imports**

Replace `import { computeDiff } from "./editHistoryDiff";` with `import { computeLineHunks } from "./editHistoryDiff";`.

**Step 2: Replace all `diff: [[...]]` literals with `hunks: [...]`**

For each existing fixture's `diff` field, mentally reconstruct the **old content** from the prior versions in that fixture, then compute what the equivalent `hunks` would be, and substitute.

Systematic mapping per fixture (audit each test; the following covers the patterns seen in the current file):

| Old fixture snippet | Replacement |
|---|---|
| `diff: [[0, "hello world"], [1, "!"]]` with prior `content: "hello world"` | `hunks: [{s:0,d:1,a:["hello world!"]}]` |
| `diff: [[1, "!"]]` appended to `"hello world"` | `hunks: [{s:0,d:1,a:["hello world!"]}]` (or equivalent single-line substitution) |
| `diff: [[0, "v0"], [1, "v1"]]` on prior `"v0"` | `hunks: [{s:0,d:1,a:["v0v1"]}]` |
| `diff: [[0, "v0"], [1, " edit"]]` on `"v0"` | `hunks: [{s:0,d:1,a:["v0 edit"]}]` |
| `diff: [[1, " a"]]` on prior content | `hunks: [{s:0,d:1,a:[<prior content> + " a"]}]` |
| `diff: [[1, " b"]]` on prior | same pattern |
| `diff: [[1, " foo"]]` on prior | same pattern |
| `diff: [[1, " bar"]]` on prior | same pattern |
| `diff: [[1, "a\\nb\\nc"], [-1, "x"]]` on `"v0"` | The assertion expects "+3 / -1". Concretely old is `"v0"`, new is the old content with chunks inserted/deleted. Since the summary test specifically checks `+5` / `-1` for the session (v1 = +3/-1, v2 = +2): construct fixtures where v1 goes from `"v0"` to `"a\nb\nc"` (`hunks: [{s:0,d:1,a:["a","b","c"]}]` → +3/-1), v2 goes from `"a\nb\nc"` to `"a\nb\nc\nd\ne"` (`hunks: [{s:3,d:0,a:["d","e"]}]` → +2/0). Total +5/-1. |
| `diff: [[0, "hello"], [1, " world"]]` | `hunks: [{s:0,d:1,a:["hello world"]}]` |
| `diff: [[0, "a\\n"], [-1, "b"], [1, "B"], [0, "\\nc"]]` on `"a\nb\nc"` | `hunks: [{s:1,d:1,a:["B"]}]` |
| `diff: [[0, "he"], [-1, "llo"], [1, "y there"]]` on `"hello"` | `hunks: [{s:0,d:1,a:["hey there"]}]` |
| `diff: computeDiff(oldContent, newContent)` | `hunks: computeLineHunks(oldContent, newContent)` |
| `diff: [[0, oldContent], [1, "\\nCHANGE"]]` on `oldContent` | `hunks: [{s: <oldLines.length>, d:0, a:["CHANGE"]}]` |

For every replacement, double-check the assertion still makes sense:
- Tests asserting `.diff-del-line` text = "hello" must find one del-line with that text after reconstruction.
- Tests asserting `.diff-add-line` text = "hey there" must find one add-line with that text.

**Step 3: Adjust the "hunk-rows with +/-/space gutter" test**

This test currently uses `diff: [[0, "a\n"], [-1, "b"], [1, "B"], [0, "\nc"]]` against prior `content: "a\nb\nc"`. The line-hunks equivalent is a single-line replacement: `hunks: [{s:1,d:1,a:["B"]}]`. The expected DOM (retain "a", del "b", add "B", retain "c") stays identical because the renderer produces that row sequence from `prevLines = ["a","b","c"]` + hunk `{s:1,d:1,a:["B"]}`.

**Step 4: Adjust the "trims leading/trailing retains" test**

Old: 10 leading keep lines, then a `CHANGE` appended. Fixture was `{diff:[[0, oldContent],[1,"\nCHANGE"]]}`. New: `hunks: [{s: 10, d: 0, a: ["CHANGE"]}]` against prior `content: "keep0\nkeep1\n…\nkeep9"`. The DOM assertion stays the same: skip(7) + hunk(4 rows).

**Step 5: Adjust the "two distant changes" test**

Use `hunks: computeLineHunks(oldContent, newContent)` — exact same pattern.

**Step 6: Adjust `makeStore` return**

Change `load: vi.fn(async () => ({ version: 1, entries }))` → `load: vi.fn(async () => ({ version: 2, entries }))`.

**Step 7: Run the view tests**

```bash
npx vitest run src/editHistory/editHistoryView.test.ts
```

Iterate until all green. The mid-chain fallback test ("renders fallback label when mid-chain reconstruction fails") still works as-is because malformed base still returns null from `reconstructVersion`.

**Step 8: Commit**

```bash
git add src/editHistory/editHistoryView.ts src/editHistory/editHistoryView.test.ts
git commit -m "refactor(editHistory): view renders line-hunks via renderLineHunks"
```

---

## Task 16: Full suite verification

**Step 1:** Run the full suite.

```bash
npx vitest run
```

Expected: all tests pass. Count should be roughly comparable to the 448 baseline, with the split:
- `editHistoryDiff.test.ts`: ~45–55 tests (rewritten completely; old char-op tests gone, new line-hunks tests added).
- `editHistoryView.test.ts`: 30 (structure unchanged, fixtures rewritten).
- `editHistoryStore.test.ts`: existing count + 1 new migration test.
- `editHistoryCapture.test.ts`: existing count (fixtures rewritten).
- All other suites: unchanged.

If any test fails, **STOP** and fix before committing anything else.

**Step 2:** Run the build.

```bash
npm run build
```

Expected: exits 0. If TypeScript errors, fix them.

**Step 3:** Verify git state is clean.

```bash
git status --short
```

Expected: empty (all changes already committed).

---

## Task 17: Update `src/AGENTS.md`

**Files:** `src/AGENTS.md`

**Step 1: Update `editHistory/types` section**

Find the paragraph starting `### editHistory/types.ts -- Shared type definitions` and replace it with:

```
### editHistory/types.ts -- Shared type definitions

Exports `EditHistoryData`, `FileHistoryEntry`, `VersionSnapshot`, `LineHunk`.
Pure data, no logic. A `VersionSnapshot` has either `content` (base version)
or `hunks` (line-oriented delta). `EditHistoryData.version` is `2`;
version-1 files (stored as char-level `diff` tuples by an older build) are
silently wiped on load — see `editHistoryStore.load`.

`LineHunk = { s: number; d: number; a: string[] }` encodes one change region
relative to the reconstructed previous version. `s` is the 0-indexed starting
line, `d` is the number of old lines deleted, `a` is the list of new lines
inserted at that position. Old line text is *not* stored — derive it by
reconstructing the previous version and slicing `[s, s+d)`.
```

**Step 2: Update `editHistory/editHistoryDiff.ts` section**

Find the paragraph starting `### editHistory/editHistoryDiff.ts -- Diff + reconstruction` and replace the whole section with:

```
### editHistory/editHistoryDiff.ts -- Diff + reconstruction

Pure functions built on `diff-match-patch` line-mode:

- `computeLineHunks(old, new)` -- returns `LineHunk[]`. Uses the classic
  `diff_linesToChars_` / `diff_charsToLines_` trick so the underlying Myers
  diff runs on line-hashed chars, not raw text. Emits one hunk per contiguous
  `-1`/`+1` run with `s` = old-line-cursor at the start of the run, `d` = total
  lines removed, `a` = new line strings.
- `applyLineHunks(base, hunks)` -- returns new content. Splits `base` on `\n`
  (empty `""` is treated as 0 lines, not 1), walks `hunks` in ascending `s`,
  splicing each in turn, then rejoins with `\n`.
- `reconstructVersion(entry, versionIndex)` -- walks the delta chain from
  `entry.baseIndex` applying `applyLineHunks` for each step; returns `null`
  on a missing or content-less link.
- `computeDiffSummary(hunks)` -- returns `{ added, removed }` computed as
  `Σ h.a.length` and `Σ h.d` respectively (line-counted, not character-counted).

Two rendering helpers drive the hunk-style sidebar view:
`buildHunks(lines, context)` groups a `DiffLine[]` into alternating
`{ kind: "hunk"; lines }` and `{ kind: "skip"; count }` items by extending a
`context`-wide window around each change line (overlapping windows merge).
`DEFAULT_CONTEXT_LINES = 3` matches GitHub's default. The `DiffLine[]` itself
is synthesized inside `editHistoryView` by walking `prevLines` + `LineHunk[]`;
this module no longer owns a character-level diff op type.
```

**Step 3: Update `editHistory/editHistoryView.ts` section**

Find the existing paragraph describing hunk rendering and replace with:

```
### editHistory/editHistoryView.ts -- Sidebar panel

Obsidian `ItemView` with view type `"yaos-extension-edit-history"`.
Renders a file's version timeline grouped first by calendar date and
then by **session** (same device + within 5 minutes). Sessions with one
version render as a flat entry; multi-version sessions render a
collapsible header showing device, time range, edit count, and
aggregate added/removed line counts. Expanded-state persists across
`refresh()` calls via `expandedSessions: Set<string>` keyed by
`${device}-${startTs}`. Concurrent `refresh()` calls dedup via a
`refreshGeneration` counter.

Each entry renders an always-visible GitHub-style hunk diff below its
summary. Both stored deltas (`version.hunks`) and mid-chain rebase
bases (`content`-only versions at `versionIndex > 0` that synthesize
hunks via `computeLineHunks(reconstructVersion(entry, versionIndex - 1),
version.content)`) flow through one private helper, `renderLineHunks`.
That helper:
1. Splits `prevContent` on `\n` to get `prevLines`.
2. Walks the `LineHunk[]`, emitting `{kind:"retain"}` rows from gaps
   between hunks, `{kind:"del"}` rows from the `[s, s+d)` slice of
   `prevLines`, and `{kind:"add"}` rows from `h.a`.
3. Feeds the resulting `DiffLine[]` through `buildHunks(_, 3)` for
   GitHub-style context windowing.
4. Renders one `.diff-hunk` container per hunk item, one `.diff-line`
   per row with a `.diff-gutter` (` ` / `+` / `-`) and `.diff-line-text`.
   Skip runs render as a `.diff-hunk-skip` marker (`… N unchanged lines`).

The initial snapshot (`versionIndex === 0`) still renders as a single
`.diff-add` span truncated to 20 lines with a `… (N more lines)` marker
— it does not use `renderLineHunks`. If `reconstructVersion` returns
null for a stored-hunk or mid-chain base, a `.diff-unavailable` label
renders instead.

Constructor: `new EditHistoryView(leaf, store, onRestore)`.
```

**Step 4: Remove the `| editHistory/editHistoryDiff` row mention of `fast-diff`**

In the imports table near the top, change `editHistory/editHistoryDiff | editHistory/types, fast-diff` to `editHistory/editHistoryDiff | editHistory/types, diff-match-patch`.

**Step 5: Commit**

```bash
git add src/AGENTS.md
git commit -m "docs: update AGENTS.md for line-hunks storage schema"
```

---

## Task 18: Final verification + handoff

**Step 1:** Full green gate.

```bash
npx vitest run
npm run build
git status --short
git log --oneline | head -30
```

Expected:
- Vitest: all green.
- Build: exit 0.
- Git status: clean.
- Log shows a clean chain of commits from `docs: add plan` through `docs: update AGENTS.md`.

**Step 2:** Size sanity check (optional but recommended).

Construct a realistic fixture mentally: a 500-line file with a single-word edit. Under the old schema, `diff` was roughly the full file text retained verbatim (~5KB of `[0, "…"]` tuples). Under the new schema, the delta is `hunks: [{s:N, d:1, a:["new line text"]}]` — under 100 bytes. This confirms the design goal.

**Step 3:** Report to user.

Summarize:
- Task count completed (18).
- Final test count and baseline delta.
- Build status.
- Commit count on this branch.
- That we have NOT pushed to origin.
- Recommended next steps (compress base `content` snapshots; shard history per file; both remain out of scope per the original user preferences).

**DO NOT PUSH.** The user will approve push explicitly as per the standing protocol.

---

## Risk register

1. **Trailing-newline edge cases.** `"".split("\n") === [""]` vs `"a\n".split("\n") === ["a", ""]` vs `"a".split("\n") === ["a"]`. The `base === "" ? [] : base.split("\n")` guard in `applyLineHunks` handles the empty-base case. Roundtrip property tests in Task 8 catch any asymmetry.

2. **`diff-match-patch` line mode API quirk.** The helper methods `diff_linesToChars_` and `diff_charsToLines_` are underscore-suffixed (historically semi-private in the `dmp` codebase) but are the documented entry points for line-mode diffs. They have been stable for 10+ years. If TypeScript complains about types, cast to `any` — this is why we declare `const dmp: any = new (DiffMatchPatch as any)()` in Task 4.

3. **Bundle size increase.** `diff-match-patch` is ~30KB minified vs `fast-diff`'s ~3KB. Net +27KB on `main.js`. Acceptable given the disk-size win per the user's priority choice, but confirm `npm run build` completes and inspect the new `main.js` size at Task 16. If >2x larger than before, note it in the Task 18 summary.

4. **Test-count drift.** The plan removes many char-op tests (~20) and adds a roughly equivalent count of new line-hunk tests + property roundtrips. Expect the final test count to be within ±10 of the 448 baseline. Large deviations indicate something was left incomplete.

5. **Existing capture-test interaction with hunks.** Some tests may have hardcoded a specific char-op shape as the expected value (e.g. `expect(snap.diff).toEqual([[0,...]])`). Rewrite to assert `snap.hunks` structure — but prefer shape-agnostic assertions (non-empty array of `{s,d,a}` objects) over exact-value assertions where possible, since `diff-match-patch` line mode may produce slightly different hunk granularity than `fast-diff` did.

6. **Rendering hunk-row count divergence on equivalent changes.** The old view tests produced specific row counts (e.g. 4 rows for a single-line substitution + 2 retains). Those counts depend on the hunk granularity produced by the diff engine. After migrating to `diff-match-patch` line mode, the row count may differ slightly if the new engine groups differently. Update assertion expectations based on **observed behavior** from `computeLineHunks` runs in Task 5/7, not from prior expectations.

---

## Out of scope (explicit)

- Compressing base `content` snapshots.
- Sharding `edit-history.json` per file.
- Intra-line character highlighting.
- Backward-compatible v1 reader.
- Preserving any existing edit-history entries across the migration.
- Renaming the field back to `diff` (we use `hunks` deliberately to signal the format change).
- Publishing a release note or user-facing notice about the wipe.
- Changes to `settings.ts` — no new user-visible settings for this migration.

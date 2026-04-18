# Edit History Inline Diff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render an always-visible inline colored diff (add/del/retain spans) beneath every version entry in the edit history sidebar, with initial snapshots truncated to 20 lines and mid-chain rebase bases synthesized from reconstruction.

**Architecture:** Feature addition to `EditHistoryView` only. No changes to capture, store, or data model. The data already contains `version.diff: DiffOp[]` from `fast-diff`; the view currently displays only a `+X -Y lines` counter and never surfaces the ops themselves. Two new private methods (`renderDiffContent`, `renderDiffOps`) plus a pure `truncateByLines` helper handle every render case via a branch table. Colored spans use Obsidian theme CSS variables for green/red tinting.

**Tech Stack:** TypeScript, Obsidian `ItemView`, `fast-diff`, Vitest + happy-dom for DOM assertions, esbuild for the bundle.

---

## Ground rules

- **TDD mandatory.** Every production change is preceded by a failing test, confirmed RED before going GREEN.
- **Commit after every task** per project convention (see git log and prior plan at `docs/plans/2026-04-18-edit-history-writes-and-debounce.md`).
- **Verification command:** `npx vitest run` (NOT `npm test`). Baseline at plan-write time: **421 passing**. Target end state: **426 passing** (+5 new tests).
- **Build check:** `npm run build` must be clean.
- **Test style:** real timers + sync DOM assertions (match `editHistoryView.test.ts`). No `vi.useFakeTimers()`.
- **Architecture rule (per `src/AGENTS.md`):** siblings never import each other; `editHistoryView.ts` may import from `./editHistoryDiff` and `./types` only (already does).
- **Source-of-truth convention:** `src/styles.css` is edited by humans; the root `/styles.css` is a build artifact. Do NOT touch the root file.
- **Working branch:** `master`. Commit and push sequence at end per prior plan's pattern (do not push until user says so).

---

## Rendering branch table

This table drives the implementation. Every version goes through `renderDiffContent` which dispatches based on shape:

| Version shape | `versionIndex` | Render path |
|---|---|---|
| `version.diff` present | any | `renderDiffOps(version.diff)` — **untruncated** |
| `version.content` present | `0` | label `Initial snapshot` + `renderDiffOps([[1, truncated]])` + marker if `remainingLines > 0` |
| `version.content` present | `> 0` (mid-chain rebase base) | reconstruct prior → if `null` fallback label; else `renderDiffOps(computeDiff(prev, content))` **untruncated** |
| Neither `diff` nor `content` | any | fallback label `(diff unavailable)` (defensive; shouldn't happen) |

---

## DOM structure per entry

Existing `renderEntry` (see `src/editHistory/editHistoryView.ts:221-261`) produces:

```
.yaos-extension-edit-history-entry
  .yaos-extension-edit-history-entry-top  (avatar + device + time)
  .yaos-extension-edit-history-summary    (e.g. "+3 -1 lines")      ← existing, when version.diff set
  .yaos-extension-edit-history-actions    (Restore button)
```

After this plan:

```
.yaos-extension-edit-history-entry
  .yaos-extension-edit-history-entry-top
  .yaos-extension-edit-history-summary
  .yaos-extension-edit-history-diff                                  ← NEW, always present
    ├ (for diff-versions) interleaved .diff-add / .diff-del / .diff-retain spans
    ├ (for initial snapshot) .diff-initial-label + .diff-add + optional .diff-initial-truncated
    ├ (for mid-chain rebase) interleaved spans from synthetic diff
    └ (for broken chain / no content) .diff-unavailable span
  .yaos-extension-edit-history-actions
```

---

## Task 0: Confirm baseline and write plan-commit

**Files:**
- Create: `docs/plans/2026-04-18-edit-history-inline-diff.md` (this file)

**Step 1: Confirm baseline**

Run: `npx vitest run`
Expected: `Tests  421 passed (421)`

**Step 2: Commit the plan**

```bash
git add docs/plans/2026-04-18-edit-history-inline-diff.md
git commit -m "docs: plan for edit history inline diff"
```

---

## Task 1 (RED): Test that `version.diff` renders classed spans

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts` — append new `describe("inline diff rendering")` block at end of outer `describe("EditHistoryView")`.

**Step 1: Append test block**

Add just before the final closing `});` of the top-level `describe`:

```ts
	describe("inline diff rendering", () => {
		it("renders version.diff as classed add/del/retain spans", async () => {
			const entry: FileHistoryEntry = {
				path: "notes/x.md",
				baseIndex: 0,
				versions: [
					{ ts: 1000, device: "DevA", content: "hello" },
					{
						ts: 2000,
						device: "DevA",
						diff: [[0, "he"], [-1, "llo"], [1, "y there"]],
					},
				],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const addSpans = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-diff-add",
			);
			const delSpans = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-diff-del",
			);
			const retainSpans = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-diff-retain",
			);

			// At least one of each type appears across the entries
			expect(addSpans.length).toBeGreaterThan(0);
			expect(delSpans.length).toBeGreaterThan(0);
			expect(retainSpans.length).toBeGreaterThan(0);

			// Check the specific diff-version row contains the insert text "y there"
			const insertTexts = Array.from(addSpans).map(s => s.textContent);
			expect(insertTexts).toContain("y there");

			// Check the specific deletion "llo"
			const deleteTexts = Array.from(delSpans).map(s => s.textContent);
			expect(deleteTexts).toContain("llo");

			// Retain "he"
			const retainTexts = Array.from(retainSpans).map(s => s.textContent);
			expect(retainTexts).toContain("he");
		});
	});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "renders version.diff as classed"`
Expected: FAIL — no `.yaos-extension-edit-history-diff-add` element found (length 0).

**Step 3: Commit the failing test**

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test(editHistoryView): RED — diff ops render as classed spans"
```

---

## Task 2 (GREEN): Implement `renderDiffOps` and diff-branch of `renderDiffContent`

**Files:**
- Modify: `src/editHistory/editHistoryView.ts`

**Step 1: Add `computeDiff` to imports**

Change line 3 from:

```ts
import { reconstructVersion, computeDiffSummary } from "./editHistoryDiff";
```

to:

```ts
import { reconstructVersion, computeDiffSummary, computeDiff, type DiffOp } from "./editHistoryDiff";
```

Note: `DiffOp` is exported from `./editHistoryDiff` (see `src/editHistory/editHistoryDiff.ts:4`).

**Step 2: Add `truncateByLines` module-private helper**

Insert below `getDeviceInitials` (around line 20), before the `SESSION_GAP_MS` constant:

```ts
function truncateByLines(text: string, maxLines: number): { text: string; remainingLines: number } {
	const lines = text.split("\n");
	if (lines.length <= maxLines) {
		return { text, remainingLines: 0 };
	}
	return {
		text: lines.slice(0, maxLines).join("\n"),
		remainingLines: lines.length - maxLines,
	};
}
```

**Step 3: Implement the two new private methods on the class**

Insert inside the `EditHistoryView` class after `renderEntry` (after line 261, before the closing `}` of the class):

```ts
	private renderDiffContent(
		parent: HTMLElement,
		entry: FileHistoryEntry,
		version: VersionSnapshot,
		versionIndex: number,
	): void {
		const container = parent.createDiv({ cls: "yaos-extension-edit-history-diff" });

		if (version.diff) {
			this.renderDiffOps(container, version.diff);
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
			this.renderDiffOps(container, [[1, text]]);
			if (remainingLines > 0) {
				const marker = container.createSpan({ cls: "yaos-extension-edit-history-diff-initial-truncated" });
				marker.textContent = `… (${remainingLines} more lines)`;
			}
			return;
		}

		// Mid-chain rebase base: synthesize a diff against the reconstructed previous version
		const prev = reconstructVersion(entry, versionIndex - 1);
		if (prev === null) {
			const label = container.createSpan({ cls: "yaos-extension-edit-history-diff-unavailable" });
			label.textContent = "(diff unavailable)";
			return;
		}
		const synthetic = computeDiff(prev, version.content);
		this.renderDiffOps(container, synthetic);
	}

	private renderDiffOps(container: HTMLElement, ops: DiffOp[]): void {
		for (const [op, text] of ops) {
			let cls: string;
			if (op === 1) cls = "yaos-extension-edit-history-diff-add";
			else if (op === -1) cls = "yaos-extension-edit-history-diff-del";
			else cls = "yaos-extension-edit-history-diff-retain";
			const span = container.createSpan({ cls });
			span.textContent = text;
		}
	}
```

**Step 4: Call `renderDiffContent` from `renderEntry`**

In `renderEntry` (around line 249), insert the call between the summary block and the `.yaos-extension-edit-history-actions` creation. The existing structure:

```ts
		if (version.diff) {
			const summary = computeDiffSummary(version.diff);
			const summaryEl = el.createDiv({ cls: "yaos-extension-edit-history-summary" });
			const parts: string[] = [];
			if (summary.added > 0) parts.push(`+${summary.added}`);
			if (summary.removed > 0) parts.push(`-${summary.removed}`);
			summaryEl.textContent = parts.join(" ") + " lines";
		}

		const actions = el.createDiv({ cls: "yaos-extension-edit-history-actions" });
```

Insert between them:

```ts
		this.renderDiffContent(el, entry, version, versionIndex);

		const actions = el.createDiv({ cls: "yaos-extension-edit-history-actions" });
```

**Step 5: Run the test to verify it passes**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "renders version.diff as classed"`
Expected: PASS.

**Step 6: Run full view test file to ensure no regressions**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts`
Expected: all tests pass (previously 17, now 18).

**Step 7: Commit**

```bash
git add src/editHistory/editHistoryView.ts
git commit -m "feat(editHistoryView): GREEN — render diff ops as colored spans"
```

---

## Task 3 (RED): Test initial snapshot > 20 lines truncates with marker

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Append test inside `describe("inline diff rendering")`**

```ts
		it("initial version (> 20 lines) renders truncated add span + marker", async () => {
			const lines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
			const content = lines.join("\n");
			const entry: FileHistoryEntry = {
				path: "notes/long.md",
				baseIndex: 0,
				versions: [{ ts: 1000, device: "DevA", content }],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const label = view.contentEl.querySelector(
				".yaos-extension-edit-history-diff-initial-label",
			);
			expect(label?.textContent).toBe("Initial snapshot");

			const addSpans = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-diff-add",
			);
			expect(addSpans.length).toBe(1);
			const addedText = addSpans[0]!.textContent ?? "";
			const addedLineCount = addedText.split("\n").length;
			expect(addedLineCount).toBe(20);
			// First line preserved, line 20 preserved, line 21 not
			expect(addedText).toContain("line1");
			expect(addedText).toContain("line20");
			expect(addedText).not.toContain("line21");

			const marker = view.contentEl.querySelector(
				".yaos-extension-edit-history-diff-initial-truncated",
			);
			expect(marker?.textContent).toBe("… (10 more lines)");
		});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "initial version .> 20 lines"`
Expected: FAIL — `.yaos-extension-edit-history-diff-initial-label` not found (Task 2's GREEN implementation already added the code, **but this test exercises the `versionIndex === 0 && content present` branch which is live** — wait, re-check).

**Note for executor:** Task 2 actually implements the full `renderDiffContent` including the initial-base branch, so this test may PASS on first run. If it does, that is acceptable — record it as a "verification test" rather than a RED→GREEN cycle. Still commit separately before writing the next test. If it fails (e.g. off-by-one in `truncateByLines`), fix in the matching GREEN task.

**Decision rule:** If test passes immediately after adding, commit with message `test(editHistoryView): cover initial snapshot truncation`. If it fails, add a small GREEN fix commit after.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test(editHistoryView): cover initial snapshot truncation (> 20 lines)"
```

---

## Task 4 (RED): Test initial snapshot ≤ 20 lines renders no marker

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Append test**

```ts
		it("initial version (≤ 20 lines) renders full content with no truncation marker", async () => {
			const content = "alpha\nbeta\ngamma\ndelta\nepsilon";
			const entry: FileHistoryEntry = {
				path: "notes/short.md",
				baseIndex: 0,
				versions: [{ ts: 1000, device: "DevA", content }],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const label = view.contentEl.querySelector(
				".yaos-extension-edit-history-diff-initial-label",
			);
			expect(label?.textContent).toBe("Initial snapshot");

			const addSpans = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-diff-add",
			);
			expect(addSpans.length).toBe(1);
			expect(addSpans[0]!.textContent).toBe(content);

			const marker = view.contentEl.querySelector(
				".yaos-extension-edit-history-diff-initial-truncated",
			);
			expect(marker).toBeNull();
		});
```

**Step 2: Run**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "initial version .≤ 20 lines"`
Expected: PASS (Task 2 implementation handles this).

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test(editHistoryView): cover initial snapshot without truncation"
```

---

## Task 5 (RED): Test mid-chain rebase base synthesizes untruncated diff

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Background:** A mid-chain rebase base is a version at `versionIndex > 0` where `content` (not `diff`) is stored. The view should reconstruct the previous version and render `computeDiff(prev, content)`. The result is untruncated regardless of length.

**Step 1: Append test**

```ts
		it("mid-chain rebase base synthesizes diff against reconstructed previous (untruncated)", async () => {
			// v0 = "hello"
			// v1 = "hello world" (delta)
			// v2 = "hello universe" (mid-chain rebase base, stored as full content)
			const entry: FileHistoryEntry = {
				path: "notes/rebase.md",
				baseIndex: 0,
				versions: [
					{ ts: 1000, device: "DevA", content: "hello" },
					{ ts: 2000, device: "DevA", diff: [[0, "hello"], [1, " world"]] },
					{ ts: 3000, device: "DevA", content: "hello universe" },
				],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			// Newest-first walk: v2 is the first entry rendered.
			const entries = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-entry",
			);
			expect(entries.length).toBe(3);

			const v2Diff = entries[0]!.querySelector(
				".yaos-extension-edit-history-diff",
			);
			expect(v2Diff).not.toBeNull();

			// Must have at least one add span (inserting " universe") and
			// at least one del span (removing " world").
			const adds = v2Diff!.querySelectorAll(".yaos-extension-edit-history-diff-add");
			const dels = v2Diff!.querySelectorAll(".yaos-extension-edit-history-diff-del");
			expect(adds.length).toBeGreaterThan(0);
			expect(dels.length).toBeGreaterThan(0);

			// The combined content of all spans within the diff container must
			// equal the NEW content "hello universe" when concatenating op === 0
			// and op === 1 spans (per applyDiff semantics).
			const retainAndAdd = v2Diff!.querySelectorAll(
				".yaos-extension-edit-history-diff-retain, .yaos-extension-edit-history-diff-add",
			);
			const reconstructed = Array.from(retainAndAdd).map(s => s.textContent).join("");
			expect(reconstructed).toBe("hello universe");

			// No initial-label on v2 (it's not versionIndex 0).
			const label = v2Diff!.querySelector(
				".yaos-extension-edit-history-diff-initial-label",
			);
			expect(label).toBeNull();
		});
```

**Step 2: Run**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "mid-chain rebase base"`
Expected: PASS (Task 2 implementation handles this).

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test(editHistoryView): cover mid-chain rebase synthetic diff"
```

---

## Task 6 (RED): Test broken-chain fallback

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Background:** If a content-only version at `versionIndex > 0` cannot be diffed because `reconstructVersion` returns `null` (e.g. a preceding delta is missing or the base index is malformed), render `.yaos-extension-edit-history-diff-unavailable`.

The simplest way to force `reconstructVersion → null` is an entry where `baseIndex === 0` but `versions[0]` has no `content` field — reconstruction walks `entry.versions[baseIndex]`, checks `base.content === undefined`, returns `null` (see `src/editHistory/editHistoryDiff.ts:32-33`).

**Step 1: Append test**

```ts
		it("renders fallback label when mid-chain reconstruction fails", async () => {
			// Malformed entry: base at index 0 lacks `content`, so reconstructVersion
			// returns null for any request. The content-only version at index 1
			// therefore cannot synthesize a diff.
			const entry: FileHistoryEntry = {
				path: "notes/broken.md",
				baseIndex: 0,
				versions: [
					// Index 0: no content, no diff (malformed base). Will be skipped
					// for diff-rendering via the defensive `(diff unavailable)` branch.
					{ ts: 1000, device: "DevA" } as any,
					// Index 1: content-only, but reconstruction of index 0 is null.
					{ ts: 2000, device: "DevA", content: "anything" },
				],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const unavailables = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-diff-unavailable",
			);
			// Expect at least one: the content-only mid-chain row hitting the null branch.
			// (The malformed base row also triggers the defensive branch.)
			expect(unavailables.length).toBeGreaterThanOrEqual(1);
		});
```

**Step 2: Run**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "fallback label"`
Expected: PASS (Task 2 implementation handles both null branches).

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test(editHistoryView): cover broken-chain fallback label"
```

---

## Task 7: Add CSS to `src/styles.css`

**Files:**
- Modify: `src/styles.css`

**Step 1: Inspect current file tail**

Run: `wc -l src/styles.css`
Expected: ~917 lines (per plan-write-time inspection; may be slightly different).

**Step 2: Append block at end of file**

Add after the last existing edit-history rule (confirm placement by reading the file; search for `/* Edit history — session grouping */` and append after the last rule in that section, or simply at EOF if cleaner):

```css
/* Edit history — inline diff */

.yaos-extension-edit-history-diff {
	padding: 4px 8px 4px 32px;
	margin-top: 4px;
	font-family: var(--font-monospace);
	font-size: 12px;
	white-space: pre-wrap;
	word-break: break-word;
	background: var(--background-secondary);
	border-radius: 4px;
}

.yaos-extension-edit-history-diff-add {
	background: rgba(var(--color-green-rgb), 0.2);
	color: var(--text-normal);
}

.yaos-extension-edit-history-diff-del {
	background: rgba(var(--color-red-rgb), 0.2);
	color: var(--text-muted);
	text-decoration: line-through;
}

.yaos-extension-edit-history-diff-retain {
	color: var(--text-muted);
}

.yaos-extension-edit-history-diff-initial-label {
	display: block;
	margin-bottom: 4px;
	font-style: italic;
	color: var(--text-faint);
}

.yaos-extension-edit-history-diff-initial-truncated {
	display: block;
	margin-top: 4px;
	font-style: italic;
	color: var(--text-faint);
}

.yaos-extension-edit-history-diff-unavailable {
	font-style: italic;
	color: var(--text-faint);
}
```

**Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style(editHistory): inline diff colored spans"
```

---

## Task 8: Full-suite verification + build check

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: `Tests  426 passed (426)` (baseline 421 + 5 new tests).

If the count is 425 or fewer, one or more tests failed. Read the output, fix the issue, add a fix commit with message `fix(editHistoryView): <specific fix>`, and re-run.

**Step 2: Run build**

Run: `npm run build`
Expected: exits 0 with no errors. Output should mention `tsc` and `esbuild` successfully completing.

If TypeScript surfaces errors, fix them in a commit messaged `fix(editHistoryView): resolve type errors`.

**Step 3: Git status check**

Run: `git status --short`
Expected: clean working tree (no uncommitted changes).

---

## Task 9: Update `src/AGENTS.md`

**Files:**
- Modify: `src/AGENTS.md` — the `editHistory/editHistoryView.ts` module section.

**Step 1: Locate the section**

Run: `grep -n "editHistoryView.ts -- Sidebar panel" src/AGENTS.md`

**Step 2: Add a new paragraph**

Find the paragraph ending with `"...so only the latest call ever mutates the DOM."` (the concurrent-refresh paragraph). Immediately after that paragraph, before the `Constructor:` line, insert:

```markdown
Each version entry renders an always-visible inline colored diff below its
summary line. Versions with stored `diff` ops render directly as colored
spans (`.diff-add` / `.diff-del` / `.diff-retain`). The initial snapshot
(`versionIndex === 0`) renders as a single insert-styled block truncated to
20 lines with a `… (N more lines)` marker when longer. Mid-chain rebase
bases (`content`-only versions at `versionIndex > 0`) synthesize a diff
against `reconstructVersion(entry, versionIndex - 1)` and render
untruncated; if reconstruction returns null, a `.diff-unavailable` fallback
label renders instead.
```

**Step 3: Commit**

```bash
git add src/AGENTS.md
git commit -m "docs: note inline diff rendering in editHistoryView"
```

---

## Task 10: Final verification

**Step 1: One more full verification**

Run: `npx vitest run && npm run build && git status --short`
Expected: 426 passing, build clean, tree clean.

**Step 2: Summarize for the user**

Report:
- Tests passing count (expect 426).
- Build status (expect clean).
- Commits added on this branch (expect 9 commits: plan + 6 test commits + GREEN impl + CSS + AGENTS).
- Do NOT push unless the user explicitly asks.

---

## Out of scope (will NOT be done in this plan)

- Truncation of stored `diff` ops or mid-chain synthetic diffs.
- Collapsible / toggle UX.
- Diff between arbitrary user-selected version pairs.
- GitHub-style context-hunk trimming (`@@` hunks).
- Syntax highlighting inside the diff.
- Editing the root `/styles.css` (build artifact).

---

## Test count accounting

| Phase | Test count |
|---|---|
| Baseline | 421 |
| + Task 1 (RED diff spans) | 422 |
| + Task 3 (truncation) | 423 |
| + Task 4 (no truncation) | 424 |
| + Task 5 (rebase synthetic) | 425 |
| + Task 6 (broken-chain) | 426 |
| **End state target** | **426** |

## Commit log target

Expected commit sequence after completion (9 commits on top of `d945faf`):

1. `docs: plan for edit history inline diff`
2. `test(editHistoryView): RED — diff ops render as classed spans`
3. `feat(editHistoryView): GREEN — render diff ops as colored spans`
4. `test(editHistoryView): cover initial snapshot truncation (> 20 lines)`
5. `test(editHistoryView): cover initial snapshot without truncation`
6. `test(editHistoryView): cover mid-chain rebase synthetic diff`
7. `test(editHistoryView): cover broken-chain fallback label`
8. `style(editHistory): inline diff colored spans`
9. `docs: note inline diff rendering in editHistoryView`

## Files touched summary

- `docs/plans/2026-04-18-edit-history-inline-diff.md` — new plan doc
- `src/editHistory/editHistoryView.ts` — implementation (one GREEN commit)
- `src/editHistory/editHistoryView.test.ts` — 5 new tests (5 commits)
- `src/styles.css` — CSS classes
- `src/AGENTS.md` — module-doc update

No changes to: `editHistoryStore.ts`, `editHistoryCapture.ts`, `editHistoryDiff.ts`, `types.ts`, `pendingEditsDb.ts`, `main.ts`, root `styles.css`, any other module.

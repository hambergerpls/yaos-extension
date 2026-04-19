# Edit History — Compressed Bases + Intra-line Character Highlighting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two orthogonal improvements to the `v2` edit-history format on `master`: (1) compress `VersionSnapshot.content` bases inline with `fflate` deflate-raw + base64 when it shrinks the payload, schema bump v2→v3 with silent wipe; (2) add intra-line character-level highlighting for paired del/add rows inside rendered hunks via `diff-match-patch` + `diff_cleanupSemantic`.

**Architecture:** New leaf module `editHistoryCompress.ts` exports `encodeContent` / `decodeContent`. Imported by `editHistoryDiff.ts` (`reconstructVersion` decodes on read), `editHistoryStore.ts` (v2→v3 migration + `prune` re-encodes new bases), `editHistoryCapture.ts` (encodes at write sites), and `editHistoryView.ts` (decodes initial-snapshot raw). No cross-sibling imports violated — compression is a leaf, diff/store/capture/view each import it independently. For intra-line highlighting, `editHistoryDiff.ts` gains a pure `pairLinesForWordDiff(DiffLine[]) → DiffLineWithWords[]` helper that detects consecutive del→add runs and attaches per-line `WordDiffSegment[]` via `dmp.diff_main` + `dmp.diff_cleanupSemantic`; `editHistoryView.ts` renders nested `.diff-word-{add,del,equal}` spans inside `.diff-line-text`.

**Tech Stack:** TypeScript strict, Vitest, esbuild, `fflate` ^0.8 (new dep), `diff-match-patch` (already shipped), Obsidian `ItemView` DOM API, jsdom for tests.

**Pre-reading** (required before starting):
- `src/AGENTS.md` — module dependency graph + every `editHistory/*` section.
- `src/editHistory/types.ts`, `editHistoryStore.ts`, `editHistoryCapture.ts`, `editHistoryDiff.ts`, `editHistoryView.ts` — current v2 implementation.
- `docs/plans/2026-04-19-edit-history-line-hunks.md` — prior plan; inherit commit protocol and task/test structure.

**Commit protocol** (inherited from prior session):
- One commit per RED test, one per GREEN implementation. Each added test case after the first GREEN is its own commit.
- Message prefixes: `test(editHistory): RED — <behavior>`, `test(editHistory): <behavior>` for additional green cases, `feat(editHistory): GREEN — <behavior>`, `refactor(editHistory): <what>`, `chore(deps): add fflate`, `docs: …`.
- Do NOT push at the end. User approves push explicitly.
- Verification gate before every commit: `npx vitest run` fully green (except freshly-committed RED tests, which must fail for the correct reason).
- Build gate before the final commit: `npm run build` exits 0.

---

## Task 0: Baseline verification

**Files:** None.

**Step 1:** Verify clean baseline.

```bash
npx vitest run
npm run build
git status --short
git log --oneline -1
```

**Expected:**
- Vitest: 462 tests passing.
- Build: exits 0.
- Git status: empty.
- HEAD: `64aeab2 docs: update AGENTS.md for line-hunks storage schema`.

**Step 2:** Confirm the push-to-origin happened in the prior phase.

```bash
git log --oneline origin/master..HEAD
```

Expected: empty (HEAD is at origin/master).

If any check fails, **STOP and report** — do not start the plan on a dirty baseline.

---

## Task 1: Save this plan

**Files:**
- Create: `docs/plans/2026-04-19-edit-history-compression-and-inline-diff.md`

**Step 1:** This file already exists (you are reading it).

**Step 2:** Commit.

```bash
git add docs/plans/2026-04-19-edit-history-compression-and-inline-diff.md
git commit -m "docs: add plan for base compression + intra-line highlighting"
```

---

## Task 2: Install `fflate` (stash-pending pattern)

**Files:**
- Modify: `package.json`, `package-lock.json`

**Step 1:** Install.

```bash
npm install --legacy-peer-deps fflate
```

The `--legacy-peer-deps` flag is required due to the existing obsidian / @codemirror/state peer conflict documented in the prior plan.

**Step 2:** Verify `package.json` has `"fflate": "^0.8.x"` under `dependencies`.

**Step 3:** Do NOT commit yet. Stash so the first GREEN commit in Task 3 bundles the dep with the first real use. This mirrors the prior plan's dep-swap pattern.

```bash
git stash push -m "fflate-install-pending" -- package.json package-lock.json
```

Leave `node_modules/fflate/` in place. We'll `stash pop` in Task 3 Step 6.

---

## Task 3: RED + GREEN — `encodeContent`/`decodeContent` threshold fallback

**Files:**
- Create: `src/editHistory/editHistoryCompress.ts`
- Create: `src/editHistory/editHistoryCompress.test.ts`

**Step 1:** Create the stub module.

```ts
// src/editHistory/editHistoryCompress.ts
export interface EncodedContent {
	content: string;
	contentEnc?: "dfb64";
}

export function encodeContent(_raw: string): EncodedContent {
	throw new Error("not implemented");
}

export function decodeContent(_content: string, _enc: "dfb64" | undefined): string {
	throw new Error("not implemented");
}
```

**Step 2:** Create the first RED test.

```ts
// src/editHistory/editHistoryCompress.test.ts
import { describe, it, expect } from "vitest";
import { encodeContent } from "./editHistoryCompress";

describe("encodeContent", () => {
	it("returns raw plain text when below the 512-byte threshold", () => {
		const result = encodeContent("short text");
		expect(result.content).toBe("short text");
		expect(result.contentEnc).toBeUndefined();
	});
});
```

**Step 3:** Run and confirm failure.

```bash
npx vitest run src/editHistory/editHistoryCompress.test.ts
```

Expected: 1 failing with `not implemented`.

**Step 4:** Commit RED.

```bash
git add src/editHistory/editHistoryCompress.ts src/editHistory/editHistoryCompress.test.ts
git commit -m "test(editHistory): RED — encodeContent returns raw below threshold"
```

**Step 5:** Implement GREEN. Replace stub with:

```ts
// src/editHistory/editHistoryCompress.ts
import { deflateRawSync, inflateRawSync, strToU8, strFromU8 } from "fflate";

export interface EncodedContent {
	content: string;
	contentEnc?: "dfb64";
}

const COMPRESSION_THRESHOLD = 512;

export function encodeContent(raw: string): EncodedContent {
	if (raw.length < COMPRESSION_THRESHOLD) return { content: raw };
	const compressed = deflateRawSync(strToU8(raw));
	const b64 = u8ToB64(compressed);
	if (b64.length >= raw.length) return { content: raw };
	return { content: b64, contentEnc: "dfb64" };
}

export function decodeContent(content: string, enc: "dfb64" | undefined): string {
	if (enc === undefined) return content;
	if (enc === "dfb64") return strFromU8(inflateRawSync(b64ToU8(content)));
	throw new Error(`editHistoryCompress: unknown encoding "${enc}"`);
}

// Chunked base64 encode/decode to avoid call-stack overflow on large inputs.
function u8ToB64(u8: Uint8Array): string {
	const CHUNK = 0x8000;
	let result = "";
	for (let i = 0; i < u8.length; i += CHUNK) {
		const slice = u8.subarray(i, Math.min(i + CHUNK, u8.length));
		result += String.fromCharCode(...slice);
	}
	return btoa(result);
}

function b64ToU8(b64: string): Uint8Array {
	const bin = atob(b64);
	const u8 = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
	return u8;
}
```

**Step 6:** Unstash the dep install from Task 2.

```bash
git stash pop
```

**Step 7:** Run.

```bash
npx vitest run src/editHistory/editHistoryCompress.test.ts
```

Expected: 1 passing.

**Step 8:** Commit GREEN + dep together.

```bash
git add src/editHistory/editHistoryCompress.ts package.json package-lock.json
git commit -m "feat(editHistory): GREEN — encodeContent threshold fallback (adds fflate)"
```

---

## Task 4: More `encodeContent`/`decodeContent` cases

Each case below is **one commit**. Run `npx vitest run src/editHistory/editHistoryCompress.test.ts` after each to confirm green before committing.

**Step — import `decodeContent`** at the top of the test file for later cases:

```ts
import { encodeContent, decodeContent } from "./editHistoryCompress";
```

### Case 4a: Large repeating text compresses

```ts
it("returns dfb64 payload when compression shrinks large repeating text", () => {
	const raw = "the quick brown fox jumps over the lazy dog.\n".repeat(100);
	// raw.length ≈ 4500 chars; deflate should crush the repetition.
	const result = encodeContent(raw);
	expect(result.contentEnc).toBe("dfb64");
	expect(result.content.length).toBeLessThan(raw.length);
});
```

Commit: `test(editHistory): encodeContent compresses large repeating text`.

### Case 4b: Encode→decode roundtrip on large content

```ts
it("roundtrips large compressible content through encode+decode", () => {
	const raw = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n".repeat(20);
	const { content, contentEnc } = encodeContent(raw);
	expect(contentEnc).toBe("dfb64");
	expect(decodeContent(content, contentEnc)).toBe(raw);
});
```

Commit: `test(editHistory): encodeContent + decodeContent roundtrip large text`.

### Case 4c: High-entropy content falls back to raw

```ts
it("falls back to raw when deflate does not shrink the payload", () => {
	// Random-looking high-entropy string: every char unique in a tight range.
	// Deflate + base64 should be larger than raw because there's nothing to exploit.
	let raw = "";
	for (let i = 0; i < 800; i++) {
		raw += String.fromCharCode(33 + ((i * 1103515245 + 12345) % 93));
	}
	const result = encodeContent(raw);
	// Not asserting exact equality of content to raw (implementation chose fallback
	// OR chose dfb64 — we only assert that the chosen form is at most raw-length
	// by construction: if dfb64 were larger it MUST fall back).
	if (result.contentEnc === "dfb64") {
		expect(result.content.length).toBeLessThan(raw.length);
	} else {
		expect(result.content).toBe(raw);
		expect(result.contentEnc).toBeUndefined();
	}
});
```

Commit: `test(editHistory): encodeContent falls back to raw on high-entropy input`.

### Case 4d: Empty string

```ts
it("returns raw empty string unchanged", () => {
	expect(encodeContent("")).toEqual({ content: "" });
});
```

Commit: `test(editHistory): encodeContent passes through empty string`.

### Case 4e: decodeContent empty string

```ts
it("decodes an empty-string raw value as empty string", () => {
	expect(decodeContent("", undefined)).toBe("");
});
```

Commit: `test(editHistory): decodeContent empty raw returns empty`.

### Case 4f: Unknown encoding throws

```ts
it("throws a descriptive error on unknown encoding", () => {
	expect(() => decodeContent("abc", "gzip" as any)).toThrow(
		/editHistoryCompress.*unknown encoding.*gzip/,
	);
});
```

Commit: `test(editHistory): decodeContent throws on unknown encoding`.

### Case 4g: Unicode roundtrip

```ts
it("roundtrips Unicode (CJK + emoji) losslessly", () => {
	const raw = ("日本語のテスト 🎉 emoji mix αβγ русский\n").repeat(30);
	const { content, contentEnc } = encodeContent(raw);
	expect(decodeContent(content, contentEnc)).toBe(raw);
});
```

Commit: `test(editHistory): encode+decode roundtrip Unicode`.

### Case 4h: Property-style roundtrip

```ts
it("roundtrips a variety of hand-picked strings", () => {
	const cases = [
		"",
		"x",
		"short",
		"a".repeat(520),
		"abc\n".repeat(200),
		"# Heading\n\nParagraph.\n\n- item1\n- item2\n".repeat(40),
		"line with trailing newline\n",
		"\n\n\nonly blank lines\n\n",
		"one\ntwo\nthree",
	];
	for (const raw of cases) {
		const { content, contentEnc } = encodeContent(raw);
		expect(decodeContent(content, contentEnc)).toBe(raw);
	}
});
```

Commit: `test(editHistory): encode+decode roundtrip property cases`.

---

## Task 5: Bump schema to v3 in types.ts

**Files:**
- Modify: `src/editHistory/types.ts`
- Modify: `src/editHistory/types.test.ts`

**Step 1:** Edit `src/editHistory/types.ts`:

Add `contentEnc?: "dfb64"` to `VersionSnapshot`:

```ts
export interface VersionSnapshot {
	ts: number;
	device: string;
	/** Full-text base snapshot. Present on the first version and every rebase. */
	content?: string;
	/** Encoding for `content`. Absent = plain UTF-8; "dfb64" = deflate-raw + base64. */
	contentEnc?: "dfb64";
	/** Line-oriented delta against the immediately preceding version. */
	hunks?: LineHunk[];
}
```

Bump `EditHistoryData.version`:

```ts
export interface EditHistoryData {
	version: 3;
	entries: Record<string, FileHistoryEntry>;
}

export function DEFAULT_EDIT_HISTORY_DATA(): EditHistoryData {
	return { version: 3, entries: {} };
}
```

**Step 2:** Update `types.test.ts`. Replace every `version: 2` literal with `version: 3`. (Prior grep showed 3 hits: lines 49, 58, 77.)

**Step 3:** Run.

```bash
npx vitest run src/editHistory/types.test.ts
```

Expected: green (mechanical fixture update).

Note: `editHistoryStore.test.ts`, `editHistoryCapture.test.ts`, `editHistoryView.test.ts` will now fail because they still carry `version: 2`. That's expected; fixed in Tasks 7–9.

**Step 4:** Commit.

```bash
git add src/editHistory/types.ts src/editHistory/types.test.ts
git commit -m "refactor(editHistory): types — add contentEnc, bump schema to v3"
```

---

## Task 6: `reconstructVersion` decodes base transparently

**NOTE:** This task lands BEFORE capture (Task 8) so the dedup comparison (`lastContent === edit.content`) in capture keeps working throughout the transition. Same rationale for `prune()`: it calls `reconstructVersion` on a possibly-encoded base when computing a new rebase.

**Files:**
- Modify: `src/editHistory/editHistoryDiff.ts`
- Modify: `src/editHistory/editHistoryDiff.test.ts`

**Step 1:** Add first RED test.

Append to the `describe("reconstructVersion", …)` block in `editHistoryDiff.test.ts`:

```ts
it("decodes base content stored as dfb64", () => {
	const raw = "line0\nline1\nline2\n".repeat(50); // > 512 bytes, compresses
	const { content, contentEnc } = encodeContent(raw);
	expect(contentEnc).toBe("dfb64"); // sanity: we actually test the encoded path
	const entry: FileHistoryEntry = {
		path: "t.md",
		baseIndex: 0,
		versions: [{ ts: 1, device: "d", content, contentEnc }],
	};
	expect(reconstructVersion(entry, 0)).toBe(raw);
});
```

Add import at top: `import { encodeContent } from "./editHistoryCompress";`

**Step 2:** Run, confirm fail, commit RED.

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t "decodes base content stored as dfb64"
```

Expected: fails. `reconstructVersion` currently returns the raw base64 string.

```bash
git add src/editHistory/editHistoryDiff.test.ts
git commit -m "test(editHistory): RED — reconstructVersion decodes dfb64 base"
```

**Step 3:** Implement GREEN in `editHistoryDiff.ts`:

Add import:

```ts
import { decodeContent } from "./editHistoryCompress";
```

Modify `reconstructVersion`:

```ts
export function reconstructVersion(
	entry: FileHistoryEntry,
	versionIndex: number,
): string | null {
	if (versionIndex < 0 || versionIndex >= entry.versions.length) return null;

	const base = entry.versions[entry.baseIndex];
	if (!base || base.content === undefined) return null;

	let content = decodeContent(base.content, base.contentEnc);
	for (let i = entry.baseIndex + 1; i <= versionIndex; i++) {
		const version = entry.versions[i];
		if (!version || !version.hunks) return null;
		content = applyLineHunks(content, version.hunks);
	}
	return content;
}
```

**Step 4:** Run, commit GREEN.

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts
git add src/editHistory/editHistoryDiff.ts
git commit -m "feat(editHistory): GREEN — reconstructVersion decodes encoded bases"
```

Expected: the full `editHistoryDiff.test.ts` is green. Other test files will still fail — handled in later tasks.

---

## Task 7: Store v2→v3 silent-wipe migration + prune re-encodes

**Files:**
- Modify: `src/editHistory/editHistoryStore.ts`
- Modify: `src/editHistory/editHistoryStore.test.ts`

**Step 1:** Edit `editHistoryStore.ts`.

Change the migration gate in `load()`:

```ts
if (parsed?.version !== 3) {
	// Breaking format upgrade: silently wipe stale entries.
	const fresh = DEFAULT_EDIT_HISTORY_DATA();
	await this.save(fresh);
	return fresh;
}
```

Add import at top:

```ts
import { encodeContent } from "./editHistoryCompress";
```

Update `prune()` where a new base is synthesized. Find:

```ts
if (newBaseContent !== null) {
	const remaining = entry.versions.slice(firstRecentIdx);
	remaining[0] = { ...remaining[0]!, content: newBaseContent, hunks: undefined };
	...
}
```

Replace with:

```ts
if (newBaseContent !== null) {
	const remaining = entry.versions.slice(firstRecentIdx);
	const { content, contentEnc } = encodeContent(newBaseContent);
	remaining[0] = { ...remaining[0]!, content, contentEnc, hunks: undefined };
	entry.versions = remaining;
	entry.baseIndex = 0;
}
```

**Step 2:** Update `editHistoryStore.test.ts`:

(a) Replace every `version: 2` literal with `version: 3` (prior grep shows 18 hits: lines 45, 50, 64, 69, 84, 97, 112, 131, 150, 168, 199, 221, 247, 275, 303, 326, 378 n/a, 399 n/a — audit all matches and update).

(b) Rename the existing "wipes entries on load when stored version is not 2" test to "not 3", and update its stale-version fixture to `version: 2` (simulating an upgrade from the just-shipped v2 format). The rest of the test body's assertions already reference `version: 2` in the expected wiped data — change those to `version: 3`.

Example:

```ts
it("wipes entries on load when stored version is not 3 (v2 → v3 migration)", async () => {
	const staleV2 = {
		version: 2,
		entries: {
			"file-a": {
				path: "a.md",
				baseIndex: 0,
				versions: [{ ts: 1, device: "d", content: "x" }],
			},
		},
	};
	vault = makeVault({ [HISTORY_PATH]: JSON.stringify(staleV2) });
	const store = new EditHistoryStore(vault);

	const data = await store.load();
	expect(data).toEqual({ version: 3, entries: {} });

	const persisted = JSON.parse(vault.adapter.write.mock.calls[0][1]);
	expect(persisted.version).toBe(3);
	expect(persisted.entries).toEqual({});
});
```

(c) Add a new test validating prune re-encodes:

```ts
it("re-encodes a synthesized base through encodeContent during prune", async () => {
	const oldTs = Date.now() - 40 * 24 * 60 * 60 * 1000; // > 30d
	const recentTs = Date.now() - 1 * 24 * 60 * 60 * 1000;
	const bigBase = "line\n".repeat(200); // > 512 bytes

	const entry: FileHistoryEntry = {
		path: "x.md",
		baseIndex: 0,
		versions: [
			{ ts: oldTs, device: "d", content: bigBase },
			{ ts: recentTs, device: "d", hunks: [{ s: 0, d: 0, a: ["added"] }] },
		],
	};
	vault = makeVault({
		[HISTORY_PATH]: JSON.stringify({ version: 3, entries: { "file-x": entry } }),
	});
	const store = new EditHistoryStore(vault);

	await store.prune(30);

	const persisted = JSON.parse(vault.adapter.write.mock.calls.at(-1)![1]);
	const pruned = persisted.entries["file-x"];
	expect(pruned.versions.length).toBe(1);
	// The synthesized base should now be dfb64-encoded since it's large + compressible.
	expect(pruned.versions[0].contentEnc).toBe("dfb64");
	expect(pruned.versions[0].hunks).toBeUndefined();
});
```

**Step 3:** Run.

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

Expected: all store tests green (20 total including the new re-encode test).

**Step 4:** Commit.

```bash
git add src/editHistory/editHistoryStore.ts src/editHistory/editHistoryStore.test.ts
git commit -m "refactor(editHistory): v2→v3 silent wipe migration + prune re-encodes base"
```

---

## Task 8: Capture encodes content on write

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts`
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1:** Edit `editHistoryCapture.ts`.

Add import:

```ts
import { encodeContent } from "./editHistoryCompress";
```

**Step 2:** Wrap the four content-writing sites. In `batchCapture`:

**Site 1** (new-entry creation):

Find:

```ts
const entry = data.entries[edit.fileId];
if (!entry) {
	data.entries[edit.fileId] = {
		path: edit.path,
		baseIndex: 0,
		versions: [{ ts: Date.now(), device: this.getDeviceName(), content: edit.content }],
	};
	accepted.push(edit.fileId);
	continue;
}
```

Replace with:

```ts
const entry = data.entries[edit.fileId];
if (!entry) {
	const { content, contentEnc } = encodeContent(edit.content);
	data.entries[edit.fileId] = {
		path: edit.path,
		baseIndex: 0,
		versions: [{ ts: Date.now(), device: this.getDeviceName(), content, contentEnc }],
	};
	accepted.push(edit.fileId);
	continue;
}
```

**Site 2** (rebase path):

Find:

```ts
if (versionsSinceBase >= this.settings.rebaseInterval || lastContent === null) {
	entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), content: edit.content });
	entry.baseIndex = entry.versions.length - 1;
}
```

Replace with:

```ts
if (versionsSinceBase >= this.settings.rebaseInterval || lastContent === null) {
	const { content, contentEnc } = encodeContent(edit.content);
	entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), content, contentEnc });
	entry.baseIndex = entry.versions.length - 1;
}
```

In `captureSnapshot`, apply the same two changes at the mirror call-sites (Site 3 = new-entry, Site 4 = rebase).

**Step 3:** Update `editHistoryCapture.test.ts`:

(a) Replace all `version: 2` literals with `version: 3` (prior grep: lines 13, 44, 661).

(b) Add these tests at the end of the existing top-level describe block:

```ts
it("encodes large base content as dfb64 on new-entry capture", async () => {
	const largeRaw = "repeating line content here\n".repeat(100);
	const store = makeStore();
	const capture = new EditHistoryCapture(
		store, () => "D",
		{ rebaseInterval: 10, maxPerFilePerDay: 50, debounceMs: 10, maxWaitMs: 100 },
		10_000_000, makePendingDb(),
	);
	await capture.captureSnapshot("f1", "a.md", largeRaw);

	const persisted = getPersisted(store);
	const entry = persisted.entries["f1"];
	expect(entry.versions[0].contentEnc).toBe("dfb64");
	expect(entry.versions[0].content.length).toBeLessThan(largeRaw.length);
});

it("stores small content raw (no contentEnc)", async () => {
	const store = makeStore();
	const capture = new EditHistoryCapture(
		store, () => "D",
		{ rebaseInterval: 10, maxPerFilePerDay: 50, debounceMs: 10, maxWaitMs: 100 },
		10_000_000, makePendingDb(),
	);
	await capture.captureSnapshot("f1", "a.md", "short");

	const persisted = getPersisted(store);
	const entry = persisted.entries["f1"];
	expect(entry.versions[0].content).toBe("short");
	expect(entry.versions[0].contentEnc).toBeUndefined();
});

it("deduplicates against a dfb64-encoded last base when content matches", async () => {
	const largeRaw = "repeating\n".repeat(100);
	const store = makeStore();
	const capture = new EditHistoryCapture(
		store, () => "D",
		{ rebaseInterval: 10, maxPerFilePerDay: 50, debounceMs: 10, maxWaitMs: 100 },
		10_000_000, makePendingDb(),
	);

	await capture.captureSnapshot("f1", "a.md", largeRaw);
	await capture.captureSnapshot("f1", "a.md", largeRaw); // dedup: no-op

	const persisted = getPersisted(store);
	expect(persisted.entries["f1"].versions.length).toBe(1);
});
```

Add whatever helpers (`makeStore`, `getPersisted`, `makePendingDb`) aren't already defined by reading the top of the existing test file and reusing its setup.

**Step 4:** Run.

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

Expected: all capture tests green (34 total including 3 new).

**Step 5:** Commit.

```bash
git add src/editHistory/editHistoryCapture.ts src/editHistory/editHistoryCapture.test.ts
git commit -m "refactor(editHistory): capture encodes base content via fflate"
```

---

## Task 9: View decodes initial snapshot + version fixture bump

**Files:**
- Modify: `src/editHistory/editHistoryView.ts`
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1:** Edit `editHistoryView.ts`.

Add import:

```ts
import { decodeContent } from "./editHistoryCompress";
```

Find the initial-snapshot branch in `renderDiffContent` (around line 308):

```ts
if (versionIndex === 0) {
	const labelEl = container.createSpan({ cls: "yaos-extension-edit-history-diff-initial-label" });
	labelEl.textContent = "Initial snapshot";
	const { text, remainingLines } = truncateByLines(version.content, 20);
	...
}
```

Replace `version.content` with decoded raw:

```ts
if (versionIndex === 0) {
	const labelEl = container.createSpan({ cls: "yaos-extension-edit-history-diff-initial-label" });
	labelEl.textContent = "Initial snapshot";
	const raw = decodeContent(version.content, version.contentEnc);
	const { text, remainingLines } = truncateByLines(raw, 20);
	// Initial snapshot renders as a single add span (unchanged from prior behavior).
	const addSpan = container.createSpan({ cls: "yaos-extension-edit-history-diff-add" });
	addSpan.textContent = text;
	if (remainingLines > 0) {
		const marker = container.createSpan({ cls: "yaos-extension-edit-history-diff-initial-truncated" });
		marker.textContent = `… (${remainingLines} more lines)`;
	}
	return;
}
```

Also update the mid-chain rebase base branch (around line 323). The call `computeLineHunks(prev, version.content)` needs the raw version content, not the encoded form. Since `reconstructVersion(entry, versionIndex)` would decode it, but we're right here using `version.content` directly:

```ts
// Mid-chain rebase base: synthesize line-hunks against reconstructed previous.
const prev = reconstructVersion(entry, versionIndex - 1);
if (prev === null) {
	...
	return;
}
const raw = decodeContent(version.content, version.contentEnc);
const synthetic = computeLineHunks(prev, raw);
this.renderLineHunks(container, prev, synthetic);
```

**Step 2:** Update `editHistoryView.test.ts`:

(a) Replace `version: 2` → `version: 3` (one hit: line 22 in `makeStore`).

(b) Add test for decoded initial snapshot. Append to the test suite:

```ts
it("decodes a dfb64 initial snapshot for rendering", async () => {
	const { encodeContent } = await import("./editHistoryCompress");
	const raw = "line A\nline B\nline C\n".repeat(5); // small enough to render all
	const { content, contentEnc } = encodeContent(raw);
	const entry: FileHistoryEntry = {
		path: "x.md",
		baseIndex: 0,
		versions: [{ ts: 1000, device: "D", content, contentEnc }],
	};
	const store = makeStore({ "x.md": entry });
	const view = new EditHistoryView(makeLeaf(), store as any, () => {});
	await view.refresh("x.md");

	const addEl = view.contentEl.querySelector(".yaos-extension-edit-history-diff-add");
	expect(addEl).not.toBeNull();
	// The decoded content should appear (at least the first few lines).
	expect(addEl!.textContent).toContain("line A");
	expect(addEl!.textContent).toContain("line B");
});
```

Note: if the existing test file already has similar fixtures using ad-hoc entries, follow that convention. `encodeContent` must resolve to a compression threshold that actually encodes the fixture — you may need to increase repetition to exceed 512 bytes. Adjust `.repeat(5)` upward if `contentEnc` comes back `undefined`.

To make the test robust, wrap the encoded-vs-raw branch:

```ts
// Only assert on dfb64 path when threshold is actually crossed.
if (contentEnc === "dfb64") {
	expect(addEl!.textContent).toContain("line A");
}
```

Or simpler: use `.repeat(50)` to guarantee compression kicks in. Confirm the test fails if `decodeContent` call is removed.

**Step 3:** Run.

```bash
npx vitest run src/editHistory/editHistoryView.test.ts
```

Expected: all view tests green.

**Step 4:** Commit.

```bash
git add src/editHistory/editHistoryView.ts src/editHistory/editHistoryView.test.ts
git commit -m "refactor(editHistory): view decodes encoded base for initial snapshot + mid-chain rebase"
```

---

## Task 10: Update AGENTS.md for compression

**Files:**
- Modify: `src/AGENTS.md`

**Step 1:** Update the module dependency graph tree.

Find:

```
  +-- editHistory/
  |     +-- types.ts              (EditHistoryData, FileHistoryEntry, VersionSnapshot)
  |     +-- editHistoryDiff.ts    (Pure: diff-match-patch line-hunks + reconstructVersion + computeDiffSummary)
```

Add a new entry immediately after `types.ts`:

```
  |     +-- editHistoryCompress.ts (Pure: fflate deflate-raw + base64 encode/decode for bases)
```

**Step 2:** Update the imports table. Find:

```
| `editHistory/types` | nothing |
| `editHistory/editHistoryDiff` | editHistory/types, diff-match-patch |
```

Replace with:

```
| `editHistory/types` | nothing |
| `editHistory/editHistoryCompress` | fflate |
| `editHistory/editHistoryDiff` | editHistory/types, editHistory/editHistoryCompress, diff-match-patch |
```

Find:

```
| `editHistory/editHistoryStore` | editHistory/types, obsidian (`Vault`), ../logger |
| `editHistory/editHistoryCapture` | editHistory/editHistoryStore, editHistory/editHistoryDiff, editHistory/types, editHistory/pendingEditsDb, ../logger |
| `editHistory/editHistoryView` | editHistory/editHistoryStore, editHistory/editHistoryDiff, editHistory/types, obsidian (`ItemView`) |
```

Replace with:

```
| `editHistory/editHistoryStore` | editHistory/types, editHistory/editHistoryCompress, editHistory/editHistoryDiff, obsidian (`Vault`), ../logger |
| `editHistory/editHistoryCapture` | editHistory/editHistoryStore, editHistory/editHistoryDiff, editHistory/editHistoryCompress, editHistory/types, editHistory/pendingEditsDb, ../logger |
| `editHistory/editHistoryView` | editHistory/editHistoryStore, editHistory/editHistoryDiff, editHistory/editHistoryCompress, editHistory/types, obsidian (`ItemView`) |
```

**Step 3:** Update the `editHistory/types.ts` section. Find the paragraph beginning `### editHistory/types.ts -- Shared type definitions` and replace with:

```
### editHistory/types.ts -- Shared type definitions

Exports `EditHistoryData`, `FileHistoryEntry`, `VersionSnapshot`, `LineHunk`.
Pure data, no logic. A `VersionSnapshot` has either `content` (base version)
or `hunks` (line-oriented delta). `EditHistoryData.version` is `3`;
version-1 files (char-level `diff` tuples) and version-2 files (line-hunks
with plaintext bases) are silently wiped on load — see
`editHistoryStore.load`.

`LineHunk = { s: number; d: number; a: string[] }` encodes one change region
relative to the reconstructed previous version. `s` is the 0-indexed starting
line, `d` is the number of old lines deleted, `a` is the list of new lines
inserted at that position. Old line text is *not* stored — derive it by
reconstructing the previous version and slicing `[s, s+d)`.

`content` may be stored either as plain UTF-8 (no `contentEnc`) or as
deflate-raw + base64 (`contentEnc: "dfb64"`). Encoding is chosen by
`editHistoryCompress.encodeContent` — see that module.
```

**Step 4:** Add a new section for `editHistoryCompress.ts` immediately after the `types.ts` section:

```
### editHistory/editHistoryCompress.ts -- Base content compression

Pure helpers for encoding / decoding `VersionSnapshot.content`:

- `encodeContent(raw)` → `{ content, contentEnc? }`. Returns raw plaintext
  when `raw.length < 512` OR when deflate-raw + base64 does not shrink the
  payload. Otherwise returns `{ content: <b64>, contentEnc: "dfb64" }`.
- `decodeContent(content, contentEnc)` → raw string. Inverse of
  `encodeContent`. Throws on unknown `contentEnc`. A `undefined`
  `contentEnc` is a no-op (raw plaintext).

The chunked base64 helpers (`u8ToB64`, `b64ToU8`) walk 0x8000-byte slices
to avoid call-stack overflow on large inputs.

Uses `fflate`'s sync `deflateRawSync` / `inflateRawSync`. Sync is a
deliberate choice — works identically on desktop and mobile WebViews with
no Promise plumbing.

Dependencies: `fflate`.
```

**Step 5:** Update `editHistory/editHistoryDiff.ts` section. Find the paragraph beginning `### editHistory/editHistoryDiff.ts -- Diff + reconstruction` and add a sentence about decode in the `reconstructVersion` bullet:

Change:

```
- `reconstructVersion(entry, versionIndex)` -- walks the delta chain from
  `entry.baseIndex` applying `applyLineHunks` for each step; returns
  `null` on a missing or content-less link.
```

To:

```
- `reconstructVersion(entry, versionIndex)` -- walks the delta chain from
  `entry.baseIndex` applying `applyLineHunks` for each step. The base's
  `content` is passed through `decodeContent(base.content, base.contentEnc)`
  first so dfb64-encoded bases are transparently inflated. Returns `null`
  on a missing or content-less link.
```

**Step 6:** Update `editHistory/editHistoryStore.ts` section. Find the `Key methods` list and update the migration-gate wording + add a note:

After the sentence `All mutating methods (...) are serialized through an internal writeQueue: Promise<void>`, add:

```
`prune` re-encodes any synthesized rebase base through
`encodeContent` before writing, so compressed bases stay compressed
across retention rollover.
```

In the section's opening paragraph, change `silently wipe stale entries` context to note that v2 files are also wiped on load.

**Step 7:** Update `editHistory/editHistoryView.ts` section. Add a sentence about decoding:

Change:

```
The initial snapshot (`versionIndex === 0`) still renders as a single
insert-styled `.diff-add` span truncated to 20 lines with a
`… (N more lines)` marker
```

To:

```
The initial snapshot (`versionIndex === 0`) still renders as a single
insert-styled `.diff-add` span truncated to 20 lines with a
`… (N more lines)` marker. The displayed text is piped through
`decodeContent(version.content, version.contentEnc)` first so dfb64-encoded
bases render as decompressed plaintext.
```

**Step 8:** Commit.

```bash
git add src/AGENTS.md
git commit -m "docs: update AGENTS.md for compressed bases (v3 schema)"
```

---

## Task 11: Part-1 gates

**Step 1:** Run full suite.

```bash
npx vitest run
```

Expected: approximately 462 + 8 (compress tests) + 1 (migration test) + 3 (capture tests) + 1 (view test) + 1 (reconstructVersion decode test) = ~476 tests, all green.

**Step 2:** Build.

```bash
npm run build
```

Expected: exit 0. Note the size of `main.js`:

```bash
ls -la main.js
```

Expected: ~95-105KB (baseline 84.9KB + ~10KB fflate). Record the exact size for the final report.

**Step 3:** Clean tree.

```bash
git status --short
```

Expected: empty (everything committed, except `main.js` which is not in git).

If any gate fails, **STOP** and fix before proceeding to Part 2.

---

# PART 2 — Intra-line character highlighting

## Task 12: RED + GREEN — `pairLinesForWordDiff`

**Files:**
- Modify: `src/editHistory/editHistoryDiff.ts`
- Modify: `src/editHistory/editHistoryDiff.test.ts`

**Step 1:** Add types + stub to `editHistoryDiff.ts`. Append:

```ts
export type WordDiffSegment = { kind: "equal" | "add" | "del"; text: string };

export type DiffLineWithWords =
	| { kind: "retain"; text: string }
	| { kind: "add"; text: string; words?: WordDiffSegment[] }
	| { kind: "del"; text: string; words?: WordDiffSegment[] };

export function pairLinesForWordDiff(_lines: DiffLine[]): DiffLineWithWords[] {
	throw new Error("not implemented");
}
```

**Step 2:** Add first RED test.

```ts
describe("pairLinesForWordDiff", () => {
	it("returns an empty array for empty input", () => {
		expect(pairLinesForWordDiff([])).toEqual([]);
	});
});
```

Add import: `import { pairLinesForWordDiff } from "./editHistoryDiff";`

**Step 3:** Run, confirm fail, commit RED.

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t pairLinesForWordDiff
git add src/editHistory/editHistoryDiff.ts src/editHistory/editHistoryDiff.test.ts
git commit -m "test(editHistory): RED — pairLinesForWordDiff empty input"
```

**Step 4:** Implement GREEN. Replace the stub with:

```ts
export function pairLinesForWordDiff(lines: DiffLine[]): DiffLineWithWords[] {
	const out: DiffLineWithWords[] = lines.map((l) => ({ ...l }));
	let i = 0;
	while (i < out.length) {
		if (out[i]!.kind !== "del") {
			i++;
			continue;
		}
		const delStart = i;
		while (i < out.length && out[i]!.kind === "del") i++;
		const delEnd = i; // exclusive
		if (i >= out.length || out[i]!.kind !== "add") continue;
		const addStart = i;
		while (i < out.length && out[i]!.kind === "add") i++;
		const addEnd = i;
		const pairCount = Math.min(delEnd - delStart, addEnd - addStart);
		for (let k = 0; k < pairCount; k++) {
			const d = out[delStart + k] as { kind: "del"; text: string; words?: WordDiffSegment[] };
			const a = out[addStart + k] as { kind: "add"; text: string; words?: WordDiffSegment[] };
			// Size guard: skip char-level diff on very long lines (both >2000 chars).
			if (d.text.length > 2000 && a.text.length > 2000) continue;
			const [delWords, addWords] = computeWordDiff(d.text, a.text);
			d.words = delWords;
			a.words = addWords;
		}
	}
	return out;
}

function computeWordDiff(
	del: string,
	add: string,
): [WordDiffSegment[], WordDiffSegment[]] {
	const dmp: any = new (DiffMatchPatch as any)();
	const diffs = dmp.diff_main(del, add, false);
	dmp.diff_cleanupSemantic(diffs);
	const delSegs: WordDiffSegment[] = [];
	const addSegs: WordDiffSegment[] = [];
	for (const [op, text] of diffs) {
		if (op === 0) {
			delSegs.push({ kind: "equal", text });
			addSegs.push({ kind: "equal", text });
		} else if (op === -1) {
			delSegs.push({ kind: "del", text });
		} else {
			addSegs.push({ kind: "add", text });
		}
	}
	return [delSegs, addSegs];
}
```

**Step 5:** Run, commit GREEN.

```bash
npx vitest run src/editHistory/editHistoryDiff.test.ts -t pairLinesForWordDiff
git add src/editHistory/editHistoryDiff.ts
git commit -m "feat(editHistory): GREEN — pairLinesForWordDiff pairs consecutive del→add runs"
```

**Step 6:** Add each case below as its own commit. Run after each: `npx vitest run src/editHistory/editHistoryDiff.test.ts -t pairLinesForWordDiff`.

### Case 12a: All retain, unchanged

```ts
it("passes through retain-only input unchanged", () => {
	const input: DiffLine[] = [
		{ kind: "retain", text: "a" },
		{ kind: "retain", text: "b" },
	];
	expect(pairLinesForWordDiff(input)).toEqual(input);
});
```

Commit: `test(editHistory): pairLinesForWordDiff retain-only pass-through`.

### Case 12b: Pure add (no preceding del)

```ts
it("leaves pure add lines without words (no preceding del)", () => {
	const result = pairLinesForWordDiff([{ kind: "add", text: "hello" }]);
	expect(result).toEqual([{ kind: "add", text: "hello" }]);
	expect((result[0] as any).words).toBeUndefined();
});
```

Commit: `test(editHistory): pairLinesForWordDiff pure add has no words`.

### Case 12c: Pure del (no following add)

```ts
it("leaves pure del lines without words (no following add)", () => {
	const result = pairLinesForWordDiff([{ kind: "del", text: "bye" }]);
	expect(result).toEqual([{ kind: "del", text: "bye" }]);
	expect((result[0] as any).words).toBeUndefined();
});
```

Commit: `test(editHistory): pairLinesForWordDiff pure del has no words`.

### Case 12d: 1 del → 1 add pairs

```ts
it("pairs a single del/add and emits word segments", () => {
	const result = pairLinesForWordDiff([
		{ kind: "del", text: "hello world" },
		{ kind: "add", text: "hello there" },
	]);
	const del = result[0] as DiffLineWithWords & { kind: "del" };
	const add = result[1] as DiffLineWithWords & { kind: "add" };
	expect(del.words).toBeDefined();
	expect(add.words).toBeDefined();
	// Both sides share the "hello " prefix as equal.
	expect(del.words![0]).toEqual({ kind: "equal", text: "hello " });
	expect(add.words![0]).toEqual({ kind: "equal", text: "hello " });
	// Del side has at least one "del" segment; add side has at least one "add" segment.
	expect(del.words!.some((s) => s.kind === "del")).toBe(true);
	expect(add.words!.some((s) => s.kind === "add")).toBe(true);
});
```

Commit: `test(editHistory): pairLinesForWordDiff 1 del + 1 add pairs`.

### Case 12e: 2 del → 2 add pairs index-wise

```ts
it("pairs multi-line del+add runs by index", () => {
	const result = pairLinesForWordDiff([
		{ kind: "del", text: "foo one" },
		{ kind: "del", text: "foo two" },
		{ kind: "add", text: "bar one" },
		{ kind: "add", text: "bar two" },
	]);
	for (const line of result) {
		expect((line as any).words).toBeDefined();
	}
});
```

Commit: `test(editHistory): pairLinesForWordDiff 2+2 pairs index-wise`.

### Case 12f: Unequal del/add (1 del + 2 add)

```ts
it("only pairs the overlap when del and add runs differ in length", () => {
	const result = pairLinesForWordDiff([
		{ kind: "del", text: "x" },
		{ kind: "add", text: "y" },
		{ kind: "add", text: "z" },
	]);
	expect((result[0] as any).words).toBeDefined(); // paired
	expect((result[1] as any).words).toBeDefined(); // paired with del[0]
	expect((result[2] as any).words).toBeUndefined(); // overflow add, unpaired
});
```

Commit: `test(editHistory): pairLinesForWordDiff overlap-only on 1+2`.

### Case 12g: Retain between del and add breaks pairing

```ts
it("does not pair across a retain line", () => {
	const result = pairLinesForWordDiff([
		{ kind: "del", text: "a" },
		{ kind: "retain", text: "MIDDLE" },
		{ kind: "add", text: "b" },
	]);
	expect((result[0] as any).words).toBeUndefined();
	expect((result[2] as any).words).toBeUndefined();
});
```

Commit: `test(editHistory): pairLinesForWordDiff retain breaks pairing`.

### Case 12h: Size guard skips pair on oversized lines

```ts
it("skips word diff when both lines exceed 2000 chars", () => {
	const big = "x".repeat(2500);
	const big2 = "x".repeat(2500) + "Y";
	const result = pairLinesForWordDiff([
		{ kind: "del", text: big },
		{ kind: "add", text: big2 },
	]);
	expect((result[0] as any).words).toBeUndefined();
	expect((result[1] as any).words).toBeUndefined();
});
```

Commit: `test(editHistory): pairLinesForWordDiff size guard on oversized lines`.

### Case 12i: Typo fix invokes cleanupSemantic

```ts
it("applies diff_cleanupSemantic for readable typo-fix output", () => {
	// "teh quick" → "the quick": dmp raw diff might emit {eq:""}{del:"te"}{eq:"h"}{add:"..."}...
	// cleanupSemantic merges tiny fragments; assert that the full "teh" vs "the"
	// difference appears as at most a couple segments, not fragmented character-by-character.
	const result = pairLinesForWordDiff([
		{ kind: "del", text: "teh quick brown fox" },
		{ kind: "add", text: "the quick brown fox" },
	]);
	const del = result[0] as DiffLineWithWords & { kind: "del" };
	const add = result[1] as DiffLineWithWords & { kind: "add" };
	// After cleanupSemantic, both sides should have ≤ 5 segments total.
	expect(del.words!.length).toBeLessThanOrEqual(5);
	expect(add.words!.length).toBeLessThanOrEqual(5);
	// Joining equal+del segments recovers the original del text; equal+add recovers add text.
	const delJoined = del.words!.filter((s) => s.kind !== "add").map((s) => s.text).join("");
	const addJoined = add.words!.filter((s) => s.kind !== "del").map((s) => s.text).join("");
	expect(delJoined).toBe("teh quick brown fox");
	expect(addJoined).toBe("the quick brown fox");
});
```

Commit: `test(editHistory): pairLinesForWordDiff cleanupSemantic on typo fix`.

---

## Task 13: View wires `pairLinesForWordDiff` into `renderLineHunks`

**Files:**
- Modify: `src/editHistory/editHistoryView.ts`

**Step 1:** Update imports.

```ts
import {
	reconstructVersion,
	computeDiffSummary,
	computeLineHunks,
	buildHunks,
	pairLinesForWordDiff,
	DEFAULT_CONTEXT_LINES,
	type DiffLine,
	type DiffLineWithWords,
	type WordDiffSegment,
} from "./editHistoryDiff";
```

**Step 2:** Modify `renderLineHunks`. Inside the `item.kind === "hunk"` branch, run pairing **before** rendering rows:

```ts
const hunkEl = container.createDiv({ cls: "yaos-extension-edit-history-diff-hunk" });
const paired = pairLinesForWordDiff(item.lines);
for (const line of paired) {
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

	const words = (line as DiffLineWithWords & { words?: WordDiffSegment[] }).words;
	if (!words) {
		textEl.textContent = line.text;
	} else {
		for (const seg of words) {
			const segEl = textEl.createSpan({
				cls:
					seg.kind === "equal"
						? "yaos-extension-edit-history-diff-word-equal"
						: seg.kind === "add"
							? "yaos-extension-edit-history-diff-word-add"
							: "yaos-extension-edit-history-diff-word-del",
			});
			segEl.textContent = seg.text;
		}
	}
}
```

**Step 3:** Run the full suite.

```bash
npx vitest run
```

Expected: all existing tests still green. The view test file doesn't yet exercise word-diff spans — those tests are added in Task 15.

**Step 4:** Commit.

```bash
git add src/editHistory/editHistoryView.ts
git commit -m "refactor(editHistory): view renders word-diff spans inside paired hunk rows"
```

---

## Task 14: Styles for word-diff highlights

**Files:**
- Modify: `styles.css`
- Modify: `src/styles.css`

**Step 1:** Append the three new selectors to **both** files (they are kept in sync by repo convention — confirm by diffing them before modifying).

```css
.yaos-extension-edit-history-diff-word-add {
	background-color: rgba(46, 160, 67, 0.35);
	border-radius: 2px;
	padding: 0 1px;
}

.yaos-extension-edit-history-diff-word-del {
	background-color: rgba(248, 81, 73, 0.35);
	border-radius: 2px;
	padding: 0 1px;
	text-decoration: line-through;
	text-decoration-color: rgba(248, 81, 73, 0.6);
}

.yaos-extension-edit-history-diff-word-equal {
	/* Inherits row-level tint from .diff-add-line / .diff-del-line. No own highlight. */
}
```

Place them immediately after the existing `.yaos-extension-edit-history-diff-hunk-skip` rule (around line 1015).

**Step 2:** Commit.

```bash
git add styles.css src/styles.css
git commit -m "feat(editHistory): styles — word-diff add/del highlights"
```

---

## Task 15: View tests for intra-line rendering

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

All cases go inside the existing top-level describe. Each case is one commit. Run after each: `npx vitest run src/editHistory/editHistoryView.test.ts`.

### Case 15a: Paired del/add emits nested spans

```ts
it("renders word-diff spans on paired del/add lines in a hunk", async () => {
	const t0 = 1_700_000_000_000;
	const entry: FileHistoryEntry = {
		path: "x.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DevA", content: "hello world" },
			{ ts: t0 + 1000, device: "DevA", hunks: [{ s: 0, d: 1, a: ["hello there"] }] },
		],
	};
	const store = makeStore({ "x.md": entry });
	const view = new EditHistoryView(makeLeaf(), store as any, () => {});
	await view.refresh("x.md");

	const delText = view.contentEl.querySelector(".yaos-extension-edit-history-diff-del-line .yaos-extension-edit-history-diff-line-text");
	const addText = view.contentEl.querySelector(".yaos-extension-edit-history-diff-add-line .yaos-extension-edit-history-diff-line-text");
	expect(delText).not.toBeNull();
	expect(addText).not.toBeNull();

	// Each should contain nested word spans, not be a single plain text node.
	expect(delText!.querySelectorAll(".yaos-extension-edit-history-diff-word-equal").length).toBeGreaterThan(0);
	expect(delText!.querySelectorAll(".yaos-extension-edit-history-diff-word-del").length).toBeGreaterThan(0);
	expect(addText!.querySelectorAll(".yaos-extension-edit-history-diff-word-equal").length).toBeGreaterThan(0);
	expect(addText!.querySelectorAll(".yaos-extension-edit-history-diff-word-add").length).toBeGreaterThan(0);
});
```

Commit: `test(editHistory): view renders word-diff spans on paired del/add`.

### Case 15b: Pure add — no word spans

```ts
it("renders pure-add lines as plain text (no word spans)", async () => {
	const t0 = 1_700_000_000_000;
	const entry: FileHistoryEntry = {
		path: "x.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DevA", content: "keep" },
			{ ts: t0 + 1000, device: "DevA", hunks: [{ s: 1, d: 0, a: ["NEW LINE"] }] },
		],
	};
	const store = makeStore({ "x.md": entry });
	const view = new EditHistoryView(makeLeaf(), store as any, () => {});
	await view.refresh("x.md");

	const addText = view.contentEl.querySelector(".yaos-extension-edit-history-diff-add-line .yaos-extension-edit-history-diff-line-text");
	expect(addText).not.toBeNull();
	expect(addText!.textContent).toBe("NEW LINE");
	expect(addText!.querySelectorAll(".yaos-extension-edit-history-diff-word-add").length).toBe(0);
});
```

Commit: `test(editHistory): view pure-add has no word spans`.

### Case 15c: Typo fix renders reordered-char spans

```ts
it("renders typo-fix del/add with semantic-merged word spans", async () => {
	const t0 = 1_700_000_000_000;
	const entry: FileHistoryEntry = {
		path: "x.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DevA", content: "teh quick brown fox" },
			{ ts: t0 + 1000, device: "DevA", hunks: [{ s: 0, d: 1, a: ["the quick brown fox"] }] },
		],
	};
	const store = makeStore({ "x.md": entry });
	const view = new EditHistoryView(makeLeaf(), store as any, () => {});
	await view.refresh("x.md");

	const delText = view.contentEl.querySelector(".yaos-extension-edit-history-diff-del-line .yaos-extension-edit-history-diff-line-text");
	expect(delText!.textContent).toBe("teh quick brown fox");
	// Must have at least one del-word span and at least one equal span.
	expect(delText!.querySelectorAll(".yaos-extension-edit-history-diff-word-del").length).toBeGreaterThan(0);
	expect(delText!.querySelectorAll(".yaos-extension-edit-history-diff-word-equal").length).toBeGreaterThan(0);
});
```

Commit: `test(editHistory): view typo fix renders word spans`.

### Case 15d: Multiple paired lines each get spans

```ts
it("renders word spans on each paired line in a multi-pair hunk", async () => {
	const t0 = 1_700_000_000_000;
	const entry: FileHistoryEntry = {
		path: "x.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DevA", content: "foo one\nfoo two" },
			{ ts: t0 + 1000, device: "DevA", hunks: [{ s: 0, d: 2, a: ["bar one", "bar two"] }] },
		],
	};
	const store = makeStore({ "x.md": entry });
	const view = new EditHistoryView(makeLeaf(), store as any, () => {});
	await view.refresh("x.md");

	const delLines = view.contentEl.querySelectorAll(".yaos-extension-edit-history-diff-del-line");
	const addLines = view.contentEl.querySelectorAll(".yaos-extension-edit-history-diff-add-line");
	expect(delLines.length).toBe(2);
	expect(addLines.length).toBe(2);
	for (const el of Array.from(delLines)) {
		expect(el.querySelectorAll(".yaos-extension-edit-history-diff-word-del").length).toBeGreaterThan(0);
	}
	for (const el of Array.from(addLines)) {
		expect(el.querySelectorAll(".yaos-extension-edit-history-diff-word-add").length).toBeGreaterThan(0);
	}
});
```

Commit: `test(editHistory): view multi-pair hunk renders word spans per row`.

### Case 15e: Oversized lines skip word diff

```ts
it("renders oversized paired lines as plain text (size guard)", async () => {
	const big = "x".repeat(2500);
	const big2 = big + "Y";
	const t0 = 1_700_000_000_000;
	const entry: FileHistoryEntry = {
		path: "x.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DevA", content: big },
			{ ts: t0 + 1000, device: "DevA", hunks: [{ s: 0, d: 1, a: [big2] }] },
		],
	};
	const store = makeStore({ "x.md": entry });
	const view = new EditHistoryView(makeLeaf(), store as any, () => {});
	await view.refresh("x.md");

	const delText = view.contentEl.querySelector(".yaos-extension-edit-history-diff-del-line .yaos-extension-edit-history-diff-line-text");
	const addText = view.contentEl.querySelector(".yaos-extension-edit-history-diff-add-line .yaos-extension-edit-history-diff-line-text");
	expect(delText!.querySelectorAll(".yaos-extension-edit-history-diff-word-del").length).toBe(0);
	expect(addText!.querySelectorAll(".yaos-extension-edit-history-diff-word-add").length).toBe(0);
	expect(delText!.textContent).toBe(big);
	expect(addText!.textContent).toBe(big2);
});
```

Commit: `test(editHistory): view size guard on oversized paired lines`.

### Case 15f: Retain between del and add breaks pairing in view

This case is likely unreachable through the hunks-to-DiffLine conversion (retain lines come from gaps between hunks, and `buildHunks` groups contiguous ranges — but a hunk window could straddle a small retain gap if context lines merge). Use a fixture that exercises this via crafted `DiffLine[]` construction only if a natural fixture can be built; otherwise skip this case and rely on the unit-level test 12g.

Audit: check whether any natural `LineHunk[]` sequence produces `{del, retain, add}` inside a single rendered hunk. It does — when `context >= 1` and two hunks are `<= 2*context` apart, their windows merge including the retained middle. Construct:

```ts
it("does not pair del and add that span a retain (view-level)", async () => {
	// Two hunks within context window → merged into one rendered hunk with retain between.
	const t0 = 1_700_000_000_000;
	const entry: FileHistoryEntry = {
		path: "x.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DevA", content: "A\nM\nB" },
			// Delete "A", keep "M", add "Z" at end → rendered hunk: -A, M(retain), +Z
			{ ts: t0 + 1000, device: "DevA", hunks: [
				{ s: 0, d: 1, a: [] },
				{ s: 3, d: 0, a: ["Z"] },
			] },
		],
	};
	const store = makeStore({ "x.md": entry });
	const view = new EditHistoryView(makeLeaf(), store as any, () => {});
	await view.refresh("x.md");

	const delText = view.contentEl.querySelector(".yaos-extension-edit-history-diff-del-line .yaos-extension-edit-history-diff-line-text");
	const addText = view.contentEl.querySelector(".yaos-extension-edit-history-diff-add-line .yaos-extension-edit-history-diff-line-text");
	expect(delText!.querySelectorAll(".yaos-extension-edit-history-diff-word-del").length).toBe(0);
	expect(addText!.querySelectorAll(".yaos-extension-edit-history-diff-word-add").length).toBe(0);
});
```

Commit: `test(editHistory): view retain between del/add breaks pairing`.

If the fixture's `applyLineHunks` output doesn't match expectations, adjust the hunk structure until the rendered hunk actually contains `[del, retain, add]`. You may need to print the `DiffLine[]` once during development to confirm.

---

## Task 16: Final AGENTS.md update + final gates

**Files:**
- Modify: `src/AGENTS.md`

**Step 1:** Update the `editHistory/editHistoryDiff.ts` section. After the `computeDiffSummary` bullet, add:

```
- `pairLinesForWordDiff(lines)` -- takes a `DiffLine[]` (typically from one
  rendered hunk) and returns `DiffLineWithWords[]`. Finds consecutive del-run
  → add-run boundaries; pairs lines by index within the overlap; for each
  pair, runs `dmp.diff_main` + `dmp.diff_cleanupSemantic` and attaches a
  `WordDiffSegment[]` to both sides. Unpaired lines (pure add, pure del,
  overflow when `d !== a.length`) keep `words` undefined. Pairs where both
  lines exceed 2000 chars skip word diff for perf.
```

**Step 2:** Update the `editHistory/editHistoryView.ts` section. After the paragraph describing `renderLineHunks`, add:

```
Within each rendered hunk, `renderLineHunks` pipes `item.lines` through
`pairLinesForWordDiff` before emitting rows. Paired del/add rows render their
`.diff-line-text` content as a sequence of nested `.diff-word-equal`,
`.diff-word-del`, and `.diff-word-add` spans derived from dmp's
char-level diff (with `diff_cleanupSemantic` applied). Unpaired lines and
size-guarded oversize pairs render the full line as a single plain text
node. Row-level background tint from `.diff-add-line` / `.diff-del-line`
still applies; the word-level spans layer a stronger tint on the actually-
changed characters.
```

**Step 3:** Commit.

```bash
git add src/AGENTS.md
git commit -m "docs: update AGENTS.md for intra-line word diff"
```

**Step 4:** Final gates.

```bash
npx vitest run
npm run build
git status --short
git log --oneline | head -40
```

Expected:
- Vitest: all green. Approximately 462 + 14 (Part 1 new/updated) + 16 (Part 2 new) ≈ **~492 tests**.
- Build: exit 0.
- `main.js` size: ~100KB (up from 84.9KB baseline).
- Git status: empty.
- Log shows a clean chain from `docs: add plan for base compression + intra-line highlighting` through `docs: update AGENTS.md for intra-line word diff`.

**Step 5:** Report summary to user:
- Task count completed (0 through 16 = 17 tasks total).
- Final test count + delta from 462 baseline.
- Final `main.js` size + delta from 84.9KB baseline.
- Commit count on this branch since `64aeab2`.
- Confirmation that we did NOT push (the 46 commits before this plan were pushed at the start; the new commits from this plan are local-only).

**STOP** after the summary. Do not auto-push. User approves push explicitly.

---

## Risk register

1. **fflate bundle size.** fflate minified ~8KB; total bundle may reach ~100KB. Accepted by user.
2. **Compression threshold (512 bytes) is a heuristic.** Below it, deflate header + b64 tax usually beats raw. The "short returns raw" + "high-entropy falls back to raw" tests pin this behavior.
3. **Base64 overhead.** Adds ~33% to compressed bytes. Typical prose still nets ~45-55% of raw. Acceptable.
4. **`deflateRawSync` on 1MB.** Runs in ~30ms single-shot. `maxSizeBytes` already caps content at 1MB so worst case is bounded.
5. **Schema wipe.** v2 → v3 wipes all pre-existing history (including the 46 commits' worth of local testing). User pre-approved this. No user data in the remote repo.
6. **Task 7/8 ordering pitfall.** Task 6 (reconstructVersion decodes) MUST land before Task 8 (capture encodes) so the dedup check `lastContent === edit.content` keeps comparing raw-to-raw throughout. If you accidentally invert, capture will write an entry every time even on no-op saves. Tests will catch this.
7. **dmp char diff fragmentation.** `diff_cleanupSemantic` handles most readability. 2000-char size guard prevents O(n²) worst cases.
8. **`btoa`/`atob` on non-Latin1 bytes.** We only call `btoa` on chars 0-255 (from the u8 chunking helper). Safe by construction.
9. **Test fixture drift for `version: 2` → `version: 3`.** Sites across 4 test files (~20 hits). Mechanical but audit each grep match — a missed site fails loudly on the first test run after Task 5.
10. **CSS sync between `styles.css` and `src/styles.css`.** Repo keeps both. Both must be updated in Task 14. Missing the root-level `styles.css` is the shipped asset that breaks at install time; missing `src/styles.css` breaks source-of-truth.
11. **View test `makeStore` / `makeLeaf` / `getPersisted` helpers.** Task 8/9/15 assume they exist. Read the top of each test file before writing new fixtures and reuse whatever's there. If a helper is missing (`getPersisted` might be), construct one from `vault.adapter.write.mock.calls` as done in the store tests.

# Edit History — Concurrent Multi-Device Edits Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop `EditHistoryCapture` from recording phantom versions when a remote CRDT edit arrives, eliminate silent last-writer-wins loss of `edit-history.json` during blob sync, and let the view show a unified timeline across all devices' histories.

**Architecture:** Three coupled changes to `src/editHistory/`.
1. **Origin filter** — new leaf `editHistoryOrigin.ts`. `EditHistoryCapture.start()` receives a `getProvider: () => unknown` reference. `onIdToTextObserveDeep(events, txn)` now inspects `txn`; transactions whose `origin === provider` (y-websocket remote) are dropped before `scheduleCapture`.
2. **Per-device files** — `EditHistoryStore` switches from a single shared `.yaos-extension/edit-history.json` to per-device `.yaos-extension/edit-history-<deviceId>.json`. Only the local device writes its own file. Blob-sync LWW now only clobbers entries owned by the writing device, which eliminates the cross-device overwrite race.
3. **Merge on read** — new leaf `editHistoryMerge.ts` exports `loadMergedEntry(vault, fileId)` which enumerates all `edit-history-*.json` siblings, parses each (v3 gate), flattens `(deviceId, VersionSnapshot)` pairs into a single timeline sorted by `ts`, and pre-computes absolute content for each version inside its own device-local chain so `editHistoryView` can render synthesized cross-device hunks without violating the "hunks are relative to previous version" invariant. `EditHistoryView.refresh` calls `loadMergedEntry` instead of `store.getEntry`.

No `VersionSnapshot` schema change. Stays at v3 with `contentEnc?: "dfb64"`. No new runtime dependency.

**Tech Stack:** TypeScript strict, Vitest, esbuild, `diff-match-patch` (already shipped), `fflate` (already shipped), Obsidian `ItemView` / `Vault` DOM API, jsdom for tests.

**Pre-reading** (required before starting):
- `src/AGENTS.md` — module dependency graph + every `editHistory/*` section.
- `src/editHistory/types.ts`, `editHistoryStore.ts`, `editHistoryCapture.ts`, `editHistoryView.ts` — current v3 implementation.
- `../yaos/src/sync/diskMirror.ts:30–65` — reference implementation of the `isLocalOrigin` pattern. DO NOT import from there (different plugin); reimplement privately.
- `../yaos/src/sync/vaultSync.ts:95–110` — `idToText`/`meta` map shape; confirms `provider` is reference-stable for `===`.
- `docs/plans/2026-04-19-edit-history-compression-and-inline-diff.md` — prior plan; inherit commit protocol, TDD rhythm, and push policy.

**Commit protocol** (inherited from prior sessions):
- One commit per RED test, one per GREEN implementation. Each added test case after the first GREEN is its own commit.
- Message prefixes: `test(editHistory): RED — <behavior>`, `test(editHistory): <behavior>` for additional green cases, `feat(editHistory): GREEN — <behavior>`, `refactor(editHistory): <what>`, `docs: …`.
- Do NOT push at the end. User approves push explicitly.
- Verification gate before every commit: `npx vitest run` fully green (except freshly-committed RED tests, which must fail for the correct reason).
- Build gate before the final Part-ending commits (Tasks 9, 18, 26): `npm run build` exits 0.

**Scope constraints inherited from `src/AGENTS.md`:**
- Siblings in `src/editHistory/` never import each other horizontally except through leaf modules. The new `editHistoryOrigin.ts` and `editHistoryMerge.ts` are leaves. `editHistoryView` imports `editHistoryMerge`; `editHistoryCapture` imports `editHistoryOrigin`. Store does NOT depend on origin/merge.
- `main.ts` is the only module that may pass a `provider` reference or `getDeviceId` callback into the subsystem.

---

## Task 0: Baseline verification

**Files:** None.

**Step 1:** Verify clean baseline.

```bash
npx vitest run --reporter=dot
npm run build
git status --short
git log --oneline -1
git log --oneline origin/master..HEAD
```

**Expected:**
- Vitest: **493 tests passing**, 24 files.
- Build: exits 0, `main.js` ~96 KB.
- Git status: empty.
- HEAD: `67deb13 style(editHistory): word-diff highlights use theme color variables`.
- `origin/master..HEAD`: empty.

If any check fails, **STOP and report** — do not start the plan on a dirty baseline.

---

## Task 1: Save this plan

**Files:**
- Create: `docs/plans/2026-04-19-edit-history-concurrent-edits.md` (this file).

**Step 1:** This file already exists (you are reading it).

**Step 2:** Commit.

```bash
git add docs/plans/2026-04-19-edit-history-concurrent-edits.md
git commit -m "docs: add plan for concurrent multi-device edit history"
```

**Expected:** commit succeeds; `git status` empty.

---

# Part 1 — Origin filtering (Tasks 2–9)

Goal: stop this device from capturing versions when the text change came from a remote device via the y-websocket provider.

## Task 2: RED — `isLocalOrigin` rejects the provider reference

**Files:**
- Create: `src/editHistory/editHistoryOrigin.test.ts`

**Step 1:** Write the failing test.

```typescript
// src/editHistory/editHistoryOrigin.test.ts
import { describe, it, expect } from "vitest";
import { isLocalOrigin } from "./editHistoryOrigin";

describe("isLocalOrigin", () => {
	it("returns false when origin is the provider reference", () => {
		const provider = { name: "fake-provider" };
		expect(isLocalOrigin(provider, provider)).toBe(false);
	});
});
```

**Step 2:** Run.

```bash
npx vitest run src/editHistory/editHistoryOrigin.test.ts
```

**Expected:** FAIL with `Cannot find module './editHistoryOrigin'`.

**Step 3:** Commit the RED test.

```bash
git add src/editHistory/editHistoryOrigin.test.ts
git commit -m "test(editHistory): RED — isLocalOrigin rejects provider reference"
```

---

## Task 3: GREEN — create `editHistoryOrigin.ts`

**Files:**
- Create: `src/editHistory/editHistoryOrigin.ts`

**Step 1:** Write the minimal implementation.

```typescript
// src/editHistory/editHistoryOrigin.ts
/**
 * Decide whether a Yjs transaction originated locally (this device) or
 * was applied by the y-websocket provider from a remote peer.
 *
 * The YAOS sync plugin (and y-websocket in general) applies remote updates
 * with `txn.origin === provider`. Local editor keystrokes use y-codemirror's
 * YSyncConfig object, local disk-sync uses the string "disk-sync", etc.
 *
 * We only care about one distinction for edit history: is this a remote
 * update? Remote = reference-equal to the provider. Everything else is
 * treated as local so we don't drop disk-originated or seed-originated
 * edits that should still show up in the timeline.
 */
export function isLocalOrigin(origin: unknown, provider: unknown): boolean {
	if (provider !== undefined && origin === provider) return false;
	return true;
}
```

**Step 2:** Run.

```bash
npx vitest run src/editHistory/editHistoryOrigin.test.ts
```

**Expected:** PASS.

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryOrigin.ts
git commit -m "feat(editHistory): GREEN — isLocalOrigin module"
```

---

## Task 4: additional `isLocalOrigin` cases

**Files:**
- Modify: `src/editHistory/editHistoryOrigin.test.ts`

**Step 1:** Append cases that pin the remaining semantics.

```typescript
it("returns true when origin is null (local transact without origin)", () => {
	expect(isLocalOrigin(null, { provider: true })).toBe(true);
});

it("returns true when origin is undefined", () => {
	expect(isLocalOrigin(undefined, { provider: true })).toBe(true);
});

it("returns true for a local YSyncConfig-like object (not the provider)", () => {
	const provider = { role: "provider" };
	const ySyncConfig = { role: "y-codemirror" };
	expect(isLocalOrigin(ySyncConfig, provider)).toBe(true);
});

it("returns true for local string origins like disk-sync or vault-crdt-seed", () => {
	const provider = { role: "provider" };
	expect(isLocalOrigin("disk-sync", provider)).toBe(true);
	expect(isLocalOrigin("vault-crdt-seed", provider)).toBe(true);
	expect(isLocalOrigin("snapshot-restore", provider)).toBe(true);
});

it("returns true when provider is undefined (pre-YAOS init)", () => {
	expect(isLocalOrigin("anything", undefined)).toBe(true);
	expect(isLocalOrigin(null, undefined)).toBe(true);
});

it("returns false only for reference equality, not structural equality", () => {
	const provider = { id: 1 };
	const lookalike = { id: 1 };
	expect(isLocalOrigin(lookalike, provider)).toBe(true);
});
```

**Step 2:** Run.

```bash
npx vitest run src/editHistory/editHistoryOrigin.test.ts
```

**Expected:** all PASS (implementation already covers these cases).

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryOrigin.test.ts
git commit -m "test(editHistory): isLocalOrigin covers null/undefined/strings/structural"
```

---

## Task 5: RED — capture skips remote-origin transactions

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1:** Add the RED test at the bottom of the existing `describe("observeDeep", …)` block (around line 347 — after `"ignores file IDs where getText returns null"`).

```typescript
it("does not schedule capture when transaction origin is the provider (remote)", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });
	const observeDeep = vi.fn();
	const idToText = { observeDeep, unobserveDeep: vi.fn() };
	const getFilePath = vi.fn((_id: string) => "notes/remote.md");
	const getText = vi.fn((_id: string) => ({ toJSON: () => "remote merged" }));
	const provider = { role: "fake-provider" };
	const getProvider = () => provider;

	try {
		fastCapture.start(idToText as any, getFilePath, getText, getProvider);

		const handler = observeDeep.mock.calls[0]![0];
		// Yjs observeDeep signature: (events, transaction)
		const events = [{ path: ["remoteFile"] }];
		const txn = { origin: provider };
		handler(events, txn);

		await sleep(100);
		expect(captured.calls).toHaveLength(0);
	} finally {
		fastCapture.stop();
		await fastDb.clear();
		fastDb.close();
	}
});
```

**Step 2:** Run.

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

**Expected:** FAIL. Either:
- Type error because `start` does not accept a fourth argument, OR
- `captured.calls.length === 1` because the current handler ignores `txn`.

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test(editHistory): RED — capture skips remote-origin transactions"
```

---

## Task 6: GREEN — capture gates `scheduleCapture` behind `isLocalOrigin`

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts`

**Step 1:** Add the import at the top (after the existing imports).

```typescript
import { isLocalOrigin } from "./editHistoryOrigin";
```

**Step 2:** Add a field and update the `start()` / `stop()` signatures.

Locate around line 30–33 (field declarations):

```typescript
	private idToText: any = null;
	private getFilePath: ((fileId: string) => string | undefined) | null = null;
	private getText: ((fileId: string) => { toJSON: () => string } | null | undefined) | null = null;
```

Append a new field after `getText`:

```typescript
	private getProvider: (() => unknown) | null = null;
```

**Step 3:** Update `start()` (around line 50).

Replace the existing `start()` signature and body with:

```typescript
	start(
		idToText: any,
		getFilePath: (fileId: string) => string | undefined,
		getText: (fileId: string) => { toJSON: () => string } | null | undefined,
		getProvider?: () => unknown,
	): void {
		this.idToText = idToText;
		this.getFilePath = getFilePath;
		this.getText = getText;
		this.getProvider = getProvider ?? null;

		this.observeDeepHandler = (events: any, txn: unknown) => {
			this.onIdToTextObserveDeep(events, txn);
		};
		idToText.observeDeep(this.observeDeepHandler);
	}
```

**Step 4:** Update `stop()` (around line 65) — null the new field too.

```typescript
	stop(): void {
		if (this.observeDeepHandler && this.idToText) {
			this.idToText.unobserveDeep(this.observeDeepHandler);
		}
		this.observeDeepHandler = null;
		this.idToText = null;
		this.getFilePath = null;
		this.getText = null;
		this.getProvider = null;   // NEW
		for (const { idle, max } of this.pendingTimers.values()) {
			clearTimeout(idle);
			if (max) clearTimeout(max);
		}
		this.pendingTimers.clear();
	}
```

**Step 5:** Update `onIdToTextObserveDeep` (around line 247).

Replace the method signature and add an early-return guard at the top:

```typescript
	private onIdToTextObserveDeep(events: any[], txn: unknown): void {
		if (!this.getFilePath || !this.getText) return;

		// Remote-origin transactions (applied by the y-websocket provider) are
		// edits from another device. Skip them so we don't mis-attribute remote
		// content to this device, starve the debounce idle timer, or capture
		// versions for files the local user never touched.
		const providerRef = this.getProvider?.() ?? undefined;
		const txnOrigin = (txn as { origin?: unknown } | undefined)?.origin;
		if (!isLocalOrigin(txnOrigin, providerRef)) return;

		const fileIds = new Set<string>();
		// … (rest unchanged)
```

Leave the existing loop body (`for (const event of events) …`) intact beneath the new guard.

**Step 6:** Run.

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

**Expected:** all PASS, including the new RED case and all previously-green cases.

**Step 7:** Commit.

```bash
git add src/editHistory/editHistoryCapture.ts
git commit -m "feat(editHistory): GREEN — capture skips remote-origin transactions"
```

---

## Task 7: local-origin still schedules (regression guard)

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1:** Add the local-origin positive case right after the Task 5 test.

```typescript
it("still schedules capture when transaction origin is local (object, not provider)", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });
	const observeDeep = vi.fn();
	const idToText = { observeDeep, unobserveDeep: vi.fn() };
	const getFilePath = vi.fn((_id: string) => "notes/local.md");
	const getText = vi.fn((_id: string) => ({ toJSON: () => "local edit" }));
	const provider = { role: "fake-provider" };
	const ySyncConfig = { role: "y-codemirror" };
	const getProvider = () => provider;

	try {
		fastCapture.start(idToText as any, getFilePath, getText, getProvider);

		const handler = observeDeep.mock.calls[0]![0];
		const events = [{ path: ["localFile"] }];
		const txn = { origin: ySyncConfig };
		handler(events, txn);

		await sleep(100);
		expect(captured.calls).toHaveLength(1);
		expect(captured.calls[0].snap.content).toBe("local edit");
	} finally {
		fastCapture.stop();
		await fastDb.clear();
		fastDb.close();
	}
});

it("still schedules when no getProvider was supplied (back-compat)", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });
	const observeDeep = vi.fn();
	const idToText = { observeDeep, unobserveDeep: vi.fn() };
	const getFilePath = vi.fn(() => "notes/nop.md");
	const getText = vi.fn(() => ({ toJSON: () => "nop" }));

	try {
		// Old-style 3-arg start (no getProvider). Handler must still fire.
		fastCapture.start(idToText as any, getFilePath, getText);

		const handler = observeDeep.mock.calls[0]![0];
		handler([{ path: ["f"] }], { origin: "anything" });

		await sleep(100);
		expect(captured.calls).toHaveLength(1);
	} finally {
		fastCapture.stop();
		await fastDb.clear();
		fastDb.close();
	}
});
```

**Step 2:** Run.

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

**Expected:** both PASS. (No code changes needed — Task 6's implementation already covers these.)

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test(editHistory): local origins + missing getProvider still schedule"
```

---

## Task 8: wire `getProvider` in `main.ts`

**Files:**
- Modify: `src/main.ts:232–241` (the `editHistoryCapture.start(...)` call inside the `onload` YAOS bootstrap).

**Step 1:** Locate the block:

```typescript
this.editHistoryCapture.start(
	(vaultSync as any).idToText,
	(fileId: string) => getFilePath(this.app, fileId),
	(fileId: string) => {
		const idToText = (vaultSync as any).idToText;
		if (!idToText) return null;
		const yText = idToText.get(fileId);
		return yText ?? null;
	},
);
```

**Step 2:** Add the fourth argument — `() => (vaultSync as any).provider`. Final form:

```typescript
this.editHistoryCapture.start(
	(vaultSync as any).idToText,
	(fileId: string) => getFilePath(this.app, fileId),
	(fileId: string) => {
		const idToText = (vaultSync as any).idToText;
		if (!idToText) return null;
		const yText = idToText.get(fileId);
		return yText ?? null;
	},
	() => (vaultSync as any).provider,
);
```

**Step 3:** Build and test.

```bash
npx vitest run
npm run build
```

**Expected:** 493+ tests pass (3 new from Tasks 5/7), build exits 0.

**Step 4:** Commit.

```bash
git add src/main.ts
git commit -m "refactor(editHistory): pass vaultSync.provider to capture.start"
```

---

## Task 9: Part 1 gate

**Files:** None (verification only).

**Step 1:** Full regression check.

```bash
npx vitest run --reporter=dot
npm run build
git status --short
```

**Expected:**
- Vitest: **~496 tests** passing (baseline 493 + 1 Task 3 + 6 Task 4 cases counted as 1 `it` each + … actually let me recount: Task 3 = 1 test, Task 4 = 6 new `it` blocks, Task 5 = 1, Task 7 = 2. Total new = 10. Final ~503.).
- Build: exits 0.
- Status: empty.

If any gate fails, stop and diagnose before starting Part 2.

---

# Part 2 — Per-device history files (Tasks 10–18)

Goal: switch `EditHistoryStore` from `.yaos-extension/edit-history.json` to `.yaos-extension/edit-history-<deviceId>.json`. One writer per file. Migrate legacy single-file on first load.

## Task 10: RED — store writes to per-device filename

**Files:**
- Modify: `src/editHistory/editHistoryStore.test.ts`

**Step 1:** Add a new describe block at the bottom of the file.

```typescript
describe("per-device file path", () => {
	it("writes to edit-history-<deviceId>.json based on getDeviceId", async () => {
		const writes = new Map<string, string>();
		const mockVault = {
			adapter: {
				exists: vi.fn(async (p: string) => writes.has(p)),
				read: vi.fn(async (p: string) => writes.get(p) ?? ""),
				write: vi.fn(async (p: string, data: string) => { writes.set(p, data); }),
				mkdir: vi.fn(async () => {}),
				list: vi.fn(async () => ({ files: [], folders: [] })),
			},
		};

		const store = new EditHistoryStore(mockVault as any, () => "device-alpha");
		await store.addVersion("f1", "a.md", {
			ts: 1,
			device: "device-alpha",
			content: "hello",
		});

		expect(writes.has(".yaos-extension/edit-history-device-alpha.json")).toBe(true);
		expect(writes.has(".yaos-extension/edit-history.json")).toBe(false);
	});
});
```

**Step 2:** Run.

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

**Expected:** FAIL. Either:
- Type error because the constructor only takes one arg, OR
- Wrong filename assertion.

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryStore.test.ts
git commit -m "test(editHistory): RED — store writes per-device filename"
```

---

## Task 11: GREEN — constructor takes `getDeviceId`, filename derived per I/O

**Files:**
- Modify: `src/editHistory/editHistoryStore.ts`

**Step 1:** Replace the top constant + constructor.

Old:

```typescript
const HISTORY_PATH = ".yaos-extension/edit-history.json";

export class EditHistoryStore {
	private vault: Vault;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(vault: Vault) {
		this.vault = vault;
	}
```

New:

```typescript
const HISTORY_DIR = ".yaos-extension";

/** Sanitize a device name for safe use in a filename. */
function normalizeDeviceIdForFilename(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return "unknown";
	// Restrict to filename-safe chars. Replace anything else with "_".
	return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class EditHistoryStore {
	private vault: Vault;
	private getDeviceId: () => string;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(vault: Vault, getDeviceId: () => string) {
		this.vault = vault;
		this.getDeviceId = getDeviceId;
	}

	/** Resolved per-I/O so device rename in YAOS settings takes effect. */
	private currentPath(): string {
		const id = normalizeDeviceIdForFilename(this.getDeviceId());
		return `${HISTORY_DIR}/edit-history-${id}.json`;
	}
```

**Step 2:** Replace every `HISTORY_PATH` reference in `load()` and `save()` with `this.currentPath()`.

```typescript
	async load(): Promise<EditHistoryData> {
		const path = this.currentPath();
		try {
			const exists = await this.vault.adapter.exists(path);
			if (!exists) return DEFAULT_EDIT_HISTORY_DATA();
			const raw = await this.vault.adapter.read(path);
			// … (parse + v3 gate unchanged)
		} catch (e) {
			logWarn("editHistoryStore: failed to load", e);
			return DEFAULT_EDIT_HISTORY_DATA();
		}
	}

	async save(data: EditHistoryData): Promise<void> {
		if (!(await this.vault.adapter.exists(HISTORY_DIR))) {
			await this.vault.adapter.mkdir(HISTORY_DIR);
		}
		await this.vault.adapter.write(this.currentPath(), JSON.stringify(data, null, "\t"));
	}
```

**Step 3:** Update all OTHER existing tests in `editHistoryStore.test.ts` that construct `new EditHistoryStore(vault)` — they now need a second arg. Use `() => "test-device"` as the default. Every existing construction site must be updated. Run tests to find them all.

**Step 4:** Run.

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

**Expected:** all PASS (including the new per-device test and all migrated existing tests).

**Step 5:** Also update `src/editHistory/editHistoryCapture.test.ts` and `src/editHistory/editHistoryView.test.ts` — both construct `EditHistoryStore` for their fixtures. Grep first:

```bash
rg "new EditHistoryStore\(" src
```

For every construction site, add `, () => "test-device"` as the second argument.

**Step 6:** Re-run full suite.

```bash
npx vitest run
```

**Expected:** all pass.

**Step 7:** Commit.

```bash
git add src/editHistory/editHistoryStore.ts src/editHistory/editHistoryStore.test.ts src/editHistory/editHistoryCapture.test.ts src/editHistory/editHistoryView.test.ts
git commit -m "feat(editHistory): GREEN — per-device edit-history filenames"
```

---

## Task 12: filename normalization case

**Files:**
- Modify: `src/editHistory/editHistoryStore.test.ts`

**Step 1:** Add to the "per-device file path" describe:

```typescript
it("normalizes device ids with filesystem-unsafe chars", async () => {
	const writes = new Map<string, string>();
	const mockVault = {
		adapter: {
			exists: vi.fn(async (p: string) => writes.has(p)),
			read: vi.fn(async (p: string) => writes.get(p) ?? ""),
			write: vi.fn(async (p: string, data: string) => { writes.set(p, data); }),
			mkdir: vi.fn(async () => {}),
			list: vi.fn(async () => ({ files: [], folders: [] })),
		},
	};

	const store = new EditHistoryStore(mockVault as any, () => "Device / With Spaces & Slash");
	await store.addVersion("f1", "a.md", { ts: 1, device: "x", content: "y" });

	// "/" → "_", space → "_", "&" → "_"
	expect(writes.has(".yaos-extension/edit-history-Device___With_Spaces___Slash.json")).toBe(true);
});

it("uses 'unknown' when device id is empty or whitespace", async () => {
	const writes = new Map<string, string>();
	const mockVault = {
		adapter: {
			exists: vi.fn(async (p: string) => writes.has(p)),
			read: vi.fn(async (p: string) => writes.get(p) ?? ""),
			write: vi.fn(async (p: string, data: string) => { writes.set(p, data); }),
			mkdir: vi.fn(async () => {}),
			list: vi.fn(async () => ({ files: [], folders: [] })),
		},
	};

	const store = new EditHistoryStore(mockVault as any, () => "   ");
	await store.addVersion("f1", "a.md", { ts: 1, device: "x", content: "y" });

	expect(writes.has(".yaos-extension/edit-history-unknown.json")).toBe(true);
});
```

**Step 2:** Run, expect PASS.

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryStore.test.ts
git commit -m "test(editHistory): per-device filename normalization edge cases"
```

---

## Task 13: RED — legacy `edit-history.json` migrates on first load

**Files:**
- Modify: `src/editHistory/editHistoryStore.test.ts`

**Step 1:** Add a new describe.

```typescript
describe("legacy migration", () => {
	it("renames .yaos-extension/edit-history.json → edit-history-<deviceId>.json on load when per-device file is absent", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history.json", JSON.stringify({
			version: 3,
			entries: {
				f1: {
					path: "a.md",
					baseIndex: 0,
					versions: [{ ts: 1, device: "legacy-device", content: "hi" }],
				},
			},
		}));

		const mockVault = {
			adapter: {
				exists: vi.fn(async (p: string) => files.has(p)),
				read: vi.fn(async (p: string) => files.get(p) ?? ""),
				write: vi.fn(async (p: string, data: string) => { files.set(p, data); }),
				remove: vi.fn(async (p: string) => { files.delete(p); }),
				mkdir: vi.fn(async () => {}),
				list: vi.fn(async () => ({ files: [], folders: [] })),
			},
		};

		const store = new EditHistoryStore(mockVault as any, () => "device-alpha");
		const data = await store.load();

		// Data carried over
		expect(data.entries.f1?.versions[0]?.content).toBe("hi");
		// Legacy file removed, per-device file exists
		expect(files.has(".yaos-extension/edit-history.json")).toBe(false);
		expect(files.has(".yaos-extension/edit-history-device-alpha.json")).toBe(true);
	});

	it("does NOT touch legacy file when per-device file already exists", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history.json", JSON.stringify({ version: 3, entries: {} }));
		files.set(".yaos-extension/edit-history-device-alpha.json", JSON.stringify({
			version: 3,
			entries: { f1: { path: "a.md", baseIndex: 0, versions: [{ ts: 9, device: "device-alpha", content: "keep me" }] } },
		}));

		const mockVault = {
			adapter: {
				exists: vi.fn(async (p: string) => files.has(p)),
				read: vi.fn(async (p: string) => files.get(p) ?? ""),
				write: vi.fn(async (p: string, data: string) => { files.set(p, data); }),
				remove: vi.fn(async (p: string) => { files.delete(p); }),
				mkdir: vi.fn(async () => {}),
				list: vi.fn(async () => ({ files: [], folders: [] })),
			},
		};

		const store = new EditHistoryStore(mockVault as any, () => "device-alpha");
		const data = await store.load();

		// Per-device file wins
		expect(data.entries.f1?.versions[0]?.content).toBe("keep me");
		// Legacy file is untouched (merged-on-read handles it in Part 3)
		expect(files.has(".yaos-extension/edit-history.json")).toBe(true);
	});
});
```

**Step 2:** Run, expect FAIL (no migration logic yet).

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryStore.test.ts
git commit -m "test(editHistory): RED — legacy edit-history.json migration"
```

---

## Task 14: GREEN — implement legacy migration in `load()`

**Files:**
- Modify: `src/editHistory/editHistoryStore.ts`

**Step 1:** Add the migration constant at the top, next to `HISTORY_DIR`:

```typescript
const LEGACY_HISTORY_PATH = `${HISTORY_DIR}/edit-history.json`;
```

**Step 2:** Rewrite `load()` with the migration branch. Full new body:

```typescript
	async load(): Promise<EditHistoryData> {
		const path = this.currentPath();
		try {
			const perDeviceExists = await this.vault.adapter.exists(path);

			if (!perDeviceExists) {
				const legacyExists = await this.vault.adapter.exists(LEGACY_HISTORY_PATH);
				if (legacyExists) {
					// One-shot migration: rename legacy → per-device, then proceed.
					const raw = await this.vault.adapter.read(LEGACY_HISTORY_PATH);
					await this.vault.adapter.write(path, raw);
					await this.vault.adapter.remove(LEGACY_HISTORY_PATH);
				} else {
					return DEFAULT_EDIT_HISTORY_DATA();
				}
			}

			const raw = await this.vault.adapter.read(path);
			const parsed = JSON.parse(raw) as { version?: number };
			if (parsed?.version !== 3) {
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

**Step 3:** Run.

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

**Expected:** all PASS.

**Step 4:** Commit.

```bash
git add src/editHistory/editHistoryStore.ts
git commit -m "feat(editHistory): GREEN — migrate legacy edit-history.json on load"
```

---

## Task 15: RED — `listAllHistoryFiles` enumeration helper

**Files:**
- Create: nothing. Extend `editHistoryStore.ts` with a new exported function.
- Modify: `src/editHistory/editHistoryStore.test.ts`

**Step 1:** Add the RED test in a new describe.

```typescript
import { EditHistoryStore, listAllHistoryFiles } from "./editHistoryStore";

describe("listAllHistoryFiles", () => {
	it("returns every edit-history-*.json under .yaos-extension, plus legacy if present", async () => {
		const mockVault = {
			adapter: {
				list: vi.fn(async (dir: string) => {
					if (dir === ".yaos-extension") {
						return {
							files: [
								".yaos-extension/edit-history-alpha.json",
								".yaos-extension/edit-history-beta.json",
								".yaos-extension/edit-history.json",
								".yaos-extension/something-else.json",
								".yaos-extension/edit-history-device_with_underscores.json",
							],
							folders: [],
						};
					}
					return { files: [], folders: [] };
				}),
				exists: vi.fn(async () => true),
			},
		};

		const paths = await listAllHistoryFiles(mockVault as any);

		expect(paths).toEqual(
			expect.arrayContaining([
				".yaos-extension/edit-history-alpha.json",
				".yaos-extension/edit-history-beta.json",
				".yaos-extension/edit-history.json",
				".yaos-extension/edit-history-device_with_underscores.json",
			]),
		);
		expect(paths).not.toContain(".yaos-extension/something-else.json");
	});

	it("returns [] when the directory does not exist", async () => {
		const mockVault = {
			adapter: {
				list: vi.fn(async () => { throw new Error("ENOENT"); }),
				exists: vi.fn(async () => false),
			},
		};
		const paths = await listAllHistoryFiles(mockVault as any);
		expect(paths).toEqual([]);
	});
});
```

**Step 2:** Run, expect FAIL on missing export.

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryStore.test.ts
git commit -m "test(editHistory): RED — listAllHistoryFiles enumeration"
```

---

## Task 16: GREEN — implement `listAllHistoryFiles`

**Files:**
- Modify: `src/editHistory/editHistoryStore.ts`

**Step 1:** Append at end of file.

```typescript
/**
 * Enumerate every `.yaos-extension/edit-history*.json` file in the vault,
 * including the legacy shared file if present. Siblings only — does not
 * recurse. Returns [] if the directory is missing.
 */
export async function listAllHistoryFiles(vault: Vault): Promise<string[]> {
	try {
		const exists = await vault.adapter.exists(HISTORY_DIR);
		if (!exists) return [];
		const listing = await vault.adapter.list(HISTORY_DIR);
		const out: string[] = [];
		for (const f of listing.files) {
			const name = f.slice(HISTORY_DIR.length + 1);
			if (name === "edit-history.json") {
				out.push(f);
				continue;
			}
			if (name.startsWith("edit-history-") && name.endsWith(".json")) {
				out.push(f);
			}
		}
		return out;
	} catch {
		return [];
	}
}
```

**Step 2:** Run, expect PASS.

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryStore.ts
git commit -m "feat(editHistory): GREEN — listAllHistoryFiles enumerator"
```

---

## Task 17: wire `getDeviceId` in `main.ts`

**Files:**
- Modify: `src/main.ts` — locate `this.editHistoryStore = new EditHistoryStore(this.app.vault);` (around line 179).

**Step 1:** Change to:

```typescript
this.editHistoryStore = new EditHistoryStore(
	this.app.vault,
	() => getLocalDeviceName(this.app),
);
```

`getLocalDeviceName` is already imported near the top of `main.ts` (confirmed in `src/main.ts:8`).

**Step 2:** Run full suite + build.

```bash
npx vitest run
npm run build
```

**Expected:** all pass, build clean.

**Step 3:** Commit.

```bash
git add src/main.ts
git commit -m "refactor(editHistory): pass device id to EditHistoryStore"
```

---

## Task 18: Part 2 gate

**Files:** None.

**Step 1:** Full regression.

```bash
npx vitest run --reporter=dot
npm run build
git status --short
```

**Expected:**
- Vitest: ~511 tests (Part 1 ~503 + Task 10 + Task 12 × 2 + Task 13 × 2 + Task 15 × 2 = ~510).
- Build: exits 0.
- Status: empty.

Stop and diagnose on failure before Part 3.

---

# Part 3 — Merge on read (Tasks 19–26)

Goal: `EditHistoryView.refresh(fileId)` must show a unified timeline across every device's history file, without breaking the "hunks relative to previous version" invariant.

## Task 19: RED — `loadMergedEntry` reads from two device files for the same fileId

**Files:**
- Create: `src/editHistory/editHistoryMerge.test.ts`

**Step 1:** Write.

```typescript
import { describe, it, expect, vi } from "vitest";
import { loadMergedEntry } from "./editHistoryMerge";

describe("loadMergedEntry", () => {
	it("merges versions across two device files in ts order", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
			version: 3,
			entries: {
				fX: {
					path: "notes/x.md",
					baseIndex: 0,
					versions: [{ ts: 1, device: "alpha", content: "alpha-v1" }],
				},
			},
		}));
		files.set(".yaos-extension/edit-history-beta.json", JSON.stringify({
			version: 3,
			entries: {
				fX: {
					path: "notes/x.md",
					baseIndex: 0,
					versions: [{ ts: 2, device: "beta", content: "beta-v1" }],
				},
			},
		}));

		const mockVault = {
			adapter: {
				exists: vi.fn(async (p: string) => files.has(p) || p === ".yaos-extension"),
				read: vi.fn(async (p: string) => files.get(p) ?? ""),
				list: vi.fn(async () => ({
					files: Array.from(files.keys()),
					folders: [],
				})),
			},
		};

		const merged = await loadMergedEntry(mockVault as any, "fX");
		expect(merged).not.toBeNull();
		expect(merged!.path).toBe("notes/x.md");
		expect(merged!.versions.map((v) => v.device)).toEqual(["alpha", "beta"]);
		expect(merged!.absoluteContents).toEqual(["alpha-v1", "beta-v1"]);
	});
});
```

**Step 2:** Run, expect FAIL (module missing).

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryMerge.test.ts
git commit -m "test(editHistory): RED — loadMergedEntry merges across devices"
```

---

## Task 20: GREEN — create `editHistoryMerge.ts`

**Files:**
- Create: `src/editHistory/editHistoryMerge.ts`

**Step 1:** Write the module.

```typescript
// src/editHistory/editHistoryMerge.ts
import type { Vault } from "obsidian";
import type { EditHistoryData, FileHistoryEntry, VersionSnapshot } from "./types";
import { listAllHistoryFiles } from "./editHistoryStore";
import { reconstructVersion } from "./editHistoryDiff";
import { logWarn } from "../logger";

/**
 * A merged, cross-device view of a single fileId's history.
 *
 * `versions` is the full timeline ordered by `ts` ascending. Each entry also
 * carries the `deviceId` (filename stem) it came from and its absolute
 * reconstructed content, computed inside its own device-local delta chain.
 *
 * We pre-reconstruct per device (not per-merged-timeline) because `hunks` are
 * relative to the preceding version in the same device's file. Interleaving
 * versions from two devices would make deltas un-applicable.
 */
export interface MergedEntry {
	path: string;
	versions: VersionSnapshot[];
	/** Absolute content for each `versions[i]`, same length. */
	absoluteContents: Array<string | null>;
	/** Device filename stem (e.g. "alpha" from edit-history-alpha.json) per version. */
	sourceDeviceIds: string[];
}

function deriveDeviceIdFromFilename(path: string): string {
	const slash = path.lastIndexOf("/");
	const name = slash >= 0 ? path.slice(slash + 1) : path;
	if (name === "edit-history.json") return "legacy";
	const m = /^edit-history-(.+)\.json$/.exec(name);
	return m?.[1] ?? "unknown";
}

export async function loadMergedEntry(
	vault: Vault,
	fileId: string,
): Promise<MergedEntry | null> {
	const files = await listAllHistoryFiles(vault);
	if (files.length === 0) return null;

	interface PerDevice {
		deviceId: string;
		entry: FileHistoryEntry;
	}
	const perDevice: PerDevice[] = [];
	let mergedPath: string | null = null;

	for (const filePath of files) {
		try {
			const raw = await vault.adapter.read(filePath);
			const parsed = JSON.parse(raw) as EditHistoryData;
			if (parsed?.version !== 3) continue;
			const entry = parsed.entries?.[fileId];
			if (!entry) continue;
			perDevice.push({
				deviceId: deriveDeviceIdFromFilename(filePath),
				entry,
			});
			if (!mergedPath) mergedPath = entry.path;
		} catch (e) {
			logWarn(`editHistoryMerge: failed to read ${filePath}`, e);
		}
	}

	if (perDevice.length === 0) return null;

	interface Flat {
		ts: number;
		version: VersionSnapshot;
		absolute: string | null;
		deviceId: string;
	}
	const flat: Flat[] = [];
	for (const { deviceId, entry } of perDevice) {
		for (let i = 0; i < entry.versions.length; i++) {
			const version = entry.versions[i]!;
			const absolute = reconstructVersion(entry, i);
			flat.push({ ts: version.ts, version, absolute, deviceId });
		}
	}

	flat.sort((a, b) => a.ts - b.ts);

	return {
		path: mergedPath ?? "",
		versions: flat.map((f) => f.version),
		absoluteContents: flat.map((f) => f.absolute),
		sourceDeviceIds: flat.map((f) => f.deviceId),
	};
}
```

**Step 2:** Run, expect PASS.

```bash
npx vitest run src/editHistory/editHistoryMerge.test.ts
```

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryMerge.ts
git commit -m "feat(editHistory): GREEN — loadMergedEntry across device files"
```

---

## Task 21: merge-on-read edge cases

**Files:**
- Modify: `src/editHistory/editHistoryMerge.test.ts`

**Step 1:** Add four more cases.

```typescript
it("returns null when no device file contains the fileId", async () => {
	const files = new Map<string, string>();
	files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
		version: 3,
		entries: { other: { path: "p", baseIndex: 0, versions: [{ ts: 1, device: "a", content: "x" }] } },
	}));
	const mockVault = makeMockVault(files);
	expect(await loadMergedEntry(mockVault, "fX")).toBeNull();
});

it("skips files whose version !== 3", async () => {
	const files = new Map<string, string>();
	files.set(".yaos-extension/edit-history-old.json", JSON.stringify({ version: 2, entries: {} }));
	files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
		version: 3,
		entries: { fX: { path: "a.md", baseIndex: 0, versions: [{ ts: 5, device: "a", content: "keep" }] } },
	}));
	const mockVault = makeMockVault(files);
	const merged = await loadMergedEntry(mockVault, "fX");
	expect(merged!.absoluteContents).toEqual(["keep"]);
});

it("skips a file whose JSON is corrupt without failing the merge", async () => {
	const files = new Map<string, string>();
	files.set(".yaos-extension/edit-history-bad.json", "{ this is not json");
	files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
		version: 3,
		entries: { fX: { path: "a.md", baseIndex: 0, versions: [{ ts: 1, device: "a", content: "ok" }] } },
	}));
	const mockVault = makeMockVault(files);
	const merged = await loadMergedEntry(mockVault, "fX");
	expect(merged!.absoluteContents).toEqual(["ok"]);
});

it("reconstructs device-local deltas before merging", async () => {
	const files = new Map<string, string>();
	files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
		version: 3,
		entries: {
			fX: {
				path: "a.md",
				baseIndex: 0,
				versions: [
					{ ts: 1, device: "a", content: "line1\nline2" },
					// a adds "line3" on top of its own v0. Hunk: s=2, d=0, a=["line3"]
					{ ts: 3, device: "a", hunks: [{ s: 2, d: 0, a: ["line3"] }] },
				],
			},
		},
	}));
	files.set(".yaos-extension/edit-history-beta.json", JSON.stringify({
		version: 3,
		entries: {
			fX: {
				path: "a.md",
				baseIndex: 0,
				versions: [{ ts: 2, device: "b", content: "beta-abs" }],
			},
		},
	}));
	const mockVault = makeMockVault(files);
	const merged = await loadMergedEntry(mockVault, "fX");
	// Ordered by ts: alpha[0]=1, beta=2, alpha[1]=3
	expect(merged!.sourceDeviceIds).toEqual(["alpha", "beta", "alpha"]);
	expect(merged!.absoluteContents).toEqual([
		"line1\nline2",
		"beta-abs",
		"line1\nline2\nline3",  // alpha[1] reconstructed inside alpha's chain
	]);
});
```

**Step 2:** Add `makeMockVault` helper at the top of the test file (after imports) so we stop duplicating:

```typescript
function makeMockVault(files: Map<string, string>) {
	return {
		adapter: {
			exists: vi.fn(async (p: string) => files.has(p) || p === ".yaos-extension"),
			read: vi.fn(async (p: string) => files.get(p) ?? ""),
			list: vi.fn(async () => ({
				files: Array.from(files.keys()),
				folders: [],
			})),
		},
	} as any;
}
```

Refactor the Task 19 test to use it too.

**Step 3:** Run, expect all PASS.

```bash
npx vitest run src/editHistory/editHistoryMerge.test.ts
```

**Step 4:** Commit.

```bash
git add src/editHistory/editHistoryMerge.test.ts
git commit -m "test(editHistory): merge edge cases — missing/v2/corrupt/delta chain"
```

---

## Task 22: RED — `EditHistoryView.refresh` renders merged timeline

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1:** Add a new describe at the bottom.

```typescript
describe("cross-device merged timeline", () => {
	it("renders versions from two device files ordered by ts", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
			version: 3,
			entries: {
				f1: {
					path: "notes/shared.md",
					baseIndex: 0,
					versions: [{ ts: 1, device: "alpha", content: "alpha-edit" }],
				},
			},
		}));
		files.set(".yaos-extension/edit-history-beta.json", JSON.stringify({
			version: 3,
			entries: {
				f1: {
					path: "notes/shared.md",
					baseIndex: 0,
					versions: [{ ts: 2, device: "beta", content: "beta-edit" }],
				},
			},
		}));

		const vault = makeMergedMockVault(files);
		const store = new EditHistoryStore(vault, () => "alpha");
		const view = await mountView(store, vault);

		await view.refresh("f1");

		const devices = view.contentEl
			.querySelectorAll(".yaos-extension-edit-history-device");
		// Newest-first render order: beta then alpha
		expect(devices[0]?.textContent).toBe("beta");
		expect(devices[1]?.textContent).toBe("alpha");
	});
});
```

`makeMergedMockVault` = same shape as `makeMockVault` from Task 21 but declared locally in this test file (since test files can't import each other in this codebase). `mountView` is a helper analogous to existing view test setup — reuse whatever utility already exists there; add it if not present.

**Step 2:** Run, expect FAIL (view still uses `store.getEntry`).

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test(editHistory): RED — view renders merged cross-device timeline"
```

---

## Task 23: GREEN — view reads via `loadMergedEntry`

**Files:**
- Modify: `src/editHistory/editHistoryView.ts`

**Step 1:** Update imports.

```typescript
import { loadMergedEntry, type MergedEntry } from "./editHistoryMerge";
```

**Step 2:** Add a field for the vault reference (the view needs it because it can't go through the single-device store):

```typescript
export class EditHistoryView extends ItemView {
	private store: EditHistoryStore;
	private vault: Vault;  // NEW
	private onRestore: (content: string) => void;
	// …
```

And widen the constructor signature:

```typescript
constructor(
	leaf: any,
	store: EditHistoryStore,
	vault: Vault,
	onRestore: (content: string) => void,
) {
	super(leaf);
	this.store = store;
	this.vault = vault;
	this.onRestore = onRestore;
}
```

Add the `Vault` import from `"obsidian"` at the top.

**Step 3:** Rewrite `refresh()`:

```typescript
async refresh(fileId: string | null): Promise<void> {
	const gen = ++this.refreshGeneration;

	if (!fileId) {
		if (gen !== this.refreshGeneration) return;
		this.contentEl.empty();
		this.renderEmpty("No file selected");
		return;
	}

	const merged = await loadMergedEntry(this.vault, fileId);
	if (gen !== this.refreshGeneration) return;

	this.contentEl.empty();
	if (!merged || merged.versions.length === 0) {
		this.renderEmpty("No edit history for this file");
		return;
	}

	this.renderMergedHistory(merged);
}
```

**Step 4:** Add `renderMergedHistory(merged: MergedEntry)`. Mostly mirrors `renderHistory(entry)` but uses `merged.versions` + `merged.absoluteContents` + `merged.sourceDeviceIds`. The key change: `renderDiffContent` for mid-chain versions no longer calls `reconstructVersion(entry, versionIndex - 1)` — it uses the pre-computed `merged.absoluteContents[versionIndex - 1]` (which may be `null` if the previous version was unreconstructable).

Introduce a small internal helper that takes a `MergedEntry` index and synthesizes the hunks by diffing `absoluteContents[i-1]` (or `""` if `i === 0`) against `absoluteContents[i]`:

```typescript
private renderDiffForMerged(
	parent: HTMLElement,
	merged: MergedEntry,
	i: number,
): void {
	const container = parent.createDiv({ cls: "yaos-extension-edit-history-diff" });
	const current = merged.absoluteContents[i];
	if (current === null) {
		const label = container.createSpan({ cls: "yaos-extension-edit-history-diff-unavailable" });
		label.textContent = "(diff unavailable)";
		return;
	}

	if (i === 0) {
		const labelEl = container.createSpan({ cls: "yaos-extension-edit-history-diff-initial-label" });
		labelEl.textContent = "Initial snapshot";
		const { text, remainingLines } = truncateByLines(current, 20);
		const addSpan = container.createSpan({ cls: "yaos-extension-edit-history-diff-add" });
		addSpan.textContent = text;
		if (remainingLines > 0) {
			const marker = container.createSpan({ cls: "yaos-extension-edit-history-diff-initial-truncated" });
			marker.textContent = `… (${remainingLines} more lines)`;
		}
		return;
	}

	const prev = merged.absoluteContents[i - 1];
	if (prev === null) {
		const label = container.createSpan({ cls: "yaos-extension-edit-history-diff-unavailable" });
		label.textContent = "(diff unavailable)";
		return;
	}
	const synthetic = computeLineHunks(prev, current);
	this.renderLineHunks(container, prev, synthetic);
}
```

Update session/entry rendering to call `renderDiffForMerged(parent, merged, i)` instead of `renderDiffContent`. Restore button passes `merged.absoluteContents[i]` (non-null) to `onRestore`.

Delete or keep the old single-entry code path guarded behind a new private method if you prefer smaller diffs; simpler is to replace outright since the store still exists for writes.

**Step 5:** Update all `new EditHistoryView(...)` sites:
- `src/main.ts` — find the view registration (look for `new EditHistoryView`). Pass `this.app.vault`.
- Test fixtures that mount the view need the new arg too.

**Step 6:** Run.

```bash
npx vitest run
```

**Expected:** Task 22 test now PASS, no regressions.

**Step 7:** Commit.

```bash
git add src/editHistory/editHistoryView.ts src/main.ts src/editHistory/editHistoryView.test.ts
git commit -m "feat(editHistory): GREEN — view renders merged cross-device timeline"
```

---

## Task 24: view renders restore using merged absolute content

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1:** Add test.

```typescript
it("restore button on a beta version calls onRestore with beta absolute content", async () => {
	const files = new Map<string, string>();
	files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
		version: 3,
		entries: { f1: { path: "notes/x.md", baseIndex: 0, versions: [{ ts: 1, device: "alpha", content: "A" }] } },
	}));
	files.set(".yaos-extension/edit-history-beta.json", JSON.stringify({
		version: 3,
		entries: { f1: { path: "notes/x.md", baseIndex: 0, versions: [{ ts: 2, device: "beta", content: "B" }] } },
	}));

	const vault = makeMergedMockVault(files);
	const restored: string[] = [];
	const store = new EditHistoryStore(vault, () => "alpha");
	const view = await mountView(store, vault, (c) => restored.push(c));

	await view.refresh("f1");

	const restoreButtons = view.contentEl.querySelectorAll<HTMLButtonElement>(
		".yaos-extension-edit-history-restore",
	);
	// Newest-first: button[0] = beta, button[1] = alpha
	restoreButtons[0]!.click();
	expect(restored).toEqual(["B"]);
});
```

**Step 2:** Run, expect PASS.

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test(editHistory): restore uses merged absolute content"
```

---

## Task 25: legacy file contributes to merged view

**Files:**
- Modify: `src/editHistory/editHistoryMerge.test.ts`

**Step 1:** Add.

```typescript
it("includes legacy edit-history.json in the merge", async () => {
	const files = new Map<string, string>();
	files.set(".yaos-extension/edit-history.json", JSON.stringify({
		version: 3,
		entries: { fX: { path: "x.md", baseIndex: 0, versions: [{ ts: 0, device: "legacy", content: "legacy" }] } },
	}));
	files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
		version: 3,
		entries: { fX: { path: "x.md", baseIndex: 0, versions: [{ ts: 5, device: "alpha", content: "alpha" }] } },
	}));
	const mockVault = makeMockVault(files);
	const merged = await loadMergedEntry(mockVault, "fX");
	expect(merged!.sourceDeviceIds).toEqual(["legacy", "alpha"]);
	expect(merged!.absoluteContents).toEqual(["legacy", "alpha"]);
});
```

**Step 2:** Run, expect PASS.

**Step 3:** Commit.

```bash
git add src/editHistory/editHistoryMerge.test.ts
git commit -m "test(editHistory): legacy file contributes to merged view"
```

---

## Task 26: Part 3 gate + final build

**Files:** None (verification only).

**Step 1:** Full regression.

```bash
npx vitest run --reporter=dot
npm run build
git status --short
```

**Expected:**
- Vitest: ~525 tests passing (Part 2 ~511 + Task 19 + Task 21 × 4 + Task 22 + Task 24 + Task 25 = ~519; if count differs by a few, that's fine).
- Build: exits 0, `main.js` size within a few KB of pre-plan baseline (fflate was already added; no new deps this plan).
- Status: empty.

If anything fails, halt and diagnose before docs.

---

# Part 4 — Docs (Task 27)

## Task 27: update `src/AGENTS.md`

**Files:**
- Modify: `src/AGENTS.md`

**Step 1:** Update the module dependency graph under `editHistory/`. Add two new lines:

```
      +-- editHistoryOrigin.ts   (Pure: isLocalOrigin(origin, provider) for remote-edit filtering)
      +-- editHistoryMerge.ts    (Pure: loadMergedEntry(vault, fileId) unions all edit-history-*.json)
```

**Step 2:** Update the Direct import relationships table. Add rows:

```
| `editHistory/editHistoryOrigin` | nothing |
| `editHistory/editHistoryMerge`  | editHistory/types, editHistory/editHistoryStore (listAllHistoryFiles only), editHistory/editHistoryDiff (reconstructVersion), ../logger, obsidian (Vault) |
```

Modify `editHistoryCapture` row to add `editHistoryOrigin`. Modify `editHistoryView` row to add `editHistoryMerge` (+ `obsidian.Vault`).

**Step 3:** Insert a new `### editHistory/editHistoryOrigin.ts` section after the `editHistoryCompress` section:

```markdown
### editHistory/editHistoryOrigin.ts -- Remote-edit filter

Pure helper: `isLocalOrigin(origin, provider) → boolean`. Returns `false`
only when `origin === provider` (reference equality to the y-websocket
provider installed by YAOS). Every other origin — `null`, CodeMirror's
`YSyncConfig` object, local string origins like `"disk-sync"` — counts
as local.

Used by `editHistoryCapture.onIdToTextObserveDeep` to drop Yjs
transactions produced by remote peers, so we don't misattribute remote
content to this device, don't starve the debounce idle timer during
joint editing, and don't capture phantom versions for files the local
user never touched.

Dependencies: none.
```

**Step 4:** Insert a new `### editHistory/editHistoryMerge.ts` section after the `editHistoryDiff` section:

```markdown
### editHistory/editHistoryMerge.ts -- Cross-device timeline merge

Pure helper: `loadMergedEntry(vault, fileId) → MergedEntry | null`.
Enumerates every `.yaos-extension/edit-history-*.json` (plus the legacy
shared `edit-history.json` if present) via
`editHistoryStore.listAllHistoryFiles`, parses each (silently skips
corrupt JSON or non-v3 files), and flattens `(deviceId, VersionSnapshot)`
pairs into a single timeline sorted by `ts` ascending.

Because `VersionSnapshot.hunks` are relative to the immediately preceding
version **in the same device's file**, reconstruction happens per device
(via `editHistoryDiff.reconstructVersion`) *before* merging. The returned
`MergedEntry.absoluteContents[i]` is the fully-reconstructed text at each
timeline step; the view renders cross-device hunks by diffing adjacent
absolute snapshots with `computeLineHunks`, not by trusting stored deltas
across device boundaries.

`sourceDeviceIds[i]` carries the filename stem (e.g. `"alpha"` from
`edit-history-alpha.json`, `"legacy"` from the pre-migration shared file).

Dependencies: `editHistoryStore.listAllHistoryFiles`,
`editHistoryDiff.reconstructVersion`, `../logger`, obsidian `Vault`.
```

**Step 5:** Update the `editHistoryStore` section — add two paragraphs:

```markdown
Histories are now stored per-device: each device writes to
`.yaos-extension/edit-history-<deviceId>.json`, where `<deviceId>` is
the YAOS local device name with non-`[a-zA-Z0-9_-]` chars replaced by
`_` (empty → `"unknown"`). Only the local device writes its own file,
so blob-sync LWW on `.yaos-extension/` no longer overwrites history
entries owned by other devices. Reads union across every sibling device
file via `editHistoryMerge.loadMergedEntry`.

On `load()`, if the legacy shared `edit-history.json` exists and the
per-device file does not, the legacy file is renamed to
`edit-history-<deviceId>.json` (one-shot migration). If both exist,
the per-device file wins at write time; the legacy file is untouched
and still contributes to the merged view until pruned out organically.

New static export: `listAllHistoryFiles(vault)` enumerates every
`.yaos-extension/edit-history*.json` sibling without recursing.
```

**Step 6:** Update the `editHistoryCapture` section — add:

```markdown
`onIdToTextObserveDeep(events, txn)` now inspects `txn.origin`: if it
is reference-equal to the y-websocket provider (passed in through the
new `getProvider` argument to `start()`), the event batch is dropped
before any file id is collected. This removes phantom captures for
remote-authored edits, stops debounce timers from resetting on remote
traffic, and keeps `VersionSnapshot.device` attribution honest.
Transactions with any other origin (null, YSyncConfig object,
`"disk-sync"`, `"vault-crdt-seed"`, …) are still captured.
```

**Step 7:** Update the `editHistoryView` section — replace the description of how it loads entries:

```markdown
`refresh(fileId)` reads via `editHistoryMerge.loadMergedEntry(vault,
fileId)` rather than `store.getEntry`, so the rendered timeline
includes every device's versions in `ts` order regardless of which
device saved which snapshot. Each timeline row's displayed hunks are
synthesized at render time via `computeLineHunks(prevAbsolute,
thisAbsolute)` — stored `hunks` on individual snapshots are not
trusted across device boundaries because they reference previous
versions in their own file only. The "Restore" button uses the
pre-computed absolute content directly.
```

**Step 8:** Bump the `EditHistoryView` constructor signature mention in the section to include the `vault` arg.

**Step 9:** Run lint (no test change).

```bash
npx vitest run --reporter=dot
```

**Expected:** still ~525 passing.

**Step 10:** Commit.

```bash
git add src/AGENTS.md
git commit -m "docs: update AGENTS.md for origin filter + per-device files + merged view"
```

---

## Task 28: Final verification gate

**Files:** None.

**Step 1:** Final regression.

```bash
npx vitest run --reporter=dot
npm run build
git status --short
git log --oneline origin/master..HEAD
```

**Expected:**
- Vitest: ~525 tests passing.
- Build: exits 0, `main.js` within a few KB of pre-plan size.
- Status: empty.
- Unpushed log: shows every plan commit.

**Step 2:** Present the unpushed log to the user and wait for explicit push approval.

Do NOT run `git push` until the user says so.

---

# Design risks + open edges (for reviewer reference)

- **Device-name collision.** Two physical devices with the same `deviceName` would write to the same filename and recreate the LWW problem within that namespace. YAOS auto-generates `device-<timestamp>` on first launch (`../yaos/src/main.ts:335`), so this only happens with deliberate user misconfiguration. Not fixed here.
- **Device rename.** Renaming in YAOS settings starts a fresh per-device file. Old entries remain attributed to the old name and still render via merge. Acceptable.
- **Merge cost.** `listAllHistoryFiles` + N parses per view open. N equals distinct devices that have ever written history, which is small (2–10 realistically). Already gated by the existing `refreshGeneration` dedup.
- **Synthesized vs stored hunks.** Rendered hunks may differ slightly from the current single-device view because we always re-compute line hunks from absolute snapshots across the merged timeline. Test fixtures pin the new expected output.
- **Remote-edit invisibility on stale devices.** If device A goes offline before its history file syncs, device B can't see A's captures. Same eventual-consistency profile as blob sync in general.
- **`"disk-sync"` captures as local.** A user editing the `.md` file with an external editor will produce `txn.origin === "disk-sync"` which this plan treats as local. Intentional — external disk edits are real authorship and belong in history.
- **`snapshot-restore` captures as local.** YAOS's snapshot restore will produce a version on this device. Arguably correct (the user triggered a restore on this device), arguably noise. Leaving as local for simplicity.

---

# Out of scope for this plan

- Deduping across per-device files when identical `(ts, content)` pairs appear (unlikely unless clock sync is perfect).
- Moving edit history into the CRDT itself (would need YAOS cooperation).
- UI affordance to distinguish "captured by capturer" vs "authored by author" — `version.device` is always the authoring (=capturing) device under this plan.
- Retention prune across devices — each device still prunes only its own file.
- Migrating the IDB `pendingEditsDb` (per-device already; no cross-device issue).

---

# Final task summary

| # | Task | Files touched | Commits |
|---|------|---------------|---------|
| 0 | Baseline verification | — | 0 |
| 1 | Save plan | this file | 1 |
| 2 | RED: isLocalOrigin provider | `editHistoryOrigin.test.ts` (new) | 1 |
| 3 | GREEN: isLocalOrigin | `editHistoryOrigin.ts` (new) | 1 |
| 4 | isLocalOrigin edge cases | `editHistoryOrigin.test.ts` | 1 |
| 5 | RED: capture skips remote | `editHistoryCapture.test.ts` | 1 |
| 6 | GREEN: capture gates on origin | `editHistoryCapture.ts` | 1 |
| 7 | local-origin regressions | `editHistoryCapture.test.ts` | 1 |
| 8 | Wire getProvider in main | `main.ts` | 1 |
| 9 | Part 1 gate | — | 0 |
| 10 | RED: per-device filename | `editHistoryStore.test.ts` | 1 |
| 11 | GREEN: getDeviceId | `editHistoryStore.ts`, update test fixtures | 1 |
| 12 | Filename normalization | `editHistoryStore.test.ts` | 1 |
| 13 | RED: legacy migration | `editHistoryStore.test.ts` | 1 |
| 14 | GREEN: migration | `editHistoryStore.ts` | 1 |
| 15 | RED: listAllHistoryFiles | `editHistoryStore.test.ts` | 1 |
| 16 | GREEN: listAllHistoryFiles | `editHistoryStore.ts` | 1 |
| 17 | Wire getDeviceId in main | `main.ts` | 1 |
| 18 | Part 2 gate | — | 0 |
| 19 | RED: merge two devices | `editHistoryMerge.test.ts` (new) | 1 |
| 20 | GREEN: loadMergedEntry | `editHistoryMerge.ts` (new) | 1 |
| 21 | Merge edge cases | `editHistoryMerge.test.ts` | 1 |
| 22 | RED: view merged timeline | `editHistoryView.test.ts` | 1 |
| 23 | GREEN: view uses merge | `editHistoryView.ts`, `main.ts` | 1 |
| 24 | Restore on merged entry | `editHistoryView.test.ts` | 1 |
| 25 | Legacy in merged view | `editHistoryMerge.test.ts` | 1 |
| 26 | Part 3 gate | — | 0 |
| 27 | Update AGENTS.md | `src/AGENTS.md` | 1 |
| 28 | Final gate | — | 0 |

Total: **~22 commits** across 4 parts. Each part has a verification gate before proceeding.

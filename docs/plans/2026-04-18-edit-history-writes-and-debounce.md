# Edit History Write Serialization + Refresh Debouncing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate three data-integrity bugs in the edit history pipeline and reduce wasted refresh churn in `main.ts` listeners.

**Architecture:**
- **Part A** serializes `EditHistoryStore` disk writes through an internal promise-chain queue so concurrent mutations can't lose data via read-modify-write interleaving.
- **Part B** introduces a generic `transaction<T>()` primitive on the store so `EditHistoryCapture` can atomically read-compute-write, and reorders `promoteFromDb` to remove the IDB entry only after the capture succeeds.
- **Part C** adds a small shared `debounce` utility in `src/utils/` and uses it to coalesce bursty refresh handlers (`refreshCommentView`, `refreshEditHistoryView`, `refreshNotifications`) at a 50 ms trailing-edge window.

**Tech Stack:** TypeScript (strict), vitest + jsdom + fake-indexeddb, Obsidian `Vault`/`ItemView`.

---

## Background

### Race A — lost versions via `EditHistoryStore.addVersion`

`src/editHistory/editHistoryStore.ts:36-44`:

```ts
async addVersion(fileId, path, snapshot) {
  const data = await this.load();     // read entire file
  this.applyVersion(data, ...);        // mutate
  await this.save(data);               // write entire file
}
```

Two concurrent callers can interleave `load → load → save → save`, causing the first writer's version to be lost. Triggered in practice by two different files' idle timers firing close together, or by max-timer firing on one file while another file's idle completes.

### Race B — stale diff base in `captureSnapshot`

`src/editHistory/editHistoryCapture.ts:184-218`:

```ts
const entry = await this.store.getEntry(fileId);      // [1] read
// ... compute diff from lastContent ...               // [2] derive
await this.store.addVersion(fileId, path, snap);      // [3] write
```

A concurrent write between [1] and [3] means the diff is computed against outdated content. After Part A, this is still broken because `getEntry` and `addVersion` are separate transactions. Part B fixes it by wrapping both in a single store transaction.

### Race C — data loss in `promoteFromDb`

`src/editHistory/editHistoryCapture.ts:169-174`:

```ts
async promoteFromDb(fileId) {
  const pending = await this.pendingDb.get(fileId);
  if (!pending) return;
  await this.pendingDb.remove(fileId);              // removes BEFORE write succeeds
  await this.captureSnapshot(fileId, pending.path, pending.content);
}
```

If `captureSnapshot` throws, IDB entry is gone — `recoverOrphans()` has nothing to recover.

### Performance — listener fan-in

Post-generation-guard, duplicate refreshes are correct but wasteful:
- Doc switch (A→B): 2× `refreshEditHistoryView` (both leaf listeners) + possible 3rd from `vault.modify` on edit-history.json.
- Add comment: `metadataCache.changed` fires after `processFrontMatter` → second `refreshCommentView`.
- Each duplicate costs 1-2 disk reads (full JSON reparse, frontmatter parse).

A 50 ms trailing-edge debounce collapses these to one refresh without perceptible UI lag.

### Out of scope (flagged)

- **CRDT sync of `.yaos-extension/edit-history.json`** between devices is last-writer-wins at the filesystem level. Fixing this requires restructuring the store as a CRDT-mergeable data model; not addressed here.
- **`metadataCache.changed` loop** (mutation → refresh → mutation-triggering-listener) is suppressed by debouncing but not structurally fixed.

---

## Ground rules

- Strict TDD — every production change preceded by a failing test.
- Commit after each numbered task.
- `npx vitest run` is the verification command (baseline: 413 passing).
- `npm run build` must be clean at the end.
- Siblings never import each other — per `src/AGENTS.md`. `src/utils/debounce.ts` is a new leaf module with no dependencies.
- Existing test style preserved: real timers + small sleeps where timers are involved (match `editHistoryCapture.test.ts` convention). No introduction of `vi.useFakeTimers()` unless a task explicitly justifies it.

---

## Part A — Serialize `EditHistoryStore` writes

### Task A1: Failing test — concurrent `addVersion` to different fileIds

**Files:**
- Modify: `src/editHistory/editHistoryStore.test.ts`

**Step 1: Append a new `describe("write serialization", ...)` block at the end of the outer describe (before final `});`)**

```ts
	describe("write serialization", () => {
		// Deferred adapter.write — gives us control over when writes resolve,
		// so we can force read-modify-write interleaving.
		function makeSlowVault(files: Record<string, string>, gate: { pending: Array<() => void> }) {
			return {
				adapter: {
					exists: vi.fn(async (path: string) => path in files),
					mkdir: vi.fn(async (path: string) => { files[path] = ""; }),
					read: vi.fn(async (path: string) => {
						if (!(path in files)) throw new Error("File not found");
						return files[path];
					}),
					write: vi.fn(async (path: string, data: string) => {
						await new Promise<void>((r) => { gate.pending.push(() => { files[path] = data; r(); }); });
					}),
				},
			} as any;
		}

		it("concurrent addVersion to different fileIds preserves both versions", async () => {
			const files: Record<string, string> = {};
			const gate = { pending: [] as Array<() => void> };
			const slowVault = makeSlowVault(files, gate);
			const store = new EditHistoryStore(slowVault);

			const p1 = store.addVersion("file-a", "a.md", { ts: 1, device: "D", content: "a" });
			const p2 = store.addVersion("file-b", "b.md", { ts: 2, device: "D", content: "b" });

			// Release writes in order so they complete sequentially (serialized).
			// If the store is NOT serialized, both load() calls already completed
			// against the empty file and releasing either write first loses the other.
			while (gate.pending.length < 1) await new Promise((r) => setTimeout(r, 0));
			gate.pending.shift()!();
			await p1;
			while (gate.pending.length < 1) await new Promise((r) => setTimeout(r, 0));
			gate.pending.shift()!();
			await p2;

			const data = JSON.parse(files[HISTORY_PATH]!);
			expect(data.entries["file-a"]).toBeDefined();
			expect(data.entries["file-b"]).toBeDefined();
		});
	});
```

**Step 2: Run to verify failure**

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

Expected: test fails — one of `entries["file-a"]` / `entries["file-b"]` is `undefined` because the two writers raced.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryStore.test.ts
git commit -m "test: reproduce EditHistoryStore concurrent addVersion race"
```

---

### Task A2: Failing test — concurrent `addVersion` to same fileId

**Files:**
- Modify: `src/editHistory/editHistoryStore.test.ts`

**Step 1: Add within the same `describe("write serialization")` block**

```ts
		it("concurrent addVersion to same fileId preserves both versions", async () => {
			const files: Record<string, string> = {};
			const gate = { pending: [] as Array<() => void> };
			const slowVault = makeSlowVault(files, gate);
			const store = new EditHistoryStore(slowVault);

			const p1 = store.addVersion("file-a", "a.md", { ts: 1, device: "D", content: "v1" });
			const p2 = store.addVersion("file-a", "a.md", { ts: 2, device: "D", diff: [[0, "v1"], [1, "2"]] });

			while (gate.pending.length < 1) await new Promise((r) => setTimeout(r, 0));
			gate.pending.shift()!();
			await p1;
			while (gate.pending.length < 1) await new Promise((r) => setTimeout(r, 0));
			gate.pending.shift()!();
			await p2;

			const data = JSON.parse(files[HISTORY_PATH]!);
			expect(data.entries["file-a"]!.versions.length).toBe(2);
		});
```

**Step 2: Run**

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

Expected: fails with `expected 1 to be 2` (second writer's load saw pre-first-write data).

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryStore.test.ts
git commit -m "test: reproduce EditHistoryStore same-fileId write race"
```

---

### Task A3: Implement write queue

**Files:**
- Modify: `src/editHistory/editHistoryStore.ts`

**Step 1: Add `writeQueue` field + `enqueue` helper, wrap mutating methods**

```ts
export class EditHistoryStore {
	private vault: Vault;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(vault: Vault) {
		this.vault = vault;
	}

	private enqueue<T>(op: () => Promise<T>): Promise<T> {
		const next = this.writeQueue.then(op, op);
		// Keep the chain alive without propagating failures into the queue head.
		this.writeQueue = next.then(() => {}, () => {});
		return next;
	}

	async load(): Promise<EditHistoryData> {
		// unchanged
	}

	async save(data: EditHistoryData): Promise<void> {
		// unchanged — callers of save() from outside the store are rare (tests only)
		// and don't need serialization; internal callers already hold the queue.
		const dir = ".yaos-extension";
		if (!(await this.vault.adapter.exists(dir))) {
			await this.vault.adapter.mkdir(dir);
		}
		await this.vault.adapter.write(HISTORY_PATH, JSON.stringify(data, null, "\t"));
	}

	async addVersion(fileId: string, path: string, snapshot: VersionSnapshot): Promise<void> {
		return this.enqueue(async () => {
			const data = await this.load();
			this.applyVersion(data, fileId, path, snapshot);
			await this.save(data);
		});
	}

	async addVersions(entries: Array<{ fileId: string; path: string; snapshot: VersionSnapshot }>): Promise<void> {
		if (entries.length === 0) return;
		return this.enqueue(async () => {
			const data = await this.load();
			for (const { fileId, path, snapshot } of entries) {
				this.applyVersion(data, fileId, path, snapshot);
			}
			await this.save(data);
		});
	}

	private applyVersion(/* unchanged */) { /* ... */ }

	async getEntry(fileId: string): Promise<FileHistoryEntry | undefined> {
		// Not enqueued: reads are safe because `save` writes the whole file
		// atomically (via adapter.write) and `load` parses the fully-written file.
		// A read overlapping an in-flight write sees either the pre-write or
		// post-write state, never a torn state.
		const data = await this.load();
		return data.entries[fileId];
	}

	async prune(retentionDays: number): Promise<void> {
		return this.enqueue(async () => {
			// existing prune body (operate on `data` in place, then save)
		});
	}

	async pruneEntry(fileId: string): Promise<void> {
		return this.enqueue(async () => {
			const data = await this.load();
			delete data.entries[fileId];
			await this.save(data);
		});
	}
}
```

Note: the existing `prune` body is long; the diff will be cosmetic (wrap in `return this.enqueue(async () => { <existing body> })`). Keep all internal logic unchanged.

**Step 2: Run targeted tests**

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

Expected: all tests pass, including A1 and A2.

**Step 3: Run full suite**

```bash
npx vitest run
```

Expected: 415 passing (413 + 2 new).

**Step 4: Commit**

```bash
git add src/editHistory/editHistoryStore.ts
git commit -m "fix(editHistory): serialize store writes via promise queue

Two concurrent addVersion calls could interleave their load-modify-save
cycles and lose the first writer's version. Introduces an internal
writeQueue so all mutating methods (addVersion, addVersions, prune,
pruneEntry) are serialized. Reads (getEntry, load) remain unqueued
because adapter.write is atomic at the filesystem level — a read
sees either pre-write or post-write state, never torn.

Part 1 of 3 in a fix series: the captureSnapshot read-compute-write
race and the promoteFromDb IDB-remove-before-write race are addressed
in follow-up commits."
```

---

## Part B — Atomic capture + safe IDB ordering

### Task B1: Failing test — captureSnapshot read-compute-write race

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Append a new `describe("capture atomicity", ...)` block**

```ts
	describe("capture atomicity", () => {
		it("concurrent captureSnapshot calls do not drop versions or compute diffs against stale base", async () => {
			// Force two captures on the same file in flight simultaneously.
			// Without atomic read-compute-write, the second capture computes its
			// diff against lastContent from a pre-first-capture entry, so when
			// the first capture lands, the second's diff is stale — applying it
			// produces wrong reconstructed content.

			// Use a real store so we hit the actual load-save path.
			const files: Record<string, string> = {};
			const vault = {
				adapter: {
					exists: vi.fn(async (p: string) => p in files),
					mkdir: vi.fn(async (p: string) => { files[p] = ""; }),
					read: vi.fn(async (p: string) => files[p] ?? (() => { throw new Error("not found"); })()),
					write: vi.fn(async (p: string, d: string) => { files[p] = d; }),
				},
			} as any;

			const realStore = new EditHistoryStore(vault);
			const { capture: c, pendingDb: db } = await makeCaptureWithDb(realStore, { debounceMs: 1000 });

			try {
				// Seed: first version goes through cleanly.
				await c.captureSnapshot("f1", "a.md", "v0");

				// Fire two simultaneous captures.
				const p1 = c.captureSnapshot("f1", "a.md", "v0 first");
				const p2 = c.captureSnapshot("f1", "a.md", "v0 first second");
				await Promise.all([p1, p2]);

				const entry = await realStore.getEntry("f1");
				expect(entry).toBeDefined();
				// Three versions total: base + 2 deltas.
				expect(entry!.versions.length).toBe(3);

				// Reconstruct the final version — it must match the last captured content.
				const { reconstructVersion } = await import("./editHistoryDiff");
				const final = reconstructVersion(entry!, entry!.versions.length - 1);
				expect(final).toBe("v0 first second");
			} finally {
				c.stop();
				await db.clear();
				db.close();
			}
		});
	});
```

**Step 2: Run**

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

Expected: fails — either `versions.length !== 3` or `final !== "v0 first second"` because the second capture's diff was computed against `"v0"` not `"v0 first"`.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test: reproduce captureSnapshot read-then-write race"
```

---

### Task B2: Refactor — add `EditHistoryStore.transaction<T>` primitive

**Files:**
- Modify: `src/editHistory/editHistoryStore.ts`

**Step 1: Add `transaction<T>()` method + refactor mutating methods to use it**

```ts
	/**
	 * Atomically read, mutate, and write the edit history file.
	 * The callback receives the current data; its mutations are flushed to disk
	 * when it resolves. Serialized against all other mutating operations via
	 * the internal write queue.
	 */
	async transaction<T>(fn: (data: EditHistoryData) => T | Promise<T>): Promise<T> {
		return this.enqueue(async () => {
			const data = await this.load();
			const result = await fn(data);
			await this.save(data);
			return result;
		});
	}

	async addVersion(fileId: string, path: string, snapshot: VersionSnapshot): Promise<void> {
		await this.transaction((data) => {
			this.applyVersion(data, fileId, path, snapshot);
		});
	}

	async addVersions(entries: Array<{ fileId: string; path: string; snapshot: VersionSnapshot }>): Promise<void> {
		if (entries.length === 0) return;
		await this.transaction((data) => {
			for (const { fileId, path, snapshot } of entries) {
				this.applyVersion(data, fileId, path, snapshot);
			}
		});
	}

	async pruneEntry(fileId: string): Promise<void> {
		await this.transaction((data) => {
			delete data.entries[fileId];
		});
	}

	async prune(retentionDays: number): Promise<void> {
		await this.transaction((data) => {
			const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
			for (const fileId of Object.keys(data.entries)) {
				// ... existing body, operating on `data` in place ...
			}
		});
	}
```

**Step 2: Run targeted tests**

```bash
npx vitest run src/editHistory/editHistoryStore.test.ts
```

Expected: all 335+ lines of existing tests still pass. **No behavior change.**

**Step 3: Run full suite (B1 still fails — expected)**

```bash
npx vitest run
```

Expected: 414 passing, 1 failing (B1). Capture-level race untouched yet.

**Step 4: Commit**

```bash
git add src/editHistory/editHistoryStore.ts
git commit -m "refactor(editHistory): add transaction<T>() primitive on store

Exposes a generic transactional API so callers can atomically
read-compute-write without exposing writeQueue internals. addVersion,
addVersions, prune, and pruneEntry now go through transaction()
internally (no behavior change). Sets up the captureSnapshot fix in
the next commit."
```

---

### Task B3: Fix — route `captureSnapshot` + `batchCapture` through `transaction()`

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts`
- Modify: `src/editHistory/editHistoryCapture.test.ts` (update `makeStore` helper)

**Step 1: Rewrite `captureSnapshot` to do its read + write in one transaction**

```ts
async captureSnapshot(
	fileId: string,
	path: string,
	content: string,
): Promise<void> {
	if (content.length > this.maxSizeBytes) return;
	if (!this.isWithinDailyLimit(fileId)) return;

	let didAdd = false;
	await this.store.transaction((data) => {
		const entry = data.entries[fileId];

		if (!entry) {
			data.entries[fileId] = {
				path,
				baseIndex: 0,
				versions: [{ ts: Date.now(), device: this.getDeviceName(), content }],
			};
			didAdd = true;
			return;
		}

		const lastContent = reconstructVersion(entry, entry.versions.length - 1);
		if (lastContent === content) return; // no-op

		entry.path = path;
		const versionsSinceBase = entry.versions.length - entry.baseIndex;
		if (versionsSinceBase >= this.settings.rebaseInterval || lastContent === null) {
			entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), content });
			entry.baseIndex = entry.versions.length - 1;
		} else {
			const diff = computeDiff(lastContent, content);
			entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), diff });
		}
		didAdd = true;
	});

	if (didAdd) this.incrementDailyCount(fileId);
}
```

**Step 2: Rewrite `batchCapture` similarly**

```ts
private async batchCapture(edits: Array<{ fileId: string; path: string; content: string }>): Promise<void> {
	const accepted: string[] = [];
	await this.store.transaction((data) => {
		for (const edit of edits) {
			if (edit.content.length > this.maxSizeBytes) continue;
			if (!this.isWithinDailyLimit(edit.fileId)) continue;

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

			const lastContent = reconstructVersion(entry, entry.versions.length - 1);
			if (lastContent === edit.content) continue;

			entry.path = edit.path;
			const versionsSinceBase = entry.versions.length - entry.baseIndex;
			if (versionsSinceBase >= this.settings.rebaseInterval || lastContent === null) {
				entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), content: edit.content });
				entry.baseIndex = entry.versions.length - 1;
			} else {
				const diff = computeDiff(lastContent, edit.content);
				entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), diff });
			}
			accepted.push(edit.fileId);
		}
	});
	for (const fileId of accepted) this.incrementDailyCount(fileId);
}
```

**Step 3: Update `makeStore` in `editHistoryCapture.test.ts` to implement `transaction`**

Inside the returned store object, add:

```ts
		async transaction<T>(fn: (data: EditHistoryData) => T | Promise<T>): Promise<T> {
			const data: EditHistoryData = { version: 1, entries };
			const result = await fn(data);
			// entries is already the `data.entries` reference, so in-place mutations persist.
			return result;
		},
```

**Step 4: Run capture tests**

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

Expected: all pass including B1.

**Step 5: Run full suite**

```bash
npx vitest run
```

Expected: 415 passing.

**Step 6: Commit**

```bash
git add src/editHistory/editHistoryCapture.ts src/editHistory/editHistoryCapture.test.ts
git commit -m "fix(editHistory): move captureSnapshot into store transaction

Previously captureSnapshot read the entry, computed a diff against
reconstructed last content, then wrote — a concurrent addVersion
between the read and the write would make the computed diff stale,
corrupting reconstructed history.

Routes both captureSnapshot and batchCapture through
EditHistoryStore.transaction so the read-compute-write is atomic
against all other store mutations. Daily-limit counting stays outside
the transaction (it's in-memory only)."
```

---

### Task B4: Failing test — `promoteFromDb` data loss on write failure

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Add test**

```ts
		it("promoteFromDb keeps pending edit in IDB when captureSnapshot fails", async () => {
			// Make the store throw on the next transaction.
			const failingStore = {
				async getEntry() { return undefined; },
				async transaction(_fn: any) {
					throw new Error("disk full");
				},
				async addVersion() { throw new Error("disk full"); },
				async addVersions() { throw new Error("disk full"); },
				async load() { return { version: 1, entries: {} }; },
				async save() { throw new Error("disk full"); },
			} as any as EditHistoryStore;

			const { capture: c, pendingDb: db } = await makeCaptureWithDb(failingStore, { debounceMs: 20 });
			try {
				c.scheduleCapture("f1", "a.md", "hello");
				await sleep(50); // let idle fire → fireCapture → promoteFromDb

				// After a failed promote, the IDB entry MUST still be present so
				// recoverOrphans can retry on next plugin load.
				const stillPending = await db.get("f1");
				expect(stillPending).toBeDefined();
				expect(stillPending!.content).toBe("hello");
			} finally {
				c.stop();
				await db.clear();
				db.close();
			}
		});
```

**Step 2: Run**

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

Expected: fails — current code `remove`s the entry before the write throws.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test: reproduce promoteFromDb data-loss on capture failure"
```

---

### Task B5: Fix — remove IDB entry only after successful capture

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts`

**Step 1: Reorder `promoteFromDb`**

```ts
private async promoteFromDb(fileId: string): Promise<void> {
	const pending = await this.pendingDb.get(fileId);
	if (!pending) return;
	try {
		await this.captureSnapshot(fileId, pending.path, pending.content);
		await this.pendingDb.remove(fileId);
	} catch (e) {
		logWarn(
			"editHistoryCapture: promoteFromDb failed, keeping pending edit for recovery",
			e,
		);
	}
}
```

**Step 2: Run capture tests**

```bash
npx vitest run src/editHistory/editHistoryCapture.test.ts
```

Expected: all pass.

**Step 3: Run full suite**

```bash
npx vitest run
```

Expected: 416 passing.

**Step 4: Commit**

```bash
git add src/editHistory/editHistoryCapture.ts
git commit -m "fix(editHistory): remove pending edit only after successful capture

If captureSnapshot threw (disk full, transaction aborted mid-flush),
the IDB entry was already gone and recoverOrphans had nothing to
retry. Flip the order: only remove after the store write succeeds,
and wrap in try/catch with a warn log so next plugin load picks up
the orphan."
```

---

## Part C — Debounce refresh handlers in `main.ts`

### Task C1: Failing test — debounce utility

**Files:**
- Create: `src/utils/debounce.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createDebouncer } from "./debounce";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("createDebouncer", () => {
	it("coalesces N calls within the window into one execution", async () => {
		const debounce = createDebouncer(30);
		const fn = vi.fn(async () => {});

		debounce(fn);
		debounce(fn);
		debounce(fn);

		expect(fn).toHaveBeenCalledTimes(0);
		await sleep(50);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("uses the LATEST function passed (trailing-edge replacement)", async () => {
		const debounce = createDebouncer(30);
		const a = vi.fn(async () => {});
		const b = vi.fn(async () => {});
		const c = vi.fn(async () => {});

		debounce(a);
		debounce(b);
		debounce(c);

		await sleep(50);
		expect(a).not.toHaveBeenCalled();
		expect(b).not.toHaveBeenCalled();
		expect(c).toHaveBeenCalledTimes(1);
	});

	it("returned promise resolves after the trailing execution completes", async () => {
		const debounce = createDebouncer(30);
		let done = false;
		const p = debounce(async () => {
			await sleep(10);
			done = true;
		});

		expect(done).toBe(false);
		await p;
		expect(done).toBe(true);
	});

	it("subsequent calls after the window start a new cycle", async () => {
		const debounce = createDebouncer(30);
		const fn = vi.fn(async () => {});

		debounce(fn);
		await sleep(50);
		expect(fn).toHaveBeenCalledTimes(1);

		debounce(fn);
		await sleep(50);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
```

**Step 2: Run**

```bash
npx vitest run src/utils/debounce.test.ts
```

Expected: fails because the module doesn't exist.

**Step 3: Commit (the failing test only)**

```bash
git add src/utils/debounce.test.ts
git commit -m "test: add createDebouncer trailing-edge utility tests"
```

---

### Task C2: Implement `src/utils/debounce.ts`

**Files:**
- Create: `src/utils/debounce.ts`

**Step 1: Implement**

```ts
/**
 * Trailing-edge debouncer. Returns a function that, when called with a task,
 * schedules the task to run after `ms` milliseconds of quiescence. If called
 * again before that window expires, the latest task replaces the scheduled one
 * and the timer resets.
 *
 * The returned promise resolves when the scheduled task completes. All calls
 * within a single quiescent window share the same promise.
 */
export function createDebouncer(ms: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pendingTask: (() => Promise<void> | void) | null = null;
	let pendingPromise: Promise<void> | null = null;
	let resolvePending: (() => void) | null = null;
	let rejectPending: ((e: unknown) => void) | null = null;

	return (task: () => Promise<void> | void): Promise<void> => {
		pendingTask = task;

		if (!pendingPromise) {
			pendingPromise = new Promise<void>((resolve, reject) => {
				resolvePending = resolve;
				rejectPending = reject;
			});
		}

		if (timer) clearTimeout(timer);
		timer = setTimeout(async () => {
			timer = null;
			const runTask = pendingTask!;
			const resolver = resolvePending!;
			const rejecter = rejectPending!;
			pendingTask = null;
			pendingPromise = null;
			resolvePending = null;
			rejectPending = null;
			try {
				await runTask();
				resolver();
			} catch (e) {
				rejecter(e);
			}
		}, ms);

		return pendingPromise;
	};
}
```

**Step 2: Run**

```bash
npx vitest run src/utils/debounce.test.ts
```

Expected: all pass.

**Step 3: Full suite**

```bash
npx vitest run
```

Expected: 420 passing (416 + 4 new).

**Step 4: Commit**

```bash
git add src/utils/debounce.ts
git commit -m "feat(utils): add createDebouncer trailing-edge utility

Small stateful debouncer used by main.ts to coalesce burst refresh
calls. Returns a promise per quiescent window so callers awaiting
refresh completion still get a deterministic signal."
```

---

### Task C3: Wire debouncer into `main.ts` refresh handlers

**Files:**
- Modify: `src/main.ts`

**Step 1: Import and instantiate**

Near the top of the class, add three debouncer instances and route the three `refresh*` methods through them.

```ts
import { createDebouncer } from "./utils/debounce";

// inside the plugin class:
private debouncedCommentRefresh = createDebouncer(50);
private debouncedEditHistoryRefresh = createDebouncer(50);
private debouncedNotificationsRefresh = createDebouncer(50);

private async refreshCommentView(): Promise<void> {
	return this.debouncedCommentRefresh(async () => {
		const filePath = this.getActiveFilePath();
		if (!filePath) return;

		if (this.inlinePanel) {
			await this.inlinePanel.refresh(filePath);
		}

		const leaves = this.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
		for (const leaf of leaves) {
			if (leaf.view instanceof CommentView) {
				await leaf.view.refresh(filePath);
			}
		}
	});
}

private async refreshEditHistoryView(): Promise<void> {
	return this.debouncedEditHistoryRefresh(async () => {
		const leaves = this.app.workspace.getLeavesOfType(EDIT_HISTORY_VIEW_TYPE);
		if (leaves.length === 0) return;
		const activePath = this.getActiveFilePath();
		let fileId: string | null = null;
		if (activePath) {
			fileId = getFileId(this.app, activePath) ?? null;
		}
		for (const leaf of leaves) {
			if (leaf.view instanceof EditHistoryView) {
				await leaf.view.refresh(fileId);
			}
		}
	});
}

private async refreshNotifications(): Promise<void> {
	return this.debouncedNotificationsRefresh(async () => {
		// existing body (log + view refresh + badge update)
	});
}
```

**Step 2: Run full suite to confirm no regression**

```bash
npx vitest run
```

Expected: 420 passing. No test touches `main.ts` directly (main.ts has no unit tests).

**Step 3: Build**

```bash
npm run build
```

Expected: clean.

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "perf(main): debounce refresh handlers at 50ms trailing edge

Workspace and vault listeners fire several times per user-visible
action (active-leaf-change double-fires, vault.modify lands after
metadataCache.changed, etc.). With the refreshGeneration guard shipped
in the previous series, these extra refreshes are correct but each
incurs a disk reparse.

Coalesce via a 50ms trailing debouncer — imperceptible to users,
eliminates redundant work. Applies to refreshCommentView,
refreshEditHistoryView, and refreshNotifications uniformly."
```

---

## Part D — Docs

### Task D1: Update `src/AGENTS.md`

**Files:**
- Modify: `src/AGENTS.md`

**Step 1: Update `editHistoryStore.ts` section**

Add after the existing "Key methods" list:

> All mutating methods (`addVersion`, `addVersions`, `prune`, `pruneEntry`)
> are serialized through an internal `writeQueue: Promise<void>` so
> concurrent mutations can't interleave their load-modify-save cycles.
> The `transaction<T>(fn)` primitive exposes this atomicity to callers
> that need read-compute-write — `EditHistoryCapture` uses it to compute
> diffs against an up-to-date last-content snapshot. Reads (`getEntry`,
> `load`) remain unqueued because `adapter.write` is atomic at the
> filesystem level.

**Step 2: Update `editHistoryCapture.ts` section**

Append:

> `captureSnapshot` and `batchCapture` both go through
> `EditHistoryStore.transaction` so the entry lookup, diff computation,
> and version append happen atomically. `promoteFromDb` removes the
> IDB entry only after a successful capture; failures keep the entry
> for `recoverOrphans` to retry on the next plugin load.

**Step 3: Add new `utils/debounce.ts` entry**

Insert a new module-dependency-graph row and a dedicated section under "Module details":

```md
### utils/debounce.ts -- Trailing-edge debouncer

Small stateful helper used by `main.ts` to coalesce burst refresh
calls from workspace/vault listeners. `createDebouncer(ms)` returns
a function that schedules a task after `ms` ms of quiescence, replacing
any previously scheduled task. Returns a promise that resolves when
the scheduled task completes, so `await refreshXxx()` still has
deterministic semantics.

Dependencies: none.
```

And add to the dependency table:

```md
| `utils/debounce` | nothing |
| `main.ts` | ...existing..., utils/debounce |
```

**Step 4: Update the "Key architectural constraints" section**

Append one bullet:

> - **Store writes are serialized.** `EditHistoryStore` exposes
>   `transaction<T>(fn)` for callers that need atomic read-compute-write.
>   Direct callers of `addVersion`/`addVersions` get serialization for
>   free via the internal write queue.

**Step 5: Commit**

```bash
git add src/AGENTS.md
git commit -m "docs: note write serialization, transaction primitive, and debouncer"
```

---

## Full verification

### Step 1: Run full test suite

```bash
npx vitest run
```

Expected: **420 passing** (413 baseline + 4 new edit-history tests + 4 new debounce tests — some tests may share fixtures; adjust count accordingly but minimum 419).

### Step 2: Production build

```bash
npm run build
```

Expected: clean `tsc -noEmit` + esbuild.

### Step 3: Manual smoke test

Ask the user to:

1. Open doc A → edit, wait 5s → confirm a version appears in edit history.
2. Rapidly switch A → B → A → B (4 switches in 1s): edit history refreshes at most once (debounced).
3. Edit doc A continuously for >60s: max-timer fires, version saved. No duplicates after debounce window.
4. Close Obsidian mid-typing (simulate by hitting the window X on desktop): reopen, confirm pending edit recovered via `recoverOrphans` → version appears.
5. Simulate disk failure (harder; optional): if achievable, confirm warn log and pending edit retained.

---

## Done when

- [ ] All 11 tasks committed in order.
- [ ] `npx vitest run` reports ≥ 420 passing, 0 failing, 0 unexpectedly skipped.
- [ ] `npm run build` clean.
- [ ] Manual smoke test 1-4 confirmed by the user.
- [ ] `src/AGENTS.md` reflects the transaction primitive, write queue, and new `utils/debounce` module.

## Not in scope

- CRDT merge for `.yaos-extension/edit-history.json` (cross-device last-writer-wins race).
- Removing any listener in `main.ts` (Part C is additive; `refreshGeneration` + debounce together handle the existing listener fan-in).
- Generalizing the debouncer to other modules (`CommentRenderer` already has its own generation counter; `editHistoryCapture` already has idle+max timers — leave both alone).
- Version bump, release tagging, push to origin.

---

**Estimated effort:** 11 commits, ~2-3 hours of focused work. Parts A and C are straightforward; Part B (tasks B2-B3) is the riskiest because it refactors `EditHistoryStore` and `EditHistoryCapture` simultaneously — lean heavily on running the existing `editHistoryStore.test.ts` + `editHistoryCapture.test.ts` after each task.

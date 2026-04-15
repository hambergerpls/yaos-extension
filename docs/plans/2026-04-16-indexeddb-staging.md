# Two-Stage IndexedDB + JSON Edit History Persistence

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist pending edit history captures to IndexedDB immediately on every edit, so that history is not lost if Obsidian is killed before the 30s debounce timer fires.

**Architecture:** The current `scheduleCapture` stores pending content in an in-memory `Map<string, {path, content}>`. We replace this with an immediate IndexedDB write. The debounce timer still controls when the pending entry is promoted to the delta chain in `edit-history.json`. On plugin unload, any unflushed IndexedDB entries are force-promoted. On startup, orphaned entries from a previous crash are recovered.

**Tech Stack:** IndexedDB (browser native, no library), `fake-indexeddb` for tests, existing `editHistoryCapture.ts` + `editHistoryStore.ts` + `main.ts`

---

### Task 1: Create `pendingEditsDb.ts` — IndexedDB wrapper

**Files:**
- Create: `src/editHistory/pendingEditsDb.ts`
- Test: `src/editHistory/pendingEditsDb.test.ts`

This is a thin async wrapper around a single IndexedDB object store. Keyed by `fileId`, stores `{ fileId, path, content, ts }`.

**Step 1: Install `fake-indexeddb` for tests**

Run: `npm install -D fake-indexeddb --legacy-peer-deps`

**Step 2: Write the failing test**

Create `src/editHistory/pendingEditsDb.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { PendingEditsDb, type PendingEdit } from "./pendingEditsDb";

describe("PendingEditsDb", () => {
	let db: PendingEditsDb;

	beforeEach(async () => {
		db = new PendingEditsDb("test-pending-edits");
		await db.open();
	});

	afterEach(async () => {
		await db.clear();
		db.close();
	});

	describe("put and get", () => {
		it("stores and retrieves a pending edit", async () => {
			await db.put({ fileId: "f1", path: "notes/a.md", content: "hello", ts: 1000 });
			const edit = await db.get("f1");
			expect(edit).toEqual({ fileId: "f1", path: "notes/a.md", content: "hello", ts: 1000 });
		});

		it("overwrites existing entry for same fileId", async () => {
			await db.put({ fileId: "f1", path: "a.md", content: "v1", ts: 1000 });
			await db.put({ fileId: "f1", path: "a.md", content: "v2", ts: 2000 });
			const edit = await db.get("f1");
			expect(edit!.content).toBe("v2");
		});

		it("returns undefined for unknown fileId", async () => {
			const edit = await db.get("unknown");
			expect(edit).toBeUndefined();
		});
	});

	describe("getAll", () => {
		it("returns all pending edits", async () => {
			await db.put({ fileId: "f1", path: "a.md", content: "a", ts: 1 });
			await db.put({ fileId: "f2", path: "b.md", content: "b", ts: 2 });
			const all = await db.getAll();
			expect(all).toHaveLength(2);
		});

		it("returns empty array when no edits", async () => {
			const all = await db.getAll();
			expect(all).toEqual([]);
		});
	});

	describe("remove", () => {
		it("removes a pending edit", async () => {
			await db.put({ fileId: "f1", path: "a.md", content: "a", ts: 1 });
			await db.remove("f1");
			const edit = await db.get("f1");
			expect(edit).toBeUndefined();
		});

		it("is a no-op for unknown fileId", async () => {
			await db.remove("unknown");
		});
	});

	describe("clear", () => {
		it("removes all pending edits", async () => {
			await db.put({ fileId: "f1", path: "a.md", content: "a", ts: 1 });
			await db.put({ fileId: "f2", path: "b.md", content: "b", ts: 2 });
			await db.clear();
			const all = await db.getAll();
			expect(all).toEqual([]);
		});
	});

	describe("isolation", () => {
		it("uses separate database per dbName", async () => {
			const db2 = new PendingEditsDb("test-pending-edits-2");
			await db2.open();
			await db.put({ fileId: "f1", path: "a.md", content: "in db1", ts: 1 });
			await db2.put({ fileId: "f1", path: "a.md", content: "in db2", ts: 1 });

			const fromDb1 = await db.get("f1");
			const fromDb2 = await db2.get("f1");
			expect(fromDb1!.content).toBe("in db1");
			expect(fromDb2!.content).toBe("in db2");

			await db2.clear();
			db2.close();
		});
	});
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- --run src/editHistory/pendingEditsDb.test.ts`
Expected: FAIL — module `./pendingEditsDb` does not exist

**Step 4: Write the implementation**

Create `src/editHistory/pendingEditsDb.ts`:

```ts
export interface PendingEdit {
	fileId: string;
	path: string;
	content: string;
	ts: number;
}

const STORE_NAME = "pending";
const VERSION = 1;

export class PendingEditsDb {
	private dbName: string;
	private db: IDBDatabase | null = null;

	constructor(dbName: string) {
		this.dbName = dbName;
	}

	open(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: "fileId" });
				}
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onerror = () => {
				reject(request.error);
			};
		});
	}

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	async put(edit: PendingEdit): Promise<void> {
		const tx = this.requireDb().transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.put(edit);
		return this.txPromise(tx);
	}

	async get(fileId: string): Promise<PendingEdit | undefined> {
		const tx = this.requireDb().transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const request = store.get(fileId);
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result ?? undefined);
			request.onerror = () => reject(request.error);
		});
	}

	async getAll(): Promise<PendingEdit[]> {
		const tx = this.requireDb().transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const request = store.getAll();
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result ?? []);
			request.onerror = () => reject(request.error);
		});
	}

	async remove(fileId: string): Promise<void> {
		const tx = this.requireDb().transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.delete(fileId);
		return this.txPromise(tx);
	}

	async clear(): Promise<void> {
		const tx = this.requireDb().transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.clear();
		return this.txPromise(tx);
	}

	private requireDb(): IDBDatabase {
		if (!this.db) throw new Error("PendingEditsDb not opened");
		return this.db;
	}

	private txPromise(tx: IDBTransaction): Promise<void> {
		return new Promise((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	}
}
```

**Step 5: Run test to verify it passes**

Run: `npm test -- --run src/editHistory/pendingEditsDb.test.ts`
Expected: PASS — all 9 tests

**Step 6: Commit**

```
feat(edit-history): add PendingEditsDb IndexedDB wrapper
```

---

### Task 2: Wire PendingEditsDb into EditHistoryCapture

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts`
- Modify: `src/editHistory/editHistoryCapture.test.ts`

Replace the in-memory `pendingContent` map with IndexedDB writes in `scheduleCapture()`. The debounce timer reads from IndexedDB instead of the map. Add `flush()` method for unload.

**Step 1: Write the failing tests**

Add to `src/editHistory/editHistoryCapture.test.ts`. At the top, add the import:

```ts
import "fake-indexeddb/auto";
```

Update the `makeStore` helper — no changes needed (it already works).

Update the constructor call in `beforeEach` to pass a `PendingEditsDb`:

```ts
import { PendingEditsDb } from "./pendingEditsDb";

// In beforeEach:
const pendingDb = new PendingEditsDb("test-edit-history-pending");
await pendingDb.open();
capture = new EditHistoryCapture(store, () => "TestDevice", {
	rebaseInterval: 3,
	maxPerFilePerDay: 50,
	debounceMs: 30000,
}, 1_000_000, pendingDb);
```

Add a new test section for flush and IndexedDB integration:

```ts
describe("IndexedDB staging", () => {
	let pendingDb: PendingEditsDb;

	beforeEach(async () => {
		pendingDb = new PendingEditsDb("test-edit-history-pending");
		await pendingDb.open();
		capture = new EditHistoryCapture(store, () => "TestDevice", {
			rebaseInterval: 3,
			maxPerFilePerDay: 50,
			debounceMs: 30000,
		}, 1_000_000, pendingDb);
	});

	afterEach(async () => {
		await pendingDb.clear();
		pendingDb.close();
	});

	it("persists pending edit to IndexedDB on scheduleCapture", async () => {
		capture.scheduleCapture("f1", "a.md", "hello");
		const pending = await pendingDb.get("f1");
		expect(pending).toBeDefined();
		expect(pending!.content).toBe("hello");
		expect(pending!.path).toBe("a.md");
	});

	it("overwrites IndexedDB entry on subsequent scheduleCapture for same fileId", async () => {
		capture.scheduleCapture("f1", "a.md", "first");
		capture.scheduleCapture("f1", "a.md", "second");
		const pending = await pendingDb.get("f1");
		expect(pending!.content).toBe("second");
	});

	it("removes IndexedDB entry after debounce timer fires and captures", async () => {
		vi.useFakeTimers();
		capture.scheduleCapture("f1", "a.md", "hello");
		await vi.advanceTimersByTimeAsync(30000);
		expect(captured.calls).toHaveLength(1);
		const pending = await pendingDb.get("f1");
		expect(pending).toBeUndefined();
		vi.useRealTimers();
	});

	it("flush promotes all pending IndexedDB entries to edit-history.json", async () => {
		capture.scheduleCapture("f1", "a.md", "content-a");
		capture.scheduleCapture("f2", "b.md", "content-b");
		expect(captured.calls).toHaveLength(0);

		await capture.flush();

		expect(captured.calls).toHaveLength(2);
		expect(captured.calls[0].snap.content).toBe("content-a");
		expect(captured.calls[1].snap.content).toBe("content-b");

		const all = await pendingDb.getAll();
		expect(all).toEqual([]);
	});

	it("flush clears timers", async () => {
		vi.useFakeTimers();
		capture.scheduleCapture("f1", "a.md", "hello");
		await capture.flush();

		vi.advanceTimersByTime(60000);
		expect(captured.calls).toHaveLength(1);
		vi.useRealTimers();
	});
});

describe("recovery on start", () => {
	let pendingDb: PendingEditsDb;

	beforeEach(async () => {
		pendingDb = new PendingEditsDb("test-edit-history-pending");
		await pendingDb.open();
	});

	afterEach(async () => {
		await pendingDb.clear();
		pendingDb.close();
	});

	it("promotes orphaned IndexedDB entries on start", async () => {
		await pendingDb.put({ fileId: "f1", path: "orphan.md", content: "orphan content", ts: 1000 });

		capture = new EditHistoryCapture(store, () => "TestDevice", {
			rebaseInterval: 3,
			maxPerFilePerDay: 50,
			debounceMs: 30000,
		}, 1_000_000, pendingDb);

		await capture.recoverOrphans();

		expect(captured.calls).toHaveLength(1);
		expect(captured.calls[0].snap.content).toBe("orphan content");
		expect(captured.calls[0].path).toBe("orphan.md");

		const all = await pendingDb.getAll();
		expect(all).toEqual([]);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/editHistory/editHistoryCapture.test.ts`
Expected: FAIL — constructor signature mismatch, `flush` / `recoverOrphans` don't exist

**Step 3: Modify `editHistoryCapture.ts`**

The full replacement for `editHistoryCapture.ts`:

1. Import `PendingEditsDb` and `PendingEdit`
2. Add `pendingDb: PendingEditsDb` field, accept in constructor
3. In `scheduleCapture`: write to IndexedDB immediately via `this.pendingDb.put(...)` instead of `this.pendingContent.set(...)`
4. In the debounce timer callback: read from `this.pendingDb.get(fileId)` instead of `this.pendingContent.get(fileId)`, then `this.pendingDb.remove(fileId)` after capture
5. Add `async flush()`: read `this.pendingDb.getAll()`, promote each to `captureSnapshot`, clear timers, `pendingDb.clear()`
6. Add `async recoverOrphans()`: read `this.pendingDb.getAll()`, promote each to `captureSnapshot`
7. Remove the `pendingContent` Map entirely
8. In `stop()`: remove `this.pendingContent.clear()`, keep timer cleanup but don't flush (flush is called separately before stop)

Key changes to the class:

```ts
// Remove:
private pendingContent: Map<string, { path: string; content: string }> = new Map();

// Add:
private pendingDb: PendingEditsDb;

// Constructor gains pendingDb parameter:
constructor(
	store: EditHistoryStore,
	getDeviceName: () => string,
	settings: CaptureSettings,
	maxSizeBytes: number = 1_000_000,
	pendingDb: PendingEditsDb,
) {
	// ... existing assignments ...
	this.pendingDb = pendingDb;
}

// scheduleCapture writes to IndexedDB:
scheduleCapture(fileId: string, path: string, content: string): void {
	void this.pendingDb.put({ fileId, path, content, ts: Date.now() });

	const existing = this.pendingTimers.get(fileId);
	if (existing) clearTimeout(existing);

	const timer = setTimeout(() => {
		this.pendingTimers.delete(fileId);
		void this.promoteFromDb(fileId);
	}, this.settings.debounceMs);

	this.pendingTimers.set(fileId, timer);
}

// New private method — reads from IDB and promotes:
private async promoteFromDb(fileId: string): Promise<void> {
	const pending = await this.pendingDb.get(fileId);
	if (!pending) return;
	await this.pendingDb.remove(fileId);
	await this.captureSnapshot(fileId, pending.path, pending.content);
}

// New public method — force-flush on unload:
async flush(): Promise<void> {
	for (const [fileId, timer] of this.pendingTimers) {
		clearTimeout(timer);
	}
	this.pendingTimers.clear();

	const all = await this.pendingDb.getAll();
	for (const edit of all) {
		await this.captureSnapshot(edit.fileId, edit.path, edit.content);
	}
	await this.pendingDb.clear();
}

// New public method — recover orphaned entries on startup:
async recoverOrphans(): Promise<void> {
	const all = await this.pendingDb.getAll();
	for (const edit of all) {
		await this.captureSnapshot(edit.fileId, edit.path, edit.content);
	}
	await this.pendingDb.clear();
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/editHistory/editHistoryCapture.test.ts`
Expected: PASS — all tests (existing + new)

**Step 5: Commit**

```
feat(edit-history): stage pending captures to IndexedDB for crash safety
```

---

### Task 3: Wire flush + recover into main.ts lifecycle

**Files:**
- Modify: `src/main.ts`

**Step 1: Write the failing test**

No new test file needed — the wiring is in `main.ts` which is tested via integration (manual testing). The existing `start/stop` tests in `editHistoryCapture.test.ts` already verify `flush` and `recoverOrphans` work.

**Step 2: Modify `main.ts`**

Changes:

1. **Import** `PendingEditsDb` from `./editHistory/pendingEditsDb`
2. **In `onload()`**, where `EditHistoryCapture` is constructed:
   - Create a `PendingEditsDb` instance: `const pendingDb = new PendingEditsDb("yaos-ext:edit-history-pending");`
   - Open it: `await pendingDb.open();`
   - Pass it to the `EditHistoryCapture` constructor
   - Call `await capture.recoverOrphans()` before `capture.start()`
   - Store `pendingDb` as a class field `this.pendingEditsDb`
3. **In `onunload()`**, add `await this.editHistoryCapture?.flush()` **before** `this.editHistoryCapture?.stop()`

The relevant section in `onload()` currently looks like:

```ts
this.editHistoryCapture = new EditHistoryCapture(
  this.editHistoryStore,
  () => getLocalDeviceName(this.app),
  {
    rebaseInterval: this.settings.editHistoryRebaseInterval,
    maxPerFilePerDay: this.settings.editHistoryMaxPerFilePerDay,
    debounceMs: this.settings.editHistoryDebounceMs,
  },
);
this.editHistoryCapture.start(
  ydoc,
  (vaultSync as any).idToText,
  (fileId: string) => getFilePath(this.app, fileId),
  (fileId: string) => { /* ... */ },
);
```

Change to:

```ts
const pendingDb = new PendingEditsDb("yaos-ext:edit-history-pending");
await pendingDb.open();
this.pendingEditsDb = pendingDb;

this.editHistoryCapture = new EditHistoryCapture(
  this.editHistoryStore,
  () => getLocalDeviceName(this.app),
  {
    rebaseInterval: this.settings.editHistoryRebaseInterval,
    maxPerFilePerDay: this.settings.editHistoryMaxPerFilePerDay,
    debounceMs: this.settings.editHistoryDebounceMs,
  },
  1_000_000,
  pendingDb,
);

await this.editHistoryCapture.recoverOrphans();

this.editHistoryCapture.start(
  ydoc,
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

The `onunload()` section currently:

```ts
onunload() {
  this.inlinePanel?.detach();
  this.editHistoryCapture?.stop();
  this.tracker?.stop();
  // ...
}
```

Change to:

```ts
async onunload() {
  this.inlinePanel?.detach();
  await this.editHistoryCapture?.flush();
  this.editHistoryCapture?.stop();
  this.pendingEditsDb?.close();
  this.tracker?.stop();
  // ...
}
```

Note: `onunload()` must become `async` if it isn't already. Check — it currently is not async. Obsidian does `await` the result if a promise is returned, so making it async is safe.

Add the field declaration:

```ts
pendingEditsDb: PendingEditsDb | null = null;
```

**Step 3: Run full test suite + build**

Run: `npm test && npm run build`
Expected: All tests pass, build compiles

**Step 4: Commit**

```
feat(edit-history): wire IndexedDB staging into plugin lifecycle
```

---

### Task 4: Update existing tests to match new constructor signature

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

The existing tests (before the IndexedDB addition) create `EditHistoryCapture` without a `PendingEditsDb`. These need updating.

**Step 1: Update all existing test sections**

Every place that does `new EditHistoryCapture(store, ...)` needs a `PendingEditsDb` parameter.

Create a helper at the top of the test file:

```ts
import { PendingEditsDb } from "./pendingEditsDb";

async function makeCaptureWithDb(
	store: EditHistoryStore,
	settings: Partial<CaptureSettings> = {},
): Promise<{ capture: EditHistoryCapture; pendingDb: PendingEditsDb }> {
	const pendingDb = new PendingEditsDb(`test-edit-history-${Math.random().toString(36).slice(2)}`);
	await pendingDb.open();
	const capture = new EditHistoryCapture(
		store,
		() => "TestDevice",
		{
			rebaseInterval: settings.rebaseInterval ?? 3,
			maxPerFilePerDay: settings.maxPerFilePerDay ?? 50,
			debounceMs: settings.debounceMs ?? 30000,
		},
		1_000_000,
		pendingDb,
	);
	return { capture, pendingDb };
}
```

Update every test section to use this helper. Clean up databases in `afterEach`:

```ts
afterEach(async () => {
	// capture and pendingDb set in beforeEach
	if (pendingDb) {
		await pendingDb.clear();
		pendingDb.close();
	}
});
```

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```
test(edit-history): update tests for IndexedDB staging
```

---

### Task 5: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (should be ~390+ tests now)

**Step 2: Run build**

Run: `npm run build`
Expected: Clean compile, no errors

**Step 3: Manual test checklist** (for the user)

- [ ] Open Obsidian, make an edit, wait 30s → snapshot should appear in edit history sidebar
- [ ] Make an edit, immediately close Obsidian → reopen → snapshot should appear (recovered from IndexedDB)
- [ ] Make an edit, wait 30s → snapshot appears → check IndexedDB in devtools → entry should be gone
- [ ] Check `.yaos-extension/edit-history.json` → should contain delta chain entries

---

## File change summary

| File | Action | Description |
|------|--------|-------------|
| `src/editHistory/pendingEditsDb.ts` | Create | IndexedDB wrapper: open, put, get, getAll, remove, clear |
| `src/editHistory/pendingEditsDb.test.ts` | Create | Tests for IndexedDB wrapper (9 tests) |
| `src/editHistory/editHistoryCapture.ts` | Modify | Replace in-memory map with PendingEditsDb, add flush() and recoverOrphans() |
| `src/editHistory/editHistoryCapture.test.ts` | Modify | Add IndexedDB staging tests, update constructor calls, add fake-indexeddb import |
| `src/main.ts` | Modify | Create PendingEditsDb, pass to capture, call recoverOrphans() on load, flush() on unload |
| `package.json` | Modify | Add `fake-indexeddb` devDependency |

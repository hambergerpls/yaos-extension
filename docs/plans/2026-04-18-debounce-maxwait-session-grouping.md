# Debounce + maxWait + Session Grouping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 30-second trailing-edge debounce in edit history capture with a 5-second idle + 60-second maxWait pattern so snapshots fire during continuous editing, and group consecutive same-device edits within 5 minutes into collapsible sessions in the sidebar.

**Architecture:**
- **Capture** (`editHistoryCapture.ts`): two timers per file — an idle timer (resets on every edit) and a maxWait timer (set once per burst, never resets). Whichever fires first triggers the capture and cancels the other.
- **View** (`editHistoryView.ts`): walk versions newest-first, collapse adjacent same-device versions within 5 minutes into `Session` objects. Single-version sessions render unchanged. Multi-version sessions render a collapsible header with aggregate stats; individual versions are revealed on expand and retain their own Restore buttons.
- **Persistence** of expanded state across `refresh()` calls via an instance-level `Set<string>` keyed by `${device}-${startTs}`.

**Tech Stack:** TypeScript, Vitest (jsdom), Yjs (existing CRDT dependency), Obsidian `ItemView` API, `fast-diff`.

**Reference docs:**
- Authoritative design: `docs/plans/2026-04-14-edit-history-design.md`
- IDB staging (already executed): `docs/plans/2026-04-16-indexeddb-staging.md`
- Module architecture: `src/AGENTS.md`

---

## Context for the engineer

The edit history feature captures file-content snapshots from the YAOS Yjs CRDT into a vault-synced JSON file (`.yaos-extension/edit-history.json`). Every observed Y.Text change goes through two stages:

1. **IndexedDB staging** (`pendingEditsDb.ts`) — crash-safe buffer, written on every edit
2. **JSON promotion** (`editHistoryStore.ts`) — fired by a debounce timer, writes to the synced JSON

The current problem: the debounce is pure trailing-edge, so during continuous typing the timer is reset forever and nothing gets written to the JSON until the user pauses for 30 seconds. We need to enforce a maximum wait so active editing also produces snapshots.

After that's fixed, we also want the view to collapse rapid editing bursts visually, so the sidebar doesn't become a spammy list of 1-minute-apart entries.

**Key files to orient on before starting:**
- `src/editHistory/editHistoryCapture.ts` (239 lines) — the capture orchestrator, current `scheduleCapture()` at line 83
- `src/editHistory/editHistoryView.ts` (136 lines) — the sidebar, current `renderHistory()` at line 70
- `src/editHistory/editHistoryCapture.test.ts` — existing Vitest suite
- `src/editHistory/editHistoryView.test.ts` — existing view tests
- `src/settings.ts` — 5 edit-history-related settings fields
- `src/main.ts:174-236` — wiring of the edit history subsystem

**Testing conventions:**
- `fake-indexeddb/auto` must be imported at the top of any test file that uses `PendingEditsDb`
- Tests involving real timer behavior use `setTimeout`-based `sleep(ms)` helpers and short debounce values (e.g., 20ms), NOT `vi.useFakeTimers()` (which conflicts with fake-indexeddb)
- Every production change requires a failing test first; verify failure before implementing

---

## Phase A — Capture: debounce + maxWait

### Task A1: Add `maxWaitMs` to `CaptureSettings` and update existing test setup

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts` (add field to `CaptureSettings`)
- Modify: `src/editHistory/editHistoryCapture.test.ts` (update helper default)

**Step 1: Update the interface**

In `src/editHistory/editHistoryCapture.ts`, change the `CaptureSettings` interface (currently lines 7-11):

```ts
export interface CaptureSettings {
	rebaseInterval: number;
	maxPerFilePerDay: number;
	debounceMs: number;
	maxWaitMs: number;
}
```

**Step 2: Update the test helper to supply a default**

In `src/editHistory/editHistoryCapture.test.ts`, find `makeCaptureWithDb` (currently lines 44-63). Add `maxWaitMs` with default and forward it into the constructor settings:

```ts
async function makeCaptureWithDb(
	store: EditHistoryStore,
	settings: Partial<{ rebaseInterval: number; maxPerFilePerDay: number; debounceMs: number; maxWaitMs: number }> = {},
): Promise<{ capture: EditHistoryCapture; pendingDb: PendingEditsDb }> {
	pendingDbCounter++;
	const pendingDb = new PendingEditsDb(`test-edit-history-${pendingDbCounter}-${Math.random().toString(36).slice(2)}`);
	await pendingDb.open();
	const capture = new EditHistoryCapture(
		store,
		() => "TestDevice",
		{
			rebaseInterval: settings.rebaseInterval ?? 3,
			maxPerFilePerDay: settings.maxPerFilePerDay ?? 50,
			debounceMs: settings.debounceMs ?? 30000,
			maxWaitMs: settings.maxWaitMs ?? 60000,
		},
		1_000_000,
		pendingDb,
	);
	return { capture, pendingDb };
}
```

**Step 3: Run tests to confirm nothing is broken by the type change**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts`

Expected: all 22 tests still pass (the interface addition is backward-compatible because nothing yet reads `maxWaitMs`).

**Step 4: Commit**

```bash
git add src/editHistory/editHistoryCapture.ts src/editHistory/editHistoryCapture.test.ts
git commit -m "refactor: add maxWaitMs to CaptureSettings (no behavior change yet)"
```

---

### Task A2: Change `pendingTimers` data structure

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts`

**Step 1: Add the internal type and change the field**

In `src/editHistory/editHistoryCapture.ts`, near the top of the class body (currently line 17):

```ts
interface FileTimer {
	idle: ReturnType<typeof setTimeout>;
	max: ReturnType<typeof setTimeout> | null;
	firstScheduledAt: number;
}
```

Put this `interface FileTimer` at the module level, just after the `CaptureSettings` interface.

Change the class field (line 17):

```ts
private pendingTimers: Map<string, FileTimer> = new Map();
```

**Step 2: Update `stop()` to clear both timer types**

Current `stop()` loop (lines 77-80):

```ts
for (const timer of this.pendingTimers.values()) {
	clearTimeout(timer);
}
this.pendingTimers.clear();
```

Replace with:

```ts
for (const { idle, max } of this.pendingTimers.values()) {
	clearTimeout(idle);
	if (max) clearTimeout(max);
}
this.pendingTimers.clear();
```

**Step 3: Update `flush()` to clear both timer types**

Current (lines 100-103):

```ts
for (const timer of this.pendingTimers.values()) {
	clearTimeout(timer);
}
this.pendingTimers.clear();
```

Replace with:

```ts
for (const { idle, max } of this.pendingTimers.values()) {
	clearTimeout(idle);
	if (max) clearTimeout(max);
}
this.pendingTimers.clear();
```

**Step 4: Update `scheduleCapture()` to build the new map value**

Current `scheduleCapture()` (lines 83-97):

```ts
scheduleCapture(fileId: string, path: string, content: string): void {
	this.pendingDb.put({ fileId, path, content, ts: Date.now() }).catch((e) => {
		logWarn("editHistoryCapture: failed to write pending edit to IndexedDB", e);
	});

	const existing = this.pendingTimers.get(fileId);
	if (existing) clearTimeout(existing);

	const timer = setTimeout(() => {
		this.pendingTimers.delete(fileId);
		void this.promoteFromDb(fileId);
	}, this.settings.debounceMs);

	this.pendingTimers.set(fileId, timer);
}
```

Replace with (this is a temporary form that still behaves like pure debounce — maxWait wired in next task):

```ts
scheduleCapture(fileId: string, path: string, content: string): void {
	this.pendingDb.put({ fileId, path, content, ts: Date.now() }).catch((e) => {
		logWarn("editHistoryCapture: failed to write pending edit to IndexedDB", e);
	});

	const existing = this.pendingTimers.get(fileId);
	if (existing) clearTimeout(existing.idle);

	const idle = setTimeout(() => this.fireCapture(fileId), this.settings.debounceMs);

	this.pendingTimers.set(fileId, {
		idle,
		max: existing?.max ?? null,
		firstScheduledAt: existing?.firstScheduledAt ?? Date.now(),
	});
}

private fireCapture(fileId: string): void {
	const timer = this.pendingTimers.get(fileId);
	if (!timer) return;
	clearTimeout(timer.idle);
	if (timer.max) clearTimeout(timer.max);
	this.pendingTimers.delete(fileId);
	void this.promoteFromDb(fileId);
}
```

**Step 5: Run tests to confirm existing behavior still passes**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts`

Expected: all 22 existing tests still pass. (We haven't added maxWait behavior yet, so none of the existing tests' expectations should change.)

**Step 6: Commit**

```bash
git add src/editHistory/editHistoryCapture.ts
git commit -m "refactor: change pendingTimers to FileTimer struct with idle + max slots"
```

---

### Task A3: Write failing test for continuous-edit maxWait firing

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Write the failing test**

Add a new `describe("maxWait")` block near the end of the file, before the final closing `});` of `describe("EditHistoryCapture", ...)`:

```ts
describe("maxWait", () => {
	it("fires at maxWaitMs when edits are continuous", async () => {
		const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, {
			debounceMs: 50,
			maxWaitMs: 80,
		});

		try {
			// Schedule edits every 20ms for 200ms
			const startTs = Date.now();
			fastCapture.scheduleCapture("f1", "a.md", "v0");
			await sleep(20);
			fastCapture.scheduleCapture("f1", "a.md", "v1");
			await sleep(20);
			fastCapture.scheduleCapture("f1", "a.md", "v2");
			await sleep(20);
			fastCapture.scheduleCapture("f1", "a.md", "v3");
			await sleep(20);
			fastCapture.scheduleCapture("f1", "a.md", "v4");
			// At this point t=80ms, max timer should fire

			await sleep(40);
			// Now t=120ms. Max timer would have fired at ~80ms.
			// Idle keeps getting reset so alone would never fire.

			expect(captured.calls).toHaveLength(1);
			expect(captured.calls[0].snap.content).toBe("v4");
		} finally {
			fastCapture.stop();
			await fastDb.clear();
			fastDb.close();
		}
	});
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts -t "fires at maxWaitMs when edits are continuous"`

Expected: FAIL. The current `scheduleCapture` doesn't arm a max timer, so continuous edits reset idle forever and `captured.calls` stays empty.

**Step 3: Do NOT implement yet — next task adds the implementation.**

---

### Task A4: Implement maxWait arming

**Files:**
- Modify: `src/editHistory/editHistoryCapture.ts`

**Step 1: Update `scheduleCapture()` to arm the max timer on first burst edit**

Replace the method body from Task A2 step 4 with this final version:

```ts
scheduleCapture(fileId: string, path: string, content: string): void {
	this.pendingDb.put({ fileId, path, content, ts: Date.now() }).catch((e) => {
		logWarn("editHistoryCapture: failed to write pending edit to IndexedDB", e);
	});

	const existing = this.pendingTimers.get(fileId);

	// Always reset the idle timer
	if (existing) clearTimeout(existing.idle);
	const idle = setTimeout(() => this.fireCapture(fileId), this.settings.debounceMs);

	if (existing) {
		// Mid-burst: keep the existing max timer and firstScheduledAt intact
		this.pendingTimers.set(fileId, {
			idle,
			max: existing.max,
			firstScheduledAt: existing.firstScheduledAt,
		});
	} else {
		// First edit in a new burst: arm the max timer
		const max = setTimeout(() => this.fireCapture(fileId), this.settings.maxWaitMs);
		this.pendingTimers.set(fileId, {
			idle,
			max,
			firstScheduledAt: Date.now(),
		});
	}
}
```

**Step 2: Run the test from Task A3 to verify it passes**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts -t "fires at maxWaitMs when edits are continuous"`

Expected: PASS.

**Step 3: Run the full capture suite to ensure no regressions**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts`

Expected: all tests pass (22 existing + 1 new = 23).

**Step 4: Commit**

```bash
git add src/editHistory/editHistoryCapture.ts src/editHistory/editHistoryCapture.test.ts
git commit -m "feat: arm maxWait timer so continuous edits trigger capture"
```

---

### Task A5: Write + pass test — idle debounce still fires when NOT continuous

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Write the failing test**

Add inside the `describe("maxWait")` block:

```ts
it("fires at debounceMs when idle, not maxWaitMs", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, {
		debounceMs: 30,
		maxWaitMs: 500,
	});

	try {
		fastCapture.scheduleCapture("f1", "a.md", "hello");
		await sleep(100);

		// Idle should have fired at ~30ms. Max is 500ms away.
		expect(captured.calls).toHaveLength(1);
		expect(captured.calls[0].snap.content).toBe("hello");
	} finally {
		fastCapture.stop();
		await fastDb.clear();
		fastDb.close();
	}
});
```

**Step 2: Run the test**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts -t "fires at debounceMs when idle"`

Expected: PASS immediately (behavior already covered by Task A4's implementation).

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test: verify idle debounce path still works after maxWait addition"
```

---

### Task A6: Write + pass test — maxWait does NOT reset on subsequent edits

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Write the test**

Add inside `describe("maxWait")`:

```ts
it("maxWait timer does not reset on subsequent edits in the same burst", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, {
		debounceMs: 50,
		maxWaitMs: 80,
	});

	try {
		// Burst: edits at t=0, t=40, t=70 — all before maxWait (80ms)
		fastCapture.scheduleCapture("f1", "a.md", "v0");
		await sleep(40);
		fastCapture.scheduleCapture("f1", "a.md", "v1");
		await sleep(30);
		fastCapture.scheduleCapture("f1", "a.md", "v2");

		// At t=85, max should have fired. Idle alone would have fired around t=120.
		await sleep(20);
		expect(captured.calls).toHaveLength(1);
		expect(captured.calls[0].snap.content).toBe("v2");
	} finally {
		fastCapture.stop();
		await fastDb.clear();
		fastDb.close();
	}
});
```

**Step 2: Run the test**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts -t "maxWait timer does not reset"`

Expected: PASS (the implementation keeps existing `max` intact when `existing` is present).

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test: verify maxWait timer does not reset mid-burst"
```

---

### Task A7: Write + pass test — new burst after capture gets fresh maxWait

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Write the test**

Add inside `describe("maxWait")`:

```ts
it("new burst after capture gets a fresh maxWait", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, {
		debounceMs: 30,
		maxWaitMs: 100,
	});

	try {
		fastCapture.scheduleCapture("f1", "a.md", "burst1");
		await sleep(50); // idle fires at ~30ms
		expect(captured.calls).toHaveLength(1);

		// Now schedule a new burst
		fastCapture.scheduleCapture("f1", "a.md", "burst2");
		await sleep(50); // idle fires at ~80ms (relative to burst2 start)
		expect(captured.calls).toHaveLength(2);
		expect(captured.calls[1].snap.content).toBe("burst2");
	} finally {
		fastCapture.stop();
		await fastDb.clear();
		fastDb.close();
	}
});
```

**Step 2: Run the test**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts -t "new burst after capture"`

Expected: PASS.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test: verify new burst after capture gets fresh maxWait"
```

---

### Task A8: Write + pass test — whichever timer fires first cancels the other

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Write the test**

Add inside `describe("maxWait")`:

```ts
it("whichever timer fires first cancels the other", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, {
		debounceMs: 20,
		maxWaitMs: 100,
	});

	try {
		fastCapture.scheduleCapture("f1", "a.md", "single-edit");
		// Idle fires at ~20ms
		await sleep(200);
		// By now, if the max timer hadn't been cleared, it would have fired at ~100ms
		// and produced a second capture. Expect only one.
		expect(captured.calls).toHaveLength(1);
	} finally {
		fastCapture.stop();
		await fastDb.clear();
		fastDb.close();
	}
});
```

**Step 2: Run the test**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts -t "whichever timer fires first"`

Expected: PASS (because `fireCapture()` clears both timers and deletes the map entry atomically).

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test: verify idle fires cancels max timer (and vice versa)"
```

---

### Task A9: Write + pass test — flush clears both timer types

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Write the test**

Add inside `describe("maxWait")`:

```ts
it("flush clears both idle and max timers", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, {
		debounceMs: 100,
		maxWaitMs: 150,
	});

	try {
		fastCapture.scheduleCapture("f1", "a.md", "hello");
		await fastCapture.flush();
		// flush() already captured once
		expect(captured.calls).toHaveLength(1);

		// Neither idle (100ms) nor max (150ms) should fire now — both were cleared
		await sleep(200);
		expect(captured.calls).toHaveLength(1);
	} finally {
		fastCapture.stop();
		await fastDb.clear();
		fastDb.close();
	}
});
```

**Step 2: Run the test**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts -t "flush clears both"`

Expected: PASS.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test: verify flush clears both idle and max timers"
```

---

### Task A10: Write + pass test — stop clears both timer types

**Files:**
- Modify: `src/editHistory/editHistoryCapture.test.ts`

**Step 1: Write the test**

Add inside `describe("maxWait")`:

```ts
it("stop clears both idle and max timers", async () => {
	const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, {
		debounceMs: 100,
		maxWaitMs: 150,
	});

	try {
		fastCapture.scheduleCapture("f1", "a.md", "hello");
		fastCapture.stop();

		// Neither idle (100ms) nor max (150ms) should fire
		await sleep(200);
		expect(captured.calls).toHaveLength(0);
	} finally {
		await fastDb.clear();
		fastDb.close();
	}
});
```

**Step 2: Run the test**

Run: `npx vitest run src/editHistory/editHistoryCapture.test.ts -t "stop clears both"`

Expected: PASS.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryCapture.test.ts
git commit -m "test: verify stop clears both idle and max timers"
```

---

### Task A11: Wire maxWaitMs in main.ts + change debounce default

**Files:**
- Modify: `src/main.ts` (around lines 206-216, the `EditHistoryCapture` constructor call)
- Modify: `src/settings.ts`
- Modify: `src/settings.test.ts`

**Step 1: Update main.ts wiring**

In `src/main.ts`, find the `EditHistoryCapture` constructor call:

```ts
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
```

Add `maxWaitMs: 60_000`:

```ts
this.editHistoryCapture = new EditHistoryCapture(
	this.editHistoryStore,
	() => getLocalDeviceName(this.app),
	{
		rebaseInterval: this.settings.editHistoryRebaseInterval,
		maxPerFilePerDay: this.settings.editHistoryMaxPerFilePerDay,
		debounceMs: this.settings.editHistoryDebounceMs,
		maxWaitMs: 60_000,
	},
	1_000_000,
	pendingDb,
);
```

**Step 2: Change the debounce default**

In `src/settings.ts`, change:

```ts
editHistoryDebounceMs: 30000,
```

to:

```ts
editHistoryDebounceMs: 5000,
```

**Step 3: Update the settings test for the new default**

In `src/settings.test.ts`, find the assertion expecting `editHistoryDebounceMs: 30000` and change it to `5000`.

Run: `grep -n "editHistoryDebounceMs" src/settings.test.ts`

Use the matching line(s) to update the expected value.

**Step 4: Run the settings and capture tests**

Run: `npx vitest run src/settings.test.ts src/editHistory/editHistoryCapture.test.ts`

Expected: all tests pass.

**Step 5: Run the full suite and build**

Run: `npx vitest run`

Expected: all tests pass.

Run: `npm run build`

Expected: tsc clean, esbuild clean.

**Step 6: Commit**

```bash
git add src/main.ts src/settings.ts src/settings.test.ts
git commit -m "feat: wire maxWaitMs in main; default debounce 5s (was 30s)"
```

---

## Phase B — View: session grouping

### Task B1: Write failing test — groups consecutive same-device versions within 5 minutes

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Read the existing test file to understand conventions**

Run: `head -80 src/editHistory/editHistoryView.test.ts`

Observe: how `EditHistoryView` is instantiated in tests, how the container/`contentEl` is asserted against.

**Step 2: Write the failing test**

Add a new `describe("session grouping")` block near the end of the existing `describe("EditHistoryView", ...)`:

```ts
describe("session grouping", () => {
	it("groups consecutive same-device versions within 5 minutes into one session", async () => {
		// Three versions, same device, 1 minute apart each
		const t0 = Date.now();
		const entry: FileHistoryEntry = {
			path: "a.md",
			baseIndex: 0,
			versions: [
				{ ts: t0, device: "DeviceA", content: "v0" },
				{ ts: t0 + 60_000, device: "DeviceA", diff: [[1, " foo"]] },
				{ ts: t0 + 120_000, device: "DeviceA", diff: [[1, " bar"]] },
			],
		};
		const store = makeStore({ f1: entry });
		const view = makeView(store);

		await view.refresh("f1");

		const sessionHeaders = view.contentEl.querySelectorAll(".yaos-extension-edit-history-session-header");
		expect(sessionHeaders.length).toBe(1);

		const count = view.contentEl.querySelector(".yaos-extension-edit-history-session-count");
		expect(count?.textContent).toContain("3");
	});
});
```

Note: you may need to adapt `makeStore` and `makeView` to match the existing test helpers. Read the existing test file and reuse its helpers. If the existing tests build `FileHistoryEntry` objects inline, do the same.

**Step 3: Run the test to verify it fails**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "groups consecutive same-device"`

Expected: FAIL. No `.yaos-extension-edit-history-session-header` elements are rendered by the current view.

---

### Task B2: Implement session grouping — data structure + grouping function

**Files:**
- Modify: `src/editHistory/editHistoryView.ts`

**Step 1: Add the `Session` type and grouping function**

In `src/editHistory/editHistoryView.ts`, add after the module-level utility functions (after `getDeviceInitials`, before `export class EditHistoryView`):

```ts
const SESSION_GAP_MS = 5 * 60 * 1000;

interface Session {
	device: string;
	startTs: number;
	endTs: number;
	versions: Array<{ version: VersionSnapshot; originalIndex: number }>;
}

function groupIntoSessions(
	items: Array<{ version: VersionSnapshot; originalIndex: number }>,
): Session[] {
	// items are ordered newest-first
	const sessions: Session[] = [];
	for (const item of items) {
		const last = sessions[sessions.length - 1];
		if (
			last &&
			last.device === item.version.device &&
			last.endTs - item.version.ts <= SESSION_GAP_MS
		) {
			// item is older than last's current oldest; extend the session backward
			last.startTs = item.version.ts;
			last.versions.push(item);
		} else {
			sessions.push({
				device: item.version.device,
				startTs: item.version.ts,
				endTs: item.version.ts,
				versions: [item],
			});
		}
	}
	return sessions;
}

function getSessionId(s: Session): string {
	return `${s.device}-${s.startTs}`;
}
```

**Step 2: Add expanded-sessions state field**

In the class body, add:

```ts
private expandedSessions: Set<string> = new Set();
```

Do NOT clear this in `refresh()` — we want expanded state preserved across external file changes.

**Step 3: Rewrite `renderHistory()` to use sessions**

Replace the existing `renderHistory()` (currently lines 70-93) with:

```ts
private renderHistory(entry: FileHistoryEntry): void {
	const header = this.contentEl.createDiv({ cls: "yaos-extension-edit-history-file-path" });
	header.textContent = entry.path;

	// Newest-first ordering
	const items: Array<{ version: VersionSnapshot; originalIndex: number }> = [];
	for (let i = entry.versions.length - 1; i >= 0; i--) {
		items.push({ version: entry.versions[i]!, originalIndex: i });
	}

	const sessions = groupIntoSessions(items);

	// Group sessions by calendar date using the NEWEST version's timestamp (endTs)
	const dateGroups = new Map<string, Session[]>();
	for (const s of sessions) {
		const dateKey = formatDate(s.endTs);
		if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, []);
		dateGroups.get(dateKey)!.push(s);
	}

	for (const [dateKey, sessionsForDate] of dateGroups) {
		const groupEl = this.contentEl.createDiv({ cls: "yaos-extension-edit-history-date-group" });
		groupEl.createDiv({ cls: "yaos-extension-edit-history-date-header", text: dateKey });

		for (const session of sessionsForDate) {
			if (session.versions.length === 1) {
				// Single-version session → render as a regular entry (no session chrome)
				const item = session.versions[0]!;
				this.renderEntry(groupEl, entry, item.version, item.originalIndex);
			} else {
				this.renderSession(groupEl, entry, session);
			}
		}
	}
}
```

**Step 4: Add `renderSession()` method**

Add to the class, right after `renderHistory`:

```ts
private renderSession(parent: HTMLElement, entry: FileHistoryEntry, session: Session): void {
	const sessionId = getSessionId(session);
	const sessionEl = parent.createDiv({ cls: "yaos-extension-edit-history-session" });

	const header = sessionEl.createDiv({ cls: "yaos-extension-edit-history-session-header" });

	const avatar = header.createDiv({ cls: "yaos-extension-edit-history-avatar" });
	avatar.textContent = getDeviceInitials(session.device);

	const deviceEl = header.createSpan({ cls: "yaos-extension-edit-history-device" });
	deviceEl.textContent = session.device;

	const timeEl = header.createSpan({ cls: "yaos-extension-edit-history-time" });
	if (session.startTs === session.endTs) {
		timeEl.textContent = formatTime(session.startTs);
	} else {
		timeEl.textContent = `${formatTime(session.startTs)} – ${formatTime(session.endTs)}`;
	}

	const countEl = header.createSpan({ cls: "yaos-extension-edit-history-session-count" });
	countEl.textContent = `${session.versions.length} edits`;

	// Aggregate diff summary
	let addedTotal = 0;
	let removedTotal = 0;
	for (const { version } of session.versions) {
		if (version.diff) {
			const sum = computeDiffSummary(version.diff);
			addedTotal += sum.added;
			removedTotal += sum.removed;
		}
	}
	if (addedTotal > 0 || removedTotal > 0) {
		const summaryEl = header.createSpan({ cls: "yaos-extension-edit-history-summary" });
		const parts: string[] = [];
		if (addedTotal > 0) parts.push(`+${addedTotal}`);
		if (removedTotal > 0) parts.push(`-${removedTotal}`);
		summaryEl.textContent = parts.join(" ") + " lines";
	}

	const chevron = header.createSpan({ cls: "yaos-extension-edit-history-session-chevron" });
	chevron.textContent = "▸";

	const childrenEl = sessionEl.createDiv({ cls: "yaos-extension-edit-history-session-children" });
	const expanded = this.expandedSessions.has(sessionId);
	if (!expanded) {
		childrenEl.style.display = "none";
	} else {
		chevron.textContent = "▾";
	}

	for (const { version, originalIndex } of session.versions) {
		this.renderEntry(childrenEl, entry, version, originalIndex);
	}

	header.addEventListener("click", () => {
		if (this.expandedSessions.has(sessionId)) {
			this.expandedSessions.delete(sessionId);
			childrenEl.style.display = "none";
			chevron.textContent = "▸";
		} else {
			this.expandedSessions.add(sessionId);
			childrenEl.style.display = "";
			chevron.textContent = "▾";
		}
	});
}
```

**Step 5: Run the Task B1 test to verify it passes**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "groups consecutive same-device"`

Expected: PASS.

**Step 6: Run the full view test suite to catch regressions**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts`

Expected: all existing tests pass + new test passes.

If existing tests fail because they expected direct `renderEntry` output that's now under a session header: those tests are single-version entries, which still render via `renderEntry()` directly (see step 3 logic). They should still pass. If any fail, read the failure and adapt.

**Step 7: Commit**

```bash
git add src/editHistory/editHistoryView.ts src/editHistory/editHistoryView.test.ts
git commit -m "feat: group consecutive same-device edits into collapsible sessions"
```

---

### Task B3: Test — different devices are not grouped

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

Add inside `describe("session grouping")`:

```ts
it("does not group versions from different devices", async () => {
	const t0 = Date.now();
	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DeviceA", content: "v0" },
			{ ts: t0 + 30_000, device: "DeviceB", diff: [[1, " b"]] },
			{ ts: t0 + 60_000, device: "DeviceA", diff: [[1, " a"]] },
		],
	};
	const store = makeStore({ f1: entry });
	const view = makeView(store);

	await view.refresh("f1");

	// Three separate entries, no session headers
	const sessionHeaders = view.contentEl.querySelectorAll(".yaos-extension-edit-history-session-header");
	expect(sessionHeaders.length).toBe(0);

	const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-entry");
	expect(entries.length).toBe(3);
});
```

**Step 2: Run + pass**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "does not group versions from different devices"`

Expected: PASS.

**Step 3: Commit**

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify different devices are not grouped into sessions"
```

---

### Task B4: Test — versions >5 minutes apart are not grouped

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

```ts
it("does not group versions more than 5 minutes apart", async () => {
	const t0 = Date.now();
	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DeviceA", content: "v0" },
			{ ts: t0 + 10 * 60_000, device: "DeviceA", diff: [[1, " a"]] }, // 10 min later
		],
	};
	const store = makeStore({ f1: entry });
	const view = makeView(store);

	await view.refresh("f1");

	const sessionHeaders = view.contentEl.querySelectorAll(".yaos-extension-edit-history-session-header");
	expect(sessionHeaders.length).toBe(0);

	const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-entry");
	expect(entries.length).toBe(2);
});
```

**Step 2: Run + pass + commit**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "does not group versions more than 5 minutes"`

Expected: PASS.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify versions >5 min apart are not grouped"
```

---

### Task B5: Test — session header shows correct time range

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

```ts
it("session header shows correct time range", async () => {
	const t0 = new Date(2026, 3, 18, 10, 0, 0).getTime(); // 10:00 AM local
	const t1 = new Date(2026, 3, 18, 10, 3, 0).getTime(); // 10:03 AM local
	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DeviceA", content: "v0" },
			{ ts: t1, device: "DeviceA", diff: [[1, " a"]] },
		],
	};
	const store = makeStore({ f1: entry });
	const view = makeView(store);

	await view.refresh("f1");

	const timeEl = view.contentEl.querySelector(
		".yaos-extension-edit-history-session-header .yaos-extension-edit-history-time",
	);
	expect(timeEl).not.toBeNull();
	// Should contain an en-dash or hyphen between two times
	expect(timeEl!.textContent).toMatch(/10:00.*[–-].*10:03/);
});
```

**Step 2: Run + pass + commit**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "session header shows correct time range"`

Expected: PASS.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify session header time range formatting"
```

---

### Task B6: Test — clicking session header expands children

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

```ts
it("clicking session header expands to show child versions", async () => {
	const t0 = Date.now();
	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DeviceA", content: "v0" },
			{ ts: t0 + 60_000, device: "DeviceA", diff: [[1, " a"]] },
			{ ts: t0 + 120_000, device: "DeviceA", diff: [[1, " b"]] },
		],
	};
	const store = makeStore({ f1: entry });
	const view = makeView(store);

	await view.refresh("f1");

	const header = view.contentEl.querySelector(
		".yaos-extension-edit-history-session-header",
	) as HTMLElement;
	expect(header).not.toBeNull();

	const childrenContainer = view.contentEl.querySelector(
		".yaos-extension-edit-history-session-children",
	) as HTMLElement;
	expect(childrenContainer.style.display).toBe("none");

	header.click();

	expect(childrenContainer.style.display).toBe("");

	// Children should be present (they were rendered but hidden)
	const childEntries = childrenContainer.querySelectorAll(".yaos-extension-edit-history-entry");
	expect(childEntries.length).toBe(3);
});
```

**Step 2: Run + pass + commit**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "clicking session header expands"`

Expected: PASS.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify clicking session header expands children"
```

---

### Task B7: Test — clicking expanded header collapses

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

```ts
it("clicking expanded session header collapses again", async () => {
	const t0 = Date.now();
	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DeviceA", content: "v0" },
			{ ts: t0 + 60_000, device: "DeviceA", diff: [[1, " a"]] },
		],
	};
	const store = makeStore({ f1: entry });
	const view = makeView(store);

	await view.refresh("f1");

	const header = view.contentEl.querySelector(
		".yaos-extension-edit-history-session-header",
	) as HTMLElement;
	const childrenContainer = view.contentEl.querySelector(
		".yaos-extension-edit-history-session-children",
	) as HTMLElement;

	header.click(); // expand
	expect(childrenContainer.style.display).toBe("");

	header.click(); // collapse
	expect(childrenContainer.style.display).toBe("none");
});
```

**Step 2: Run + pass + commit**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "clicking expanded session header collapses"`

Expected: PASS.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify clicking expanded session header collapses"
```

---

### Task B8: Test — Restore button on child entry works

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

```ts
it("restore button on child entry calls onRestore with correct content", async () => {
	const t0 = Date.now();
	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DeviceA", content: "v0" },
			{ ts: t0 + 60_000, device: "DeviceA", diff: [[0, "v0"], [1, " edit"]] },
		],
	};
	const store = makeStore({ f1: entry });
	const restoreCalls: string[] = [];
	const view = makeView(store, (content) => restoreCalls.push(content));

	await view.refresh("f1");

	const header = view.contentEl.querySelector(
		".yaos-extension-edit-history-session-header",
	) as HTMLElement;
	header.click(); // expand

	const restoreButtons = view.contentEl.querySelectorAll(
		".yaos-extension-edit-history-session-children .yaos-extension-edit-history-restore",
	);
	expect(restoreButtons.length).toBe(2);

	(restoreButtons[0] as HTMLElement).click(); // Restore newest (version index 1)
	expect(restoreCalls.length).toBe(1);
	expect(restoreCalls[0]).toBe("v0 edit");
});
```

Note: adjust the `makeView` helper signature if needed to accept a custom `onRestore` callback (check the existing test file for the current helper API).

**Step 2: Run + pass + commit**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "restore button on child entry"`

Expected: PASS.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify restore button on child entry restores correct version"
```

---

### Task B9: Test — single-version sessions render without session chrome

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

```ts
it("single-version sessions render with no expand affordance", async () => {
	const t0 = Date.now();
	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [{ ts: t0, device: "DeviceA", content: "v0" }],
	};
	const store = makeStore({ f1: entry });
	const view = makeView(store);

	await view.refresh("f1");

	const sessionHeaders = view.contentEl.querySelectorAll(".yaos-extension-edit-history-session-header");
	expect(sessionHeaders.length).toBe(0);

	const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-entry");
	expect(entries.length).toBe(1);
});
```

**Step 2: Run + pass + commit**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "single-version sessions"`

Expected: PASS.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify single-version sessions render without session chrome"
```

---

### Task B10: Test — session aggregate diff summary sums children

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

```ts
it("session aggregate diff summary sums children", async () => {
	const t0 = Date.now();
	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DeviceA", content: "v0" },
			// diffs below are artificial but what matters is computeDiffSummary output
			{ ts: t0 + 60_000, device: "DeviceA", diff: [[1, "aaaaa"], [-1, "bb"]] }, // +5 -2
			{ ts: t0 + 120_000, device: "DeviceA", diff: [[1, "ccc"]] }, // +3
		],
	};
	const store = makeStore({ f1: entry });
	const view = makeView(store);

	await view.refresh("f1");

	const summary = view.contentEl.querySelector(
		".yaos-extension-edit-history-session-header .yaos-extension-edit-history-summary",
	);
	expect(summary).not.toBeNull();
	// +8 total added (5+3), -2 total removed
	expect(summary!.textContent).toContain("+8");
	expect(summary!.textContent).toContain("-2");
});
```

Note: verify the `computeDiffSummary` input format matches what's used in the codebase. Read `src/editHistory/editHistoryDiff.ts` to confirm. If the test's diff tuples don't produce the expected summary, adjust them based on how `computeDiffSummary` actually counts.

**Step 2: Run + pass + commit**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "session aggregate diff summary"`

Expected: PASS. If FAIL due to tuple format mismatch, read `computeDiffSummary` in `editHistoryDiff.ts` and correct the test inputs.

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify session aggregate diff summary sums children"
```

---

### Task B11: Test — midnight-spanning session uses newest version's date

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Write the test**

```ts
it("midnight-spanning session is placed under newest version's date", async () => {
	// 11:58 PM yesterday → 12:03 AM today
	const today = new Date();
	today.setHours(0, 3, 0, 0);
	const t1 = today.getTime();
	const t0 = t1 - 5 * 60_000; // 11:58 PM yesterday

	const entry: FileHistoryEntry = {
		path: "a.md",
		baseIndex: 0,
		versions: [
			{ ts: t0, device: "DeviceA", content: "v0" },
			{ ts: t1, device: "DeviceA", diff: [[1, " a"]] },
		],
	};
	const store = makeStore({ f1: entry });
	const view = makeView(store);

	await view.refresh("f1");

	// Should be exactly one date group
	const dateGroups = view.contentEl.querySelectorAll(".yaos-extension-edit-history-date-group");
	expect(dateGroups.length).toBe(1);

	// And one session inside it
	const sessionHeaders = view.contentEl.querySelectorAll(".yaos-extension-edit-history-session-header");
	expect(sessionHeaders.length).toBe(1);

	// Date header should match today's date
	const todayLabel = new Date(t1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
	const dateHeader = view.contentEl.querySelector(".yaos-extension-edit-history-date-header");
	expect(dateHeader?.textContent).toBe(todayLabel);
});
```

**Step 2: Run + pass + commit**

Run: `npx vitest run src/editHistory/editHistoryView.test.ts -t "midnight-spanning"`

Expected: PASS. (Our `renderHistory()` implementation uses `formatDate(s.endTs)` which is the newest version's timestamp.)

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: verify midnight-spanning session uses newest version's date"
```

---

### Task B12: Add CSS for session UI

**Files:**
- Modify: `src/styles.css`
- Modify: `styles.css` (the vault-root copy, if this project mirrors it; confirm by `ls styles.css`)

**Step 1: Identify both CSS files**

Run: `ls -la src/styles.css styles.css`

If both exist, both must be updated. (This project currently ships both — the root one is the release artifact; `src/styles.css` is the source copy.)

**Step 2: Add CSS rules**

Append to `src/styles.css` (and mirror in `styles.css`):

```css
/* Edit history — session grouping */

.yaos-extension-edit-history-session {
	margin: 4px 0;
}

.yaos-extension-edit-history-session-header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border-radius: 4px;
	cursor: pointer;
	user-select: none;
}

.yaos-extension-edit-history-session-header:hover {
	background: var(--background-modifier-hover);
}

.yaos-extension-edit-history-session-count {
	font-size: 0.85em;
	color: var(--text-muted);
	background: var(--background-secondary);
	padding: 1px 6px;
	border-radius: 10px;
}

.yaos-extension-edit-history-session-chevron {
	margin-left: auto;
	color: var(--text-muted);
	font-size: 0.9em;
	transition: transform 0.1s ease;
}

.yaos-extension-edit-history-session-children {
	margin-left: 16px;
	border-left: 2px solid var(--background-modifier-border);
	padding-left: 8px;
}
```

**Step 3: Verify CSS is valid**

No automated CSS lint in this project. Manually scan for typos.

**Step 4: Build**

Run: `npm run build`

Expected: clean build.

**Step 5: Commit**

```bash
git add src/styles.css styles.css
git commit -m "feat: add CSS for edit history session grouping"
```

---

## Phase C — Verification & final wrap

### Task C1: Run full test suite + build

**Step 1: Full tests**

Run: `npx vitest run`

Expected: ~392 existing + 7 maxWait + 10 session = ~409 tests passing.

**Step 2: Build**

Run: `npm run build`

Expected: clean tsc + esbuild output.

**Step 3: Manual smoke test in the vault**

1. Reload Obsidian (or disable + re-enable the plugin)
2. Open a file, type a few characters, pause 5 seconds → verify a new entry appears in the `.yaos-extension/edit-history.json` and in the sidebar
3. Type continuously for ~70 seconds → verify a snapshot is captured around the 60-second mark even without pausing
4. Trigger several rapid edits (<5 min apart) → verify sidebar shows a collapsed session row with a count; click to expand and see individual versions with Restore buttons
5. Verify an isolated edit (>5 min from neighbors) renders as a flat entry, not a session header

**Step 4: If anything fails, file a follow-up task and stop.**

---

### Task C2: Update AGENTS.md module documentation

**Files:**
- Modify: `src/AGENTS.md`

**Step 1: Add a brief blurb about sessions**

Find the section describing the edit history modules (search for `editHistory` headings). Append under `editHistoryView.ts`:

```
The view collapses consecutive same-device versions within 5 minutes into
expandable sessions. Session state (expanded/collapsed) persists across
refresh() calls via the view's `expandedSessions: Set<string>` field,
keyed by `${device}-${startTs}`. Midnight-spanning sessions are filed
under the newest version's date.
```

And under `editHistoryCapture.ts`, update the description to reflect debounce + maxWait:

```
Uses a two-timer pattern per file: an idle timer (resets on every edit,
default 5s) and a maxWait timer (set once per burst, default 60s). The
first timer to fire triggers the capture and cancels the other. This
ensures continuous editing still produces snapshots instead of being
starved by the idle debounce.
```

Adjust phrasing to match the existing AGENTS.md style (read surrounding sections first).

**Step 2: Commit**

```bash
git add src/AGENTS.md
git commit -m "docs: update AGENTS.md for debounce+maxWait and session grouping"
```

---

## Definition of done

- All tasks committed
- `npx vitest run` reports all tests passing (~409 total)
- `npm run build` is clean
- Manual smoke test passes: continuous edit captures at ~60s; idle edit captures at ~5s; sessions collapse/expand in sidebar; single-version entries unchanged
- `src/AGENTS.md` updated

---

## Notes for the executing engineer

- **TDD is mandatory.** Every production change in Phase A and B must be preceded by a failing test. If a "write the test" step says "Expected: PASS immediately", that's because the preceding task already delivered the production code — still run the test to confirm.
- **No sub-agents.** This project's convention is direct work, not delegating.
- **Don't refactor unrelated code.** If you spot an issue outside the scope of these tasks, note it for a follow-up, don't fix it inline.
- **Commit after every task.** Per the project convention of frequent commits.
- **Read before you write.** Always read the existing file before editing to confirm line numbers and surrounding context haven't drifted.

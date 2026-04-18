# Edit History View Refresh Race — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the duplicated render in `EditHistoryView` (and defensively in `CommentView`/`NotificationView`) that appears when the user switches documents and comes back, caused by concurrent `refresh()` calls overlapping across an `await`.

**Architecture:** Adopt the same `renderGeneration` counter pattern that `CommentRenderer` already uses. Increment a monotonic counter at the start of every `refresh()`; after the awaited store read, bail out if a newer refresh has started. Critically, move `contentEl.empty()` to *after* the await so stale refreshes never wipe DOM the winning refresh has painted. Apply the same pattern to `CommentView` and `NotificationView` since they have the same shape.

**Tech Stack:** TypeScript (strict), vitest + jsdom, Obsidian `ItemView`.

---

## Background

### Bug symptom

> When you switch document and return back, the edit history list is duplicated. When you focus on the edit history panel, it re-renders and the duplicate is gone.

### Root cause

`EditHistoryView.refresh()` at `src/editHistory/editHistoryView.ts:89-104`:

```ts
async refresh(fileId: string | null): Promise<void> {
    this.contentEl.empty();                           // (1) sync wipe
    if (!fileId) { this.renderEmpty(...); return; }
    const entry = await this.store.getEntry(fileId);  // (2) yields
    if (!entry || entry.versions.length === 0) { ... return; }
    this.renderHistory(entry);                         // (3) append
}
```

Two concurrent callers interleave:

```
A: contentEl.empty()
A: await store.getEntry(id)       ← yield
B: contentEl.empty()               ← DOM is empty, no-op on B
B: await store.getEntry(id)       ← yield
A: renderHistory(entry)            ← append tree #1
B: renderHistory(entry)            ← append tree #2  ← DUPLICATE
```

### Why two refreshes overlap on "switch-away-and-back"

Both listeners in `src/main.ts` funnel into `refreshEditHistoryView()`:
- `workspace.on("active-leaf-change")` at `main.ts:192`
- `vault.on("modify")` for `edit-history.json` at `main.ts:198`

On document switching, `active-leaf-change` fires for the leave *and* the return.
If `editHistoryCapture` writes a snapshot during the gap (very common: idle
debounce fires ~5s after last edit), `vault.on("modify")` fires a third refresh.
Any two of these produce the duplicate.

Focusing the panel later fires yet another `active-leaf-change`; by then all
prior awaits have resolved and the single late refresh wipes + re-renders
cleanly, so the duplicate "disappears."

### Why the same bug may exist in two sibling views

- `CommentView.refresh()` at `src/comments/commentView.ts:55-57` delegates to
  `CommentRenderer.refresh()`, which *does* use `renderGeneration` internally
  (`src/comments/commentRenderer.ts:81-86, 110`). The await happens in
  `CommentRenderer.refresh()` before `renderAll` calls `container.empty()` +
  append. The inner guard bumps the generation only inside `renderAll`
  (line 110), AFTER the await. This means the race we just saw could still
  occur at the `CommentRenderer` level: two overlapping `refresh()` calls both
  await `getThreadsForFile`, both resolve and then both enter `renderAll`,
  which each bump generation and render. The second render's `container.empty()`
  would wipe the first, so visually no duplicate — but we should verify and
  align the pattern either way.
- `NotificationView.refresh()` at `src/notifications/notificationView.ts:45-49`
  is the same shape as `EditHistoryView`: `await` then `render()` which does
  `empty()` + append. Potential duplicate is theoretically possible if two
  refreshes race; callers in `main.ts` fire on notifications.jsonl modify +
  user actions, so the overlap window is small but real.

### Why NOT just debounce in main.ts

- Adds latency to legitimate modify events.
- Pushes the bug one level up — future programmatic refresh callers would
  reintroduce it.
- Inconsistent with existing `CommentRenderer` self-guard pattern.

### Listener fan-in investigation (Task 0)

For the commit body, we'll document whether the two edit-history listeners
can be deduplicated. Investigation only — no removal in this commit because
the race fix is sufficient for the observed bug.

---

## Ground rules

- Strict TDD. Every production change preceded by a failing test.
- Commit after each numbered task (frequent commits per project convention).
- Siblings never import each other — per `src/AGENTS.md`.
- No `main.ts` changes required by the fix. If Task 0 uncovers redundant
  listeners, leave removal for a follow-up commit (keep this PR scoped).
- Use `npx vitest run` (not `npm test`) to match the existing verification
  flow from the previous plan.

---

## Task 0: Listener fan-in investigation (read-only)

**Files:** read-only.
- `src/main.ts:127-203` (comment + edit-history + notifications listeners)
- `src/editHistory/editHistoryCapture.ts` (how/when it writes to the JSON store)
- `src/editHistory/editHistoryStore.ts` (confirm single-write path)

**Step 1: Read call sites**

```bash
# From repo root:
grep -n "refreshEditHistoryView\|refreshCommentView\|refreshNotifications" src/main.ts
```

Expected: `refreshEditHistoryView` is called from:
- the "open-edit-history" command flow (`openEditHistoryView`)
- `active-leaf-change` handler
- `vault.on("modify")` for `edit-history.json`

**Step 2: Analyze overlap conditions**

In a short scratch note, answer:
1. Does `editHistoryCapture` promote-to-disk happen synchronously with
   `active-leaf-change`, or asynchronously on a timer? (Answer: idle/max
   debounce timer → asynchronous. Confirms both listeners *can* and *do* fire
   within a single user-perceptible window.)
2. Can we safely drop the `modify` listener and rely only on
   `active-leaf-change`? (Answer: **no** — if a file is modified from another
   device via CRDT sync while we're already focused on that file, there's no
   leaf change; we'd miss the new version without the modify listener.)

**Step 3: Record findings for commit body**

Keep a short note (2-3 sentences) to include in the commit message. Example:

> Both `active-leaf-change` and `vault.on("modify")` listeners are needed:
> the former covers user-initiated switches; the latter covers new versions
> arriving via CRDT sync while already viewing the file. Fix targets the
> race directly rather than removing a listener.

**Step 4: No commit yet** — investigation only; commit happens after Task 1+2.

---

## Task 1: Write failing tests for `EditHistoryView` race

**Files:**
- Modify: `src/editHistory/editHistoryView.test.ts`

**Step 1: Append a new `describe("refresh race")` block**

Add this block at the end of the top-level `describe("EditHistoryView", ...)`
(inside the outer describe, after the existing `describe("session grouping")`
block, but before the final closing brace of the outer describe).

```ts
	describe("refresh race", () => {
		// A deferred promise helper — gives us manual control of when
		// `store.getEntry()` resolves, so we can drive the interleaving
		// that causes the bug deterministically.
		type Deferred<T> = {
			promise: Promise<T>;
			resolve: (v: T) => void;
		};
		function makeDeferred<T>(): Deferred<T> {
			let resolve!: (v: T) => void;
			const promise = new Promise<T>((r) => {
				resolve = r;
			});
			return { promise, resolve };
		}

		it("concurrent refresh calls with same fileId render only one tree", async () => {
			const entry: FileHistoryEntry = {
				path: "notes/a.md",
				baseIndex: 0,
				versions: [
					{ ts: 1000, device: "DeviceA", content: "v0" },
					{ ts: 2000, device: "DeviceA", diff: [[0, "v0"], [1, "v1"]] },
				],
			};

			const d1 = makeDeferred<FileHistoryEntry | undefined>();
			const d2 = makeDeferred<FileHistoryEntry | undefined>();
			const queue = [d1, d2];
			let callIndex = 0;
			const store = {
				getEntry: vi.fn(async () => queue[callIndex++]!.promise),
			} as unknown as EditHistoryStore;

			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();

			// Fire two overlapping refreshes before any resolves.
			const p1 = view.refresh("file-id");
			const p2 = view.refresh("file-id");

			// Resolve the SECOND call first, then the first — forces the
			// stale (first) refresh to resume AFTER the winning render.
			d2.resolve(entry);
			d1.resolve(entry);
			await Promise.all([p1, p2]);

			const headers = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-file-path",
			);
			expect(headers.length).toBe(1);

			const entries = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-entry",
			);
			expect(entries.length).toBe(entry.versions.length);
		});

		it("late-resolving refresh does not clobber a newer null refresh", async () => {
			// Scenario: refresh(fileId) starts, awaits store.getEntry (slow),
			// then refresh(null) is called (e.g. user navigated to a non-markdown
			// leaf). The null call must win.
			const d = makeDeferred<FileHistoryEntry | undefined>();
			const store = {
				getEntry: vi.fn(async () => d.promise),
			} as unknown as EditHistoryStore;
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();

			const p1 = view.refresh("file-id");
			const p2 = view.refresh(null);

			// Resolve the stale fetch AFTER the null call has rendered.
			d.resolve({
				path: "stale.md",
				baseIndex: 0,
				versions: [{ ts: 1, device: "x", content: "x" }],
			});
			await Promise.all([p1, p2]);

			expect(
				view.contentEl.querySelectorAll(".yaos-extension-edit-history-file-path").length,
			).toBe(0);
			const empties = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-empty",
			);
			expect(empties.length).toBe(1);
			expect(empties[0]!.textContent).toBe("No file selected");
		});
	});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/editHistory/editHistoryView.test.ts
```

Expected: **2 failures** in the "refresh race" block.
- First test fails: `expected 1 to be 2` for headers (currently renders duplicate).
- Second test fails: stale `file-path` header remains because the late refresh
  wiped + appended after the null refresh.

**Step 3: Commit the failing tests**

```bash
git add src/editHistory/editHistoryView.test.ts
git commit -m "test: reproduce editHistoryView concurrent refresh race"
```

---

## Task 2: Fix `EditHistoryView.refresh()` with generation guard

**Files:**
- Modify: `src/editHistory/editHistoryView.ts:62-104`

**Step 1: Add `refreshGeneration` field + reorder `refresh()` body**

Replace the class field block (around line 65) and the `refresh` method
(around lines 89-104) with:

```ts
	private expandedSessions: Set<string> = new Set();
	private refreshGeneration = 0;

	// ... (keep constructor/getViewType/getDisplayText/getIcon/onOpen/onClose
	//      exactly as they are)

	async refresh(fileId: string | null): Promise<void> {
		const gen = ++this.refreshGeneration;

		if (!fileId) {
			if (gen !== this.refreshGeneration) return;
			this.contentEl.empty();
			this.renderEmpty("No file selected");
			return;
		}

		const entry = await this.store.getEntry(fileId);
		if (gen !== this.refreshGeneration) return;

		this.contentEl.empty();
		if (!entry || entry.versions.length === 0) {
			this.renderEmpty("No edit history for this file");
			return;
		}

		this.renderHistory(entry);
	}
```

Key changes from the current code:
1. New `refreshGeneration` field.
2. Bump counter as the *first* line of `refresh()`.
3. For the null-fileId path, the generation check is a no-op today (there's
   no await before it) but we include it so future edits stay consistent.
4. The `entry` await is the real race site — stale refreshes return here
   without calling `empty()`, preserving the winning render.
5. `this.contentEl.empty()` is now called *after* the guard passes, never
   before.

**Step 2: Run the race tests — expect pass**

```bash
npx vitest run src/editHistory/editHistoryView.test.ts
```

Expected: **all tests pass** (12 existing + 10 session + 2 new race = 24 passing).

**Step 3: Run the full suite**

```bash
npx vitest run
```

Expected: **411 passing** (was 409, +2 new).

**Step 4: Commit**

```bash
git add src/editHistory/editHistoryView.ts
git commit -m "fix(editHistory): guard view refresh against concurrent calls

Switching documents away and back rendered the history list twice because
two overlapping refresh() calls both passed their sync contentEl.empty()
and then both appended after their awaited store.getEntry() resolved.
Focusing the panel fired another refresh that happened to win the race
and 'fixed' the duplicate visually.

Adopts the same refreshGeneration pattern CommentRenderer already uses:
stale refreshes no-op without touching the DOM."
```

---

## Task 3: Write failing test for `NotificationView` race

**Files:**
- Modify: `src/notifications/notificationView.test.ts`

`NotificationView.refresh()` at `src/notifications/notificationView.ts:45-49`
has the same shape (`await store.getNotificationsForDevice` then `render()`
which does `empty()` + append). Add a race test mirroring Task 1.

**Step 1: Add `describe("refresh race")` block at the end of the outer describe**

```ts
  describe("refresh race", () => {
    type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
    function makeDeferred<T>(): Deferred<T> {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => { resolve = r; });
      return { promise, resolve };
    }

    it("concurrent refresh calls render only one set of cards", async () => {
      const notifs = [
        makeNotification({ id: "n1" }),
        makeNotification({ id: "n2" }),
      ];
      const d1 = makeDeferred<Notification[]>();
      const d2 = makeDeferred<Notification[]>();
      const queue = [d1, d2];
      let callIndex = 0;
      const store = {
        getNotificationsForDevice: vi.fn(async () => queue[callIndex++]!.promise),
        getUnreadCount: vi.fn(async () => 0),
        markAsRead: vi.fn(async () => {}),
        markAllAsRead: vi.fn(async () => {}),
        isRead: vi.fn(() => false),
      } as unknown as NotificationStore;

      const view = new NotificationView({} as any, store, "Alice", vi.fn());
      await view.onOpen();

      const p1 = view.refresh();
      const p2 = view.refresh();

      // Resolve second first, then first, to force stale-after-winner order.
      d2.resolve(notifs);
      d1.resolve(notifs);
      await Promise.all([p1, p2]);

      const cards = view.contentEl.querySelectorAll(
        ".yaos-extension-notification-card",
      );
      expect(cards.length).toBe(notifs.length);
    });
  });
```

**Step 2: Run and verify failure**

```bash
npx vitest run src/notifications/notificationView.test.ts
```

Expected: race test fails with `expected 4 to be 2` (duplicated cards).

**Step 3: Commit**

```bash
git add src/notifications/notificationView.test.ts
git commit -m "test: reproduce notificationView concurrent refresh race"
```

---

## Task 4: Fix `NotificationView.refresh()` with generation guard

**Files:**
- Modify: `src/notifications/notificationView.ts:7-49`

**Step 1: Add field and guard**

Replace:

```ts
  private notifications: Notification[] = [];
```

with:

```ts
  private notifications: Notification[] = [];
  private refreshGeneration = 0;
```

Replace `refresh()` (lines 45-49):

```ts
  async refresh(): Promise<void> {
    const gen = ++this.refreshGeneration;
    const next = await this.store.getNotificationsForDevice(this.deviceName);
    if (gen !== this.refreshGeneration) return;
    next.sort((a, b) => b.createdAt - a.createdAt);
    this.notifications = next;
    await this.render();
  }
```

**Rationale:**
- Mutates `this.notifications` only on the winning path. (Previously a stale
  refresh would overwrite `this.notifications` and then `render()` would paint
  stale data — also a bug, same root cause.)
- `render()` already does `empty()` + append inside itself, so there's no need
  to reorder it.

**Step 2: Run and verify pass**

```bash
npx vitest run src/notifications/notificationView.test.ts
```

Expected: all tests pass.

**Step 3: Full suite**

```bash
npx vitest run
```

Expected: **412 passing** (+1 from Task 3).

**Step 4: Commit**

```bash
git add src/notifications/notificationView.ts
git commit -m "fix(notifications): guard view refresh against concurrent calls

Same race as editHistoryView — overlapping refresh() calls awaited
store.getNotificationsForDevice then both re-rendered, duplicating cards.
Apply the refreshGeneration pattern to drop stale refreshes."
```

---

## Task 5: Write failing test for `CommentView` race

**Files:**
- Modify: `src/comments/commentView.test.ts`

`CommentView.refresh()` delegates to `CommentRenderer.refresh()`, which
already has `renderGeneration` BUT the counter is only bumped in `renderAll`
*after* the await. Two overlapping refreshes resolve in an order where both
end up calling `renderAll`; the second's `empty()` does clean up the first's
DOM, but the internal `this.threads` field is briefly populated with stale
data between the two awaits. More importantly we want a consistent pattern
across all three views.

Write the test at the `CommentView` layer to document the expected behavior
regardless of whether the inner `CommentRenderer` guard is sufficient.

**Step 1: Add `describe("refresh race")` block at the end of the outer describe in `commentView.test.ts`**

```ts
  describe("refresh race", () => {
    type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
    function makeDeferred<T>(): Deferred<T> {
      let resolve!: (v: T) => void;
      const promise = new Promise<T>((r) => { resolve = r; });
      return { promise, resolve };
    }

    it("concurrent refresh calls render only one thread list", async () => {
      const thread: CommentThread = {
        comment: makeComment(),
        replies: [makeReply()],
      };

      const d1 = makeDeferred<CommentThread[]>();
      const d2 = makeDeferred<CommentThread[]>();
      const queue = [d1, d2];
      let callIndex = 0;
      const store = {
        getThreadsForFile: vi.fn(async () => queue[callIndex++]!.promise),
      } as unknown as CommentStore;

      const app = {
        workspace: { getLeavesOfType: vi.fn(() => []), openLinkText: vi.fn() },
        vault: { adapter: { exists: vi.fn(), read: vi.fn() } },
      } as any;

      const view = new CommentView({} as any, store, app);
      await view.onOpen();

      const p1 = view.refresh("notes/test.md");
      const p2 = view.refresh("notes/test.md");

      d2.resolve([thread]);
      d1.resolve([thread]);
      await Promise.all([p1, p2]);

      // Count visible thread cards. Use a broadly-matching selector from the
      // rendered thread structure — pick whatever class CommentRenderer uses
      // for a thread wrapper. A quick `rg` for ".yaos-extension-comment-thread"
      // in commentRenderer.ts will confirm the class name.
      const threads = view.contentEl.querySelectorAll(
        ".yaos-extension-comment-thread",
      );
      expect(threads.length).toBe(1);
    });
  });
```

**Note to implementer:** before running, confirm the exact thread wrapper
class by grepping `commentRenderer.ts`:

```bash
grep -n 'yaos-extension-comment-thread\|createDiv.*thread' src/comments/commentRenderer.ts
```

Use whatever class actually wraps a single thread card. If no obvious single
class matches, fall back to counting thread-card root divs.

**Step 2: Run and observe**

```bash
npx vitest run src/comments/commentView.test.ts
```

Two possible outcomes:
- **(a)** Test fails → duplicate rendered → proceed to Task 6 (fix it).
- **(b)** Test passes already (inner `CommentRenderer.renderGeneration`
  catches it) → we still want the test as a regression guard. Skip Task 6's
  production fix; commit the test only and note the inner guard is sufficient.

**Step 3: Commit**

```bash
git add src/comments/commentView.test.ts
git commit -m "test: cover commentView concurrent refresh race"
```

---

## Task 6: Fix `CommentView.refresh()` — ONLY if Task 5 failed

**Skip this task entirely if the Task 5 test passed without changes.**

**Files:**
- Modify: `src/comments/commentView.ts:8-57`

**Step 1: Add generation guard at the view layer**

```ts
export class CommentView extends ItemView {
  private renderer: CommentRenderer;
  private store: CommentStore;
  private appInstance: App;
  private refreshGeneration = 0;

  // ... constructor and other methods unchanged ...

  async refresh(filePath: string): Promise<void> {
    const gen = ++this.refreshGeneration;
    await this.renderer.refresh(this.contentEl, filePath);
    if (gen !== this.refreshGeneration) {
      // A newer refresh superseded us while CommentRenderer was running.
      // The newer call will paint over whatever we produced — nothing to do.
      return;
    }
  }
}
```

**Caveat:** This is belt-and-suspenders because `CommentRenderer` already
guards internally. The extra layer mostly documents intent and matches the
pattern used elsewhere.

**Step 2: Run tests — expect pass**

```bash
npx vitest run src/comments/commentView.test.ts
```

Expected: all pass.

**Step 3: Full suite**

```bash
npx vitest run
```

Expected: **413 passing** (+1 from Task 5 regression test).

**Step 4: Commit**

```bash
git add src/comments/commentView.ts
git commit -m "fix(comments): guard view refresh against concurrent calls

Mirror the pattern used in editHistoryView and notificationView so all
three async views drop stale refreshes consistently."
```

---

## Task 7: Update `src/AGENTS.md` module docs

**Files:**
- Modify: `src/AGENTS.md`

**Step 1: Add one-line note to the `editHistoryView.ts` module docs**

Find the `### editHistory/editHistoryView.ts -- Sidebar panel` section. Add
a final sentence to its paragraph describing persistence:

> Expanded-state persists across `refresh()` calls via the
> instance field `expandedSessions: Set<string>` keyed by
> `${device}-${startTs}`. Midnight-spanning sessions are filed under
> the **newest** version's calendar date so they stay grouped.
> **Concurrent `refresh()` calls are deduplicated via a
> `refreshGeneration` counter** — the stale refresh no-ops after its
> awaited `store.getEntry()` resolves, so only the latest call ever
> mutates the DOM.

**Step 2: Same one-liner for `notificationView.ts`**

Find `### notifications/notificationView.ts -- Notification panel` and append:

> Uses a `refreshGeneration` counter to drop stale concurrent refreshes.

**Step 3: Conditionally for `commentView.ts`**

If Task 6 ran, add the same one-liner to the `CommentView` section. If
Task 6 was skipped because `CommentRenderer`'s internal guard sufficed,
instead append to the `commentRenderer.ts` section:

> Serializes concurrent `refresh()` calls via `renderGeneration` —
> stale renders are dropped before they touch the DOM.

**Step 4: Commit**

```bash
git add src/AGENTS.md
git commit -m "docs: note refreshGeneration guard in view module descriptions"
```

---

## Task 8: Full verification

**Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: **412 or 413 passing** (depending on whether Task 6 ran). Zero
failures. Zero skipped tests that weren't previously skipped.

**Step 2: Run production build**

```bash
npm run build
```

Expected: clean tsc pass, clean esbuild output. No new warnings.

**Step 3: Manual smoke test (ask the user to confirm)**

Ask the user:

> Please test in your vault:
> 1. Open doc A → open edit history panel → confirm versions render.
> 2. Switch to doc B → switch back to doc A → **no duplicate should appear.**
> 3. Expand a multi-version session on A → switch away and back → the session
>    should remain expanded, no duplicate.
> 4. Let capture fire during idle (~5s after typing) while on A with panel
>    open → it should append one new version, not duplicate everything.

Only after the user confirms, treat the fix as verified.

**Step 4: No commit** — verification only.

---

## Done when

- [ ] Task 0: listener fan-in investigation captured in commit message of Task 2.
- [ ] Task 1-2: `EditHistoryView` race fixed with 2 new passing tests.
- [ ] Task 3-4: `NotificationView` race fixed with 1 new passing test.
- [ ] Task 5(-6): `CommentView` race test added; fix applied only if needed.
- [ ] Task 7: `src/AGENTS.md` updated.
- [ ] Task 8: full suite green, build clean, manual smoke test confirmed.
- [ ] Working tree clean; master is N commits ahead of origin/master.

## Not in scope

- Removing the `vault.on("modify")` listener for edit history (Task 0 confirms
  it's needed for cross-device sync).
- Broader debouncing / coalescing of refresh calls in `main.ts`.
- Push to `origin` — left for the user to decide separately.
- Version bump / release tagging.

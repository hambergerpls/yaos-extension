import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditHistoryView, EDIT_HISTORY_VIEW_TYPE } from "./editHistoryView";
import { EditHistoryStore } from "./editHistoryStore";
import type { FileHistoryEntry } from "./types";

function makeEntry(overrides: Partial<FileHistoryEntry> = {}): FileHistoryEntry {
	return {
		path: "notes/test.md",
		baseIndex: 0,
		versions: [
			{ ts: Date.now() - 60000, device: "Alice-Laptop", content: "hello world" },
			{ ts: Date.now() - 30000, device: "Bob-Phone", diff: [[0, "hello world"], [1, "!"]] },
		],
		...overrides,
	};
}

function makeStore(entries: Record<string, FileHistoryEntry> = {}) {
	return {
		getEntry: vi.fn(async (fileId: string) => entries[fileId]),
		load: vi.fn(async () => ({ version: 1, entries })),
		save: vi.fn(async () => {}),
		addVersion: vi.fn(async () => {}),
		prune: vi.fn(async () => {}),
		pruneEntry: vi.fn(async () => {}),
	} as unknown as EditHistoryStore;
}

describe("EditHistoryView", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("has correct view type", () => {
		const store = makeStore();
		const view = new EditHistoryView({} as any, store, vi.fn());
		expect(view.getViewType()).toBe(EDIT_HISTORY_VIEW_TYPE);
	});

	it("has display text 'Edit History'", () => {
		const store = makeStore();
		const view = new EditHistoryView({} as any, store, vi.fn());
		expect(view.getDisplayText()).toBe("Edit History");
	});

	it("renders empty state when no file is active", async () => {
		const store = makeStore();
		const view = new EditHistoryView({} as any, store, vi.fn());
		await view.onOpen();
		await view.refresh(null);

		const empty = view.contentEl.querySelector(".yaos-extension-edit-history-empty");
		expect(empty).not.toBeNull();
	});

	it("renders empty state when file has no history", async () => {
		const store = makeStore();
		const view = new EditHistoryView({} as any, store, vi.fn());
		await view.onOpen();
		await view.refresh("unknown-file-id");

		const empty = view.contentEl.querySelector(".yaos-extension-edit-history-empty");
		expect(empty).not.toBeNull();
	});

	it("renders file path in header", async () => {
		const entry = makeEntry();
		const store = makeStore({ "file1": entry });
		const view = new EditHistoryView({} as any, store, vi.fn());
		await view.onOpen();
		await view.refresh("file1");

		const header = view.contentEl.querySelector(".yaos-extension-edit-history-file-path");
		expect(header?.textContent).toContain("notes/test.md");
	});

	it("renders version entries for a file", async () => {
		const entry = makeEntry();
		const store = makeStore({ "file1": entry });
		const view = new EditHistoryView({} as any, store, vi.fn());
		await view.onOpen();
		await view.refresh("file1");

		const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-entry");
		expect(entries.length).toBe(2);
	});

	it("renders device name in each entry", async () => {
		const entry = makeEntry();
		const store = makeStore({ "file1": entry });
		const view = new EditHistoryView({} as any, store, vi.fn());
		await view.onOpen();
		await view.refresh("file1");

		const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-device");
		expect(entries[0]?.textContent).toContain("Bob-Phone");
		expect(entries[1]?.textContent).toContain("Alice-Laptop");
	});

	it("renders timestamp in each entry", async () => {
		const ts = Date.now() - 60000;
		const entry = makeEntry({
			versions: [{ ts, device: "Dev1", content: "hello" }],
		});
		const store = makeStore({ "file1": entry });
		const view = new EditHistoryView({} as any, store, vi.fn());
		await view.onOpen();
		await view.refresh("file1");

		const time = view.contentEl.querySelector(".yaos-extension-edit-history-time");
		expect(time).not.toBeNull();
	});

	it("groups versions by date", async () => {
		const today = new Date();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);

		const entry = makeEntry({
			versions: [
				{ ts: yesterday.getTime(), device: "Dev1", content: "old" },
				{ ts: today.getTime(), device: "Dev2", diff: [[1, "x"]] },
			],
		});
		const store = makeStore({ "file1": entry });
		const view = new EditHistoryView({} as any, store, vi.fn());
		await view.onOpen();
		await view.refresh("file1");

		const groups = view.contentEl.querySelectorAll(".yaos-extension-edit-history-date-group");
		expect(groups.length).toBe(2);
	});

	it("calls onRestore when restore button is clicked", async () => {
		const entry = makeEntry({
			versions: [{ ts: Date.now(), device: "Dev1", content: "restore me" }],
		});
		const store = makeStore({ "file1": entry });
		const onRestore = vi.fn();
		const view = new EditHistoryView({} as any, store, onRestore);
		await view.onOpen();
		await view.refresh("file1");

		const btn = view.contentEl.querySelector(".yaos-extension-edit-history-restore") as HTMLElement;
		expect(btn).not.toBeNull();
		btn?.click();

		expect(onRestore).toHaveBeenCalledWith("restore me");
	});

	describe("session grouping", () => {
		it("groups consecutive same-device versions within 5 minutes into one session", async () => {
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
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const sessionHeaders = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-session-header",
			);
			expect(sessionHeaders.length).toBe(1);

			const count = view.contentEl.querySelector(
				".yaos-extension-edit-history-session-count",
			);
			expect(count?.textContent).toContain("3");
		});

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
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const sessionHeaders = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-session-header",
			);
			expect(sessionHeaders.length).toBe(0);

			const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-entry");
			expect(entries.length).toBe(3);
		});

		it("does not group versions more than 5 minutes apart", async () => {
			const t0 = Date.now();
			const entry: FileHistoryEntry = {
				path: "a.md",
				baseIndex: 0,
				versions: [
					{ ts: t0, device: "DeviceA", content: "v0" },
					{ ts: t0 + 10 * 60_000, device: "DeviceA", diff: [[1, " a"]] },
				],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const sessionHeaders = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-session-header",
			);
			expect(sessionHeaders.length).toBe(0);

			const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-entry");
			expect(entries.length).toBe(2);
		});

		it("session header shows correct time range", async () => {
			const t0 = new Date(2026, 3, 18, 10, 0, 0).getTime();
			const t1 = new Date(2026, 3, 18, 10, 3, 0).getTime();
			const entry: FileHistoryEntry = {
				path: "a.md",
				baseIndex: 0,
				versions: [
					{ ts: t0, device: "DeviceA", content: "v0" },
					{ ts: t1, device: "DeviceA", diff: [[1, " a"]] },
				],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const timeEl = view.contentEl.querySelector(
				".yaos-extension-edit-history-session-header .yaos-extension-edit-history-time",
			);
			expect(timeEl).not.toBeNull();
			// Should contain 10:00 and 10:03 with a separator
			expect(timeEl!.textContent).toMatch(/10:00.*[–-].*10:03/);
		});

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
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
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

			const childEntries = childrenContainer.querySelectorAll(
				".yaos-extension-edit-history-entry",
			);
			expect(childEntries.length).toBe(3);
		});

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
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const header = view.contentEl.querySelector(
				".yaos-extension-edit-history-session-header",
			) as HTMLElement;
			const childrenContainer = view.contentEl.querySelector(
				".yaos-extension-edit-history-session-children",
			) as HTMLElement;

			header.click();
			expect(childrenContainer.style.display).toBe("");

			header.click();
			expect(childrenContainer.style.display).toBe("none");
		});

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
			const onRestore = vi.fn();
			const view = new EditHistoryView({} as any, store, onRestore);
			await view.onOpen();
			await view.refresh("f1");

			const header = view.contentEl.querySelector(
				".yaos-extension-edit-history-session-header",
			) as HTMLElement;
			header.click(); // expand

			const restoreButtons = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-session-children .yaos-extension-edit-history-restore",
			);
			expect(restoreButtons.length).toBe(2);

			// Newest child is first in DOM; its restore should reconstruct v0+edit = "v0 edit"
			(restoreButtons[0] as HTMLElement).click();
			expect(onRestore).toHaveBeenCalledTimes(1);
			expect(onRestore).toHaveBeenCalledWith("v0 edit");
		});

		it("single-version sessions render with no expand affordance", async () => {
			const t0 = Date.now();
			const entry: FileHistoryEntry = {
				path: "a.md",
				baseIndex: 0,
				versions: [{ ts: t0, device: "DeviceA", content: "v0" }],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const sessionHeaders = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-session-header",
			);
			expect(sessionHeaders.length).toBe(0);

			const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-entry");
			expect(entries.length).toBe(1);
		});

		it("session aggregate diff summary sums children", async () => {
			const t0 = Date.now();
			// computeDiffSummary counts lines, not characters. Use multi-line strings
			// so the aggregate across two children produces a clearly non-trivial sum.
			const entry: FileHistoryEntry = {
				path: "a.md",
				baseIndex: 0,
				versions: [
					{ ts: t0, device: "DeviceA", content: "v0" },
					// v1 → adds 3 lines, removes 1 line
					{ ts: t0 + 60_000, device: "DeviceA", diff: [[1, "a\nb\nc"], [-1, "x"]] },
					// v2 → adds 2 lines
					{ ts: t0 + 120_000, device: "DeviceA", diff: [[1, "d\ne"]] },
				],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const summary = view.contentEl.querySelector(
				".yaos-extension-edit-history-session-header .yaos-extension-edit-history-summary",
			);
			expect(summary).not.toBeNull();
			// +5 total added (3+2), -1 total removed
			expect(summary!.textContent).toContain("+5");
			expect(summary!.textContent).toContain("-1");
		});

		it("midnight-spanning session is placed under newest version's date", async () => {
			// t1 = 00:03 today, t0 = 23:58 yesterday (5 min earlier)
			const today = new Date();
			today.setHours(0, 3, 0, 0);
			const t1 = today.getTime();
			const t0 = t1 - 5 * 60_000;

			const entry: FileHistoryEntry = {
				path: "a.md",
				baseIndex: 0,
				versions: [
					{ ts: t0, device: "DeviceA", content: "v0" },
					{ ts: t1, device: "DeviceA", diff: [[1, " a"]] },
				],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const dateGroups = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-date-group",
			);
			expect(dateGroups.length).toBe(1);

			const sessionHeaders = view.contentEl.querySelectorAll(
				".yaos-extension-edit-history-session-header",
			);
			expect(sessionHeaders.length).toBe(1);

			const todayLabel = new Date(t1).toLocaleDateString(undefined, {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
			const dateHeader = view.contentEl.querySelector(
				".yaos-extension-edit-history-date-header",
			);
			expect(dateHeader?.textContent).toBe(todayLabel);
		});
	});

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

		it("renders stored diff as hunk rows with +/-/space gutter", async () => {
			const entry: FileHistoryEntry = {
				path: "notes/x.md",
				baseIndex: 0,
				versions: [
					{ ts: 1000, device: "DevA", content: "a\nb\nc" },
					{ ts: 2000, device: "DevA", diff: [[0, "a\n"], [-1, "b"], [1, "B"], [0, "\nc"]] },
				],
			};
			const store = makeStore({ f1: entry });
			const view = new EditHistoryView({} as any, store, vi.fn());
			await view.onOpen();
			await view.refresh("f1");

			const entries = view.contentEl.querySelectorAll(".yaos-extension-edit-history-entry");
			const hunkDiff = entries[0]!.querySelector(".yaos-extension-edit-history-diff")!;

			const hunks = hunkDiff.querySelectorAll(".yaos-extension-edit-history-diff-hunk");
			expect(hunks.length).toBe(1);

			const rows = hunks[0]!.querySelectorAll(".yaos-extension-edit-history-diff-line");
			expect(rows.length).toBe(4);

			expect(rows[0]!.classList.contains("yaos-extension-edit-history-diff-retain-line")).toBe(true);
			expect(rows[1]!.classList.contains("yaos-extension-edit-history-diff-del-line")).toBe(true);
			expect(rows[2]!.classList.contains("yaos-extension-edit-history-diff-add-line")).toBe(true);
			expect(rows[3]!.classList.contains("yaos-extension-edit-history-diff-retain-line")).toBe(true);

			const gutters = hunkDiff.querySelectorAll(".yaos-extension-edit-history-diff-gutter");
			expect(Array.from(gutters).map(g => g.textContent)).toEqual([" ", "-", "+", " "]);

			const texts = hunkDiff.querySelectorAll(".yaos-extension-edit-history-diff-line-text");
			expect(Array.from(texts).map(t => t.textContent)).toEqual(["a", "b", "B", "c"]);
		});

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
	});
});

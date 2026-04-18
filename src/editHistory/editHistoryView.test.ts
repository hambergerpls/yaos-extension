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
});

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
});

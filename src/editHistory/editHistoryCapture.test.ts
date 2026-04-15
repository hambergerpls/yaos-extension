import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { EditHistoryCapture } from "./editHistoryCapture";
import { EditHistoryStore } from "./editHistoryStore";
import type { EditHistoryData, FileHistoryEntry } from "./types";
import { PendingEditsDb } from "./pendingEditsDb";

function makeStore(captured: { calls: any[] }) {
	const entries: Record<string, FileHistoryEntry> = {};

	return {
		async load(): Promise<EditHistoryData> {
			return { version: 1, entries };
		},
		async save(data: EditHistoryData): Promise<void> {
			Object.assign(entries, data.entries);
		},
		async addVersion(fileId: string, path: string, snap: any): Promise<void> {
			captured.calls.push({ fileId, path, snap });
			if (!entries[fileId]) {
				entries[fileId] = { path, baseIndex: 0, versions: [] };
			}
			entries[fileId]!.versions.push(snap);
			entries[fileId]!.path = path;
		},
		async addVersions(batch: Array<{ fileId: string; path: string; snapshot: any }>): Promise<void> {
			for (const { fileId, path, snapshot } of batch) {
				captured.calls.push({ fileId, path, snap: snapshot });
				if (!entries[fileId]) {
					entries[fileId] = { path, baseIndex: 0, versions: [] };
				}
				entries[fileId]!.versions.push(snapshot);
				entries[fileId]!.path = path;
			}
		},
		async getEntry(fileId: string): Promise<FileHistoryEntry | undefined> {
			return entries[fileId];
		},
	} as any as EditHistoryStore;
}

let pendingDbCounter = 0;

async function makeCaptureWithDb(
	store: EditHistoryStore,
	settings: Partial<{ rebaseInterval: number; maxPerFilePerDay: number; debounceMs: number }> = {},
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
		},
		1_000_000,
		pendingDb,
	);
	return { capture, pendingDb };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("EditHistoryCapture", () => {
	let captured: { calls: any[] };
	let store: EditHistoryStore;
	let capture: EditHistoryCapture;
	let pendingDb: PendingEditsDb;

	beforeEach(async () => {
		captured = { calls: [] };
		store = makeStore(captured);
		const result = await makeCaptureWithDb(store);
		capture = result.capture;
		pendingDb = result.pendingDb;
	});

	afterEach(async () => {
		capture.stop();
		await pendingDb.clear();
		pendingDb.close();
	});

	describe("captureSnapshot", () => {
		it("creates a base version for a new file", async () => {
			await capture.captureSnapshot("f1", "notes/a.md", "hello world");

			expect(captured.calls).toHaveLength(1);
			expect(captured.calls[0].snap.content).toBe("hello world");
			expect(captured.calls[0].snap.device).toBe("TestDevice");
			expect(captured.calls[0].snap.diff).toBeUndefined();
		});

		it("creates a delta version when a previous version exists", async () => {
			await capture.captureSnapshot("f1", "notes/a.md", "hello");
			await capture.captureSnapshot("f1", "notes/a.md", "hello world");

			expect(captured.calls).toHaveLength(2);
			const delta = captured.calls[1].snap;
			expect(delta.content).toBeUndefined();
			expect(delta.diff).toBeDefined();
			expect(delta.device).toBe("TestDevice");
		});

		it("re-bases after rebaseInterval versions", async () => {
			await capture.captureSnapshot("f1", "a.md", "v0");
			await capture.captureSnapshot("f1", "a.md", "v1");
			await capture.captureSnapshot("f1", "a.md", "v2");

			expect(captured.calls).toHaveLength(3);
			expect(captured.calls[0].snap.content).toBe("v0");
			expect(captured.calls[1].snap.diff).toBeDefined();
			expect(captured.calls[2].snap.diff).toBeDefined();

			await capture.captureSnapshot("f1", "a.md", "v3");

			expect(captured.calls).toHaveLength(4);
			expect(captured.calls[3].snap.content).toBe("v3");
			expect(captured.calls[3].snap.diff).toBeUndefined();
		});

		it("skips capture when content matches last version", async () => {
			await capture.captureSnapshot("f1", "a.md", "same");
			captured.calls.length = 0;

			await capture.captureSnapshot("f1", "a.md", "same");

			expect(captured.calls).toHaveLength(0);
		});

		it("respects maxPerFilePerDay limit", async () => {
			const { capture: limitedCapture, pendingDb: limitedDb } = await makeCaptureWithDb(store, {
				rebaseInterval: 100,
				maxPerFilePerDay: 2,
				debounceMs: 0,
			});

			try {
				await limitedCapture.captureSnapshot("f1", "a.md", "v0");
				await limitedCapture.captureSnapshot("f1", "a.md", "v1");
				captured.calls.length = 0;

				await limitedCapture.captureSnapshot("f1", "a.md", "v2");

				expect(captured.calls).toHaveLength(0);
			} finally {
				limitedCapture.stop();
				await limitedDb.clear();
				limitedDb.close();
			}
		});

		it("updates path when file is renamed", async () => {
			await capture.captureSnapshot("f1", "old.md", "hello");
			await capture.captureSnapshot("f1", "new.md", "hello world");

			expect(captured.calls[1].path).toBe("new.md");
		});
	});

	describe("start/stop", () => {
		it("subscribes to afterTransaction on ydoc and observe on idToText", () => {
			const on = vi.fn();
			const off = vi.fn();
			const observe = vi.fn();
			const unobserve = vi.fn();
			const ydoc = { on, off };
			const idToText = { observe, unobserve };

			capture.start(ydoc as any, idToText as any, vi.fn(), vi.fn());
			expect(on).toHaveBeenCalledWith("afterTransaction", expect.any(Function));
			expect(observe).toHaveBeenCalledWith(expect.any(Function));

			capture.stop();
			expect(off).toHaveBeenCalledWith("afterTransaction", expect.any(Function));
			expect(unobserve).toHaveBeenCalled();
		});
	});

	describe("debounce", () => {
		it("does not capture immediately", () => {
			capture.scheduleCapture("f1", "a.md", "hello");
			expect(captured.calls).toHaveLength(0);
		});

		it("captures after debounce time elapses", async () => {
			const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });

			try {
				fastCapture.scheduleCapture("f1", "a.md", "hello");
				await sleep(100);
				expect(captured.calls).toHaveLength(1);
			} finally {
				fastCapture.stop();
				await fastDb.clear();
				fastDb.close();
			}
		});

		it("resets timer on subsequent edits", async () => {
			const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });

			try {
				fastCapture.scheduleCapture("f1", "a.md", "hello");
				await sleep(10);
				fastCapture.scheduleCapture("f1", "a.md", "hello world");
				await sleep(10);
				expect(captured.calls).toHaveLength(0);

				await sleep(30);
				expect(captured.calls).toHaveLength(1);
				expect(captured.calls[0].snap.content).toBe("hello world");
			} finally {
				fastCapture.stop();
				await fastDb.clear();
				fastDb.close();
			}
		});

		it("uses latest content when debounce fires", async () => {
			const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });

			try {
				fastCapture.scheduleCapture("f1", "a.md", "first");
				fastCapture.scheduleCapture("f1", "a.md", "second");
				fastCapture.scheduleCapture("f1", "a.md", "third");
				await sleep(100);
				expect(captured.calls).toHaveLength(1);
				expect(captured.calls[0].snap.content).toBe("third");
			} finally {
				fastCapture.stop();
				await fastDb.clear();
				fastDb.close();
			}
		});
	});

	describe("onTransaction", () => {
		it("schedules capture for changed file IDs from idToText observe", async () => {
			const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });
			const on = vi.fn();
			const off = vi.fn();
			const observe = vi.fn();
			const unobserve = vi.fn();
			const idToText = { observe, unobserve };

			const getFilePath = vi.fn((_id: string) => "notes/a.md");
			const getText = vi.fn((_id: string) => ({ toJSON: () => "content from CRDT" }));

			try {
				fastCapture.start({ on, off } as any, idToText as any, getFilePath, getText);

				expect(observe).toHaveBeenCalledWith(expect.any(Function));

				const observeHandler = observe.mock.calls[0]![0];
				const changedKeys = new Map<string, { action: string }>();
				changedKeys.set("file1", { action: "update" });
				const yMapEvent = { keys: changedKeys, transaction: {} };
				observeHandler(yMapEvent);

				expect(captured.calls).toHaveLength(0);

				await sleep(100);
				expect(captured.calls).toHaveLength(1);
				expect(captured.calls[0].snap.content).toBe("content from CRDT");
				expect(captured.calls[0].path).toBe("notes/a.md");
			} finally {
				fastCapture.stop();
				await fastDb.clear();
				fastDb.close();
			}
		});

		it("ignores file IDs where getText returns null", async () => {
			const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });
			const on = vi.fn();
			const off = vi.fn();
			const observe = vi.fn();
			const idToText = { observe, unobserve: vi.fn() };
			const getFilePath = vi.fn(() => "notes/a.md");
			const getText = vi.fn(() => null);

			try {
				fastCapture.start({ on, off } as any, idToText as any, getFilePath, getText);

				const observeHandler = observe.mock.calls[0]![0];
				const changedKeys = new Map();
				changedKeys.set("file1", { action: "update" });
				observeHandler({ keys: changedKeys, transaction: {} });

				await sleep(100);
				expect(captured.calls).toHaveLength(0);
			} finally {
				fastCapture.stop();
				await fastDb.clear();
				fastDb.close();
			}
		});
	});

	it("cleans up timers on stop", async () => {
		capture.scheduleCapture("f1", "a.md", "content");
		capture.stop();
		await sleep(100);
		expect(captured.calls).toHaveLength(0);
	});

	describe("IndexedDB staging", () => {
		it("persists pending edit to IndexedDB on scheduleCapture", async () => {
			capture.scheduleCapture("f1", "a.md", "hello");
			await sleep(10);
			const pending = await pendingDb.get("f1");
			expect(pending).toBeDefined();
			expect(pending!.content).toBe("hello");
			expect(pending!.path).toBe("a.md");
		});

		it("overwrites IndexedDB entry on subsequent scheduleCapture for same fileId", async () => {
			capture.scheduleCapture("f1", "a.md", "first");
			await sleep(10);
			capture.scheduleCapture("f1", "a.md", "second");
			await sleep(10);
			const pending = await pendingDb.get("f1");
			expect(pending!.content).toBe("second");
		});

		it("removes IndexedDB entry after debounce timer fires and captures", async () => {
			const { capture: fastCapture, pendingDb: fastDb } = await makeCaptureWithDb(store, { debounceMs: 20 });

			try {
				fastCapture.scheduleCapture("f1", "a.md", "hello");
				await sleep(100);
				expect(captured.calls).toHaveLength(1);
				const pending = await fastDb.get("f1");
				expect(pending).toBeUndefined();
			} finally {
				fastCapture.stop();
				await fastDb.clear();
				fastDb.close();
			}
		});

		it("flush promotes all pending IndexedDB entries to edit-history.json", async () => {
			capture.scheduleCapture("f1", "a.md", "content-a");
			capture.scheduleCapture("f2", "b.md", "content-b");
			await sleep(10);
			expect(captured.calls).toHaveLength(0);

			await capture.flush();

			expect(captured.calls).toHaveLength(2);
			expect(captured.calls[0].snap.content).toBe("content-a");
			expect(captured.calls[1].snap.content).toBe("content-b");

			const all = await pendingDb.getAll();
			expect(all).toEqual([]);
		});

		it("flush clears timers", async () => {
			capture.scheduleCapture("f1", "a.md", "hello");
			await capture.flush();

			await sleep(100);
			expect(captured.calls).toHaveLength(1);
		});
	});

	describe("recovery on start", () => {
		it("promotes orphaned IndexedDB entries on start", async () => {
			pendingDbCounter++;
			const recoveryDb = new PendingEditsDb(`test-recovery-${pendingDbCounter}`);
			await recoveryDb.open();
			await recoveryDb.put({ fileId: "f1", path: "orphan.md", content: "orphan content", ts: 1000 });

			const recoveryCapture = new EditHistoryCapture(
				store,
				() => "TestDevice",
				{ rebaseInterval: 3, maxPerFilePerDay: 50, debounceMs: 30000 },
				1_000_000,
				recoveryDb,
			);

			try {
				await recoveryCapture.recoverOrphans();

				expect(captured.calls).toHaveLength(1);
				expect(captured.calls[0].snap.content).toBe("orphan content");
				expect(captured.calls[0].path).toBe("orphan.md");

				const all = await recoveryDb.getAll();
				expect(all).toEqual([]);
			} finally {
				recoveryCapture.stop();
				await recoveryDb.clear();
				recoveryDb.close();
			}
		});
	});
});

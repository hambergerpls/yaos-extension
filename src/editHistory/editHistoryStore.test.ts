import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditHistoryStore } from "./editHistoryStore";
import type { EditHistoryData, FileHistoryEntry, VersionSnapshot } from "./types";

const HISTORY_PATH = ".yaos-extension/edit-history.json";

function makeVault(files: Record<string, string>) {
	return {
		adapter: {
			exists: vi.fn(async (path: string) => path in files),
			mkdir: vi.fn(async (path: string) => { files[path] = ""; }),
			read: vi.fn(async (path: string) => {
				if (!(path in files)) throw new Error("File not found");
				return files[path];
			}),
			write: vi.fn(async (path: string, data: string) => { files[path] = data; }),
		},
	} as any;
}

function makeEntry(overrides: Partial<FileHistoryEntry> = {}): FileHistoryEntry {
	return {
		path: "test.md",
		baseIndex: 0,
		versions: [{ ts: 1000, device: "Dev1", content: "hello" }],
		...overrides,
	};
}

describe("EditHistoryStore", () => {
	let vault: ReturnType<typeof makeVault>;

	beforeEach(() => {
		vault = makeVault({});
	});

	function createStore() {
		return new EditHistoryStore(vault);
	}

	describe("load", () => {
		it("returns default data when file does not exist", async () => {
			const store = createStore();
			const data = await store.load();
			expect(data).toEqual({ version: 1, entries: {} });
		});

		it("returns parsed data when file exists", async () => {
			const stored: EditHistoryData = {
				version: 1,
				entries: { "abc": makeEntry() },
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(stored) });
			const store = new EditHistoryStore(vault);
			const data = await store.load();
			expect(data.entries["abc"]).toBeDefined();
			expect(data.entries["abc"]!.path).toBe("test.md");
		});

		it("returns default data when file contains invalid JSON", async () => {
			vault = makeVault({ [HISTORY_PATH]: "not json" });
			const store = new EditHistoryStore(vault);
			const data = await store.load();
			expect(data).toEqual({ version: 1, entries: {} });
		});

		it("creates .yaos-extension directory if needed on save", async () => {
			const store = createStore();
			await store.save({ version: 1, entries: {} });
			expect(vault.adapter.mkdir).toHaveBeenCalledWith(".yaos-extension");
		});
	});

	describe("save", () => {
		it("writes data as JSON to the history file", async () => {
			const store = createStore();
			const data: EditHistoryData = {
				version: 1,
				entries: { "abc": makeEntry() },
			};
			await store.save(data);
			expect(vault.adapter.write).toHaveBeenCalledWith(
				HISTORY_PATH,
				expect.any(String),
			);
			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["abc"]).toBeDefined();
		});
	});

	describe("addVersion", () => {
		it("creates a new entry for an unknown file ID", async () => {
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify({ version: 1, entries: {} }) });
			const store = new EditHistoryStore(vault);

			const snap: VersionSnapshot = {
				ts: 2000,
				device: "Dev1",
				content: "new content",
			};
			await store.addVersion("file1", "notes/new.md", snap);

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["file1"]).toBeDefined();
			expect(written.entries["file1"].path).toBe("notes/new.md");
			expect(written.entries["file1"].versions).toHaveLength(1);
			expect(written.entries["file1"].baseIndex).toBe(0);
		});

		it("appends a delta version to an existing entry", async () => {
			const existing: EditHistoryData = {
				version: 1,
				entries: { "file1": makeEntry() },
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(existing) });
			const store = new EditHistoryStore(vault);

			const snap: VersionSnapshot = {
				ts: 2000,
				device: "Dev2",
				diff: [[0, "hello"], [1, " world"]],
			};
			await store.addVersion("file1", "test.md", snap);

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["file1"].versions).toHaveLength(2);
		});

		it("updates the path on rename", async () => {
			const existing: EditHistoryData = {
				version: 1,
				entries: { "file1": makeEntry({ path: "old.md" }) },
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(existing) });
			const store = new EditHistoryStore(vault);

			await store.addVersion("file1", "new-path.md", {
				ts: 2000,
				device: "Dev1",
				diff: [[0, "hello"]],
			});

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["file1"].path).toBe("new-path.md");
		});

		it("updates baseIndex when a content snapshot is appended after deltas", async () => {
			const existing: EditHistoryData = {
				version: 1,
				entries: {
					"file1": {
						path: "test.md",
						baseIndex: 0,
						versions: [
							{ ts: 1000, device: "Dev1", content: "base" },
							{ ts: 2000, device: "Dev2", diff: [[1, " extra"]] },
							{ ts: 3000, device: "Dev3", diff: [[1, " more"]] },
						],
					},
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(existing) });
			const store = new EditHistoryStore(vault);

			await store.addVersion("file1", "test.md", {
				ts: 4000,
				device: "Dev1",
				content: "rebased full content",
			});

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["file1"].baseIndex).toBe(3);
			expect(written.entries["file1"].versions).toHaveLength(4);
		});
	});

	describe("getEntry", () => {
		it("returns the entry for a file ID", async () => {
			const entry = makeEntry();
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify({ version: 1, entries: { "file1": entry } }) });
			const store = new EditHistoryStore(vault);

			const result = await store.getEntry("file1");
			expect(result).toBeDefined();
			expect(result!.path).toBe("test.md");
		});

		it("returns undefined for unknown file ID", async () => {
			const store = createStore();
			const result = await store.getEntry("unknown");
			expect(result).toBeUndefined();
		});
	});

	describe("prune", () => {
		it("removes entries older than retention days", async () => {
			const now = Date.now();
			const oldTs = now - 31 * 24 * 60 * 60 * 1000;
			const recentTs = now - 10 * 24 * 60 * 60 * 1000;

			const data: EditHistoryData = {
				version: 1,
				entries: {
					"old-file": makeEntry({
						versions: [{ ts: oldTs, device: "Dev1", content: "old" }],
					}),
					"recent-file": makeEntry({
						versions: [{ ts: recentTs, device: "Dev1", content: "recent" }],
					}),
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault);

			await store.prune(30);

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["old-file"]).toBeUndefined();
			expect(written.entries["recent-file"]).toBeDefined();
		});

		it("removes individual versions older than retention", async () => {
			const now = Date.now();
			const oldTs = now - 31 * 24 * 60 * 60 * 1000;
			const recentTs = now - 10 * 24 * 60 * 60 * 1000;

			const data: EditHistoryData = {
				version: 1,
				entries: {
					"file1": makeEntry({
						versions: [
							{ ts: oldTs, device: "Dev1", content: "old base" },
							{ ts: recentTs, device: "Dev2", diff: [[1, "new"]] },
						],
					}),
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault);

			await store.prune(30);

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			const entry = written.entries["file1"];
			expect(entry.versions).toHaveLength(1);
			expect(entry.versions[0].ts).toBe(recentTs);
			expect(entry.baseIndex).toBe(0);
		});

		it("re-bases when pruning the current base", async () => {
			const now = Date.now();
			const oldTs = now - 31 * 24 * 60 * 60 * 1000;
			const recentTs = now - 10 * 24 * 60 * 60 * 1000;

			const data: EditHistoryData = {
				version: 1,
				entries: {
					"file1": {
						path: "test.md",
						baseIndex: 0,
						versions: [
							{ ts: oldTs, device: "Dev1", content: "old base" },
							{ ts: oldTs + 1000, device: "Dev1", diff: [[0, "old base"], [1, " more"]] },
							{ ts: recentTs, device: "Dev2", diff: [[0, "old base more"], [1, " and more"]] },
						],
					},
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault);

			await store.prune(30);

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			const entry = written.entries["file1"];
			expect(entry.versions).toHaveLength(1);
			expect(entry.versions[0].content).toBeDefined();
			expect(entry.versions[0].ts).toBe(recentTs);
			expect(entry.baseIndex).toBe(0);
		});

		it("removes entries for deleted file IDs", async () => {
			const data: EditHistoryData = {
				version: 1,
				entries: {
					"deleted-file": makeEntry({ path: "gone.md" }),
					"active-file": makeEntry({ path: "active.md" }),
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault);

			await store.pruneEntry("deleted-file");

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["deleted-file"]).toBeUndefined();
			expect(written.entries["active-file"]).toBeDefined();
		});

		it("adjusts baseIndex when pruning versions before the base in the else branch", async () => {
			const now = Date.now();
			const oldTs = now - 31 * 24 * 60 * 60 * 1000;
			const midTs = now - 20 * 24 * 60 * 60 * 1000;
			const recentTs = now - 5 * 24 * 60 * 60 * 1000;

			const data: EditHistoryData = {
				version: 1,
				entries: {
					"file1": {
						path: "test.md",
						baseIndex: 3,
						versions: [
							{ ts: oldTs, device: "Dev1", diff: [[1, "x"]] },
							{ ts: oldTs + 1000, device: "Dev1", diff: [[1, "y"]] },
							{ ts: midTs, device: "Dev1", diff: [[1, "z"]] },
							{ ts: midTs + 1000, device: "Dev2", content: "rebased" },
							{ ts: recentTs, device: "Dev3", diff: [[0, "rebased"], [1, "!"]] },
						],
					},
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault);

			await store.prune(30);

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			const entry = written.entries["file1"];
			expect(entry).toBeDefined();
			expect(entry.versions.length).toBeGreaterThanOrEqual(1);
			expect(entry.baseIndex).toBeLessThan(entry.versions.length);
			expect(entry.versions[entry.baseIndex].content).toBeDefined();
		});
	});
});

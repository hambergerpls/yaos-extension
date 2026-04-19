import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditHistoryStore } from "./editHistoryStore";
import type { EditHistoryData, FileHistoryEntry, VersionSnapshot } from "./types";

const TEST_DEVICE = "test-device";
const HISTORY_PATH = `.yaos-extension/edit-history-${TEST_DEVICE}.json`;

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
		return new EditHistoryStore(vault, () => TEST_DEVICE);
	}

	describe("load", () => {
		it("returns default data when file does not exist", async () => {
			const store = createStore();
			const data = await store.load();
			expect(data).toEqual({ version: 3, entries: {} });
		});

		it("returns parsed data when file exists", async () => {
			const stored: EditHistoryData = {
				version: 3,
				entries: { "abc": makeEntry() },
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(stored) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);
			const data = await store.load();
			expect(data.entries["abc"]).toBeDefined();
			expect(data.entries["abc"]!.path).toBe("test.md");
		});

		it("returns default data when file contains invalid JSON", async () => {
			vault = makeVault({ [HISTORY_PATH]: "not json" });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);
			const data = await store.load();
			expect(data).toEqual({ version: 3, entries: {} });
		});

		it("creates .yaos-extension directory if needed on save", async () => {
			const store = createStore();
			await store.save({ version: 3, entries: {} });
			expect(vault.adapter.mkdir).toHaveBeenCalledWith(".yaos-extension");
		});

		it("wipes entries on load when stored version is not 3 (v2 → v3 migration)", async () => {
			const staleV2 = {
				version: 2,
				entries: {
					"file-a": { path: "a.md", baseIndex: 0, versions: [{ ts: 1, device: "d", content: "x" }] },
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(staleV2) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

			const data = await store.load();
			expect(data).toEqual({ version: 3, entries: {} });

			// And it should have persisted the wipe
			const persisted = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(persisted.version).toBe(3);
			expect(persisted.entries).toEqual({});
		});
	});

	describe("save", () => {
		it("writes data as JSON to the history file", async () => {
			const store = createStore();
			const data: EditHistoryData = {
				version: 3,
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
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify({ version: 3, entries: {} }) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

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
				version: 3,
				entries: { "file1": makeEntry() },
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(existing) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

			const snap: VersionSnapshot = {
				ts: 2000,
				device: "Dev2",
				hunks: [{ s: 0, d: 1, a: ["hello world"] }],
			};
			await store.addVersion("file1", "test.md", snap);

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["file1"].versions).toHaveLength(2);
		});

		it("updates the path on rename", async () => {
			const existing: EditHistoryData = {
				version: 3,
				entries: { "file1": makeEntry({ path: "old.md" }) },
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(existing) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

			await store.addVersion("file1", "new-path.md", {
				ts: 2000,
				device: "Dev1",
				hunks: [],
			});

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			expect(written.entries["file1"].path).toBe("new-path.md");
		});

		it("updates baseIndex when a content snapshot is appended after deltas", async () => {
			const existing: EditHistoryData = {
				version: 3,
				entries: {
					"file1": {
						path: "test.md",
						baseIndex: 0,
						versions: [
							{ ts: 1000, device: "Dev1", content: "base" },
							{ ts: 2000, device: "Dev2", hunks: [{ s: 0, d: 1, a: ["base extra"] }] },
							{ ts: 3000, device: "Dev3", hunks: [{ s: 0, d: 1, a: ["base extra more"] }] },
						],
					},
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(existing) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

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
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify({ version: 3, entries: { "file1": entry } }) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

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
				version: 3,
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
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

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
				version: 3,
				entries: {
					"file1": makeEntry({
						versions: [
							{ ts: oldTs, device: "Dev1", content: "old base" },
							{ ts: recentTs, device: "Dev2", hunks: [{ s: 0, d: 1, a: ["old basenew"] }] },
						],
					}),
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

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
				version: 3,
				entries: {
					"file1": {
						path: "test.md",
						baseIndex: 0,
						versions: [
							{ ts: oldTs, device: "Dev1", content: "old base" },
							{ ts: oldTs + 1000, device: "Dev1", hunks: [{ s: 0, d: 1, a: ["old base more"] }] },
							{ ts: recentTs, device: "Dev2", hunks: [{ s: 0, d: 1, a: ["old base more and more"] }] },
						],
					},
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

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
				version: 3,
				entries: {
					"deleted-file": makeEntry({ path: "gone.md" }),
					"active-file": makeEntry({ path: "active.md" }),
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

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
				version: 3,
				entries: {
					"file1": {
						path: "test.md",
						baseIndex: 3,
						versions: [
							{ ts: oldTs, device: "Dev1", hunks: [{ s: 0, d: 0, a: ["x"] }] },
							{ ts: oldTs + 1000, device: "Dev1", hunks: [{ s: 0, d: 0, a: ["y"] }] },
							{ ts: midTs, device: "Dev1", hunks: [{ s: 0, d: 0, a: ["z"] }] },
							{ ts: midTs + 1000, device: "Dev2", content: "rebased" },
							{ ts: recentTs, device: "Dev3", hunks: [{ s: 0, d: 1, a: ["rebased!"] }] },
						],
					},
				},
			};
			vault = makeVault({ [HISTORY_PATH]: JSON.stringify(data) });
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

			await store.prune(30);

			const written = JSON.parse(vault.adapter.write.mock.calls[0][1]);
			const entry = written.entries["file1"];
			expect(entry).toBeDefined();
			expect(entry.versions.length).toBeGreaterThanOrEqual(1);
			expect(entry.baseIndex).toBeLessThan(entry.versions.length);
			expect(entry.versions[entry.baseIndex].content).toBeDefined();
		});

		it("re-encodes a synthesized base through encodeContent during prune", async () => {
			const oldTs = Date.now() - 40 * 24 * 60 * 60 * 1000; // > 30d
			const recentTs = Date.now() - 1 * 24 * 60 * 60 * 1000;
			const bigBase = "line\n".repeat(200); // > 512 bytes

			const entry: FileHistoryEntry = {
				path: "x.md",
				baseIndex: 0,
				versions: [
					{ ts: oldTs, device: "d", content: bigBase },
					{ ts: recentTs, device: "d", hunks: [{ s: 0, d: 0, a: ["added"] }] },
				],
			};
			vault = makeVault({
				[HISTORY_PATH]: JSON.stringify({ version: 3, entries: { "file-x": entry } }),
			});
			const store = new EditHistoryStore(vault, () => TEST_DEVICE);

			await store.prune(30);

			const persisted = JSON.parse(vault.adapter.write.mock.calls.at(-1)![1]);
			const pruned = persisted.entries["file-x"];
			expect(pruned.versions.length).toBe(1);
			// The synthesized base should now be dfb64-encoded since it's large + compressible.
			expect(pruned.versions[0].contentEnc).toBe("dfb64");
			expect(pruned.versions[0].hunks).toBeUndefined();
		});
	});

	describe("write serialization", () => {
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
			const store = new EditHistoryStore(slowVault, () => TEST_DEVICE);

			const p1 = store.addVersion("file-a", "a.md", { ts: 1, device: "D", content: "a" });
			const p2 = store.addVersion("file-b", "b.md", { ts: 2, device: "D", content: "b" });

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

		it("concurrent addVersion to same fileId preserves both versions", async () => {
			const files: Record<string, string> = {};
			const gate = { pending: [] as Array<() => void> };
			const slowVault = makeSlowVault(files, gate);
			const store = new EditHistoryStore(slowVault, () => TEST_DEVICE);

			const p1 = store.addVersion("file-a", "a.md", { ts: 1, device: "D", content: "v1" });
			const p2 = store.addVersion("file-a", "a.md", { ts: 2, device: "D", hunks: [{ s: 0, d: 1, a: ["v12"] }] });

			while (gate.pending.length < 1) await new Promise((r) => setTimeout(r, 0));
			gate.pending.shift()!();
			await p1;
			while (gate.pending.length < 1) await new Promise((r) => setTimeout(r, 0));
			gate.pending.shift()!();
			await p2;

			const data = JSON.parse(files[HISTORY_PATH]!);
			expect(data.entries["file-a"]!.versions.length).toBe(2);
		});
	});

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
});

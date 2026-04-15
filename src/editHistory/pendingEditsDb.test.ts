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

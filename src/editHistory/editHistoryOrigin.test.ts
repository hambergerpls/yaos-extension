import { describe, it, expect } from "vitest";
import { isLocalOrigin } from "./editHistoryOrigin";

describe("isLocalOrigin", () => {
	it("returns false when origin is the provider reference", () => {
		const provider = { name: "fake-provider" };
		expect(isLocalOrigin(provider, provider)).toBe(false);
	});

	it("returns true when origin is null (local transact without origin)", () => {
		expect(isLocalOrigin(null, { provider: true })).toBe(true);
	});

	it("returns true when origin is undefined", () => {
		expect(isLocalOrigin(undefined, { provider: true })).toBe(true);
	});

	it("returns true for a local YSyncConfig-like object (not the provider)", () => {
		const provider = { role: "provider" };
		const ySyncConfig = { role: "y-codemirror" };
		expect(isLocalOrigin(ySyncConfig, provider)).toBe(true);
	});

	it("returns true for local string origins like disk-sync or vault-crdt-seed", () => {
		const provider = { role: "provider" };
		expect(isLocalOrigin("disk-sync", provider)).toBe(true);
		expect(isLocalOrigin("vault-crdt-seed", provider)).toBe(true);
		expect(isLocalOrigin("snapshot-restore", provider)).toBe(true);
	});

	it("returns true when provider is undefined (pre-YAOS init)", () => {
		expect(isLocalOrigin("anything", undefined)).toBe(true);
		expect(isLocalOrigin(null, undefined)).toBe(true);
	});

	it("returns false only for reference equality, not structural equality", () => {
		const provider = { id: 1 };
		const lookalike = { id: 1 };
		expect(isLocalOrigin(lookalike, provider)).toBe(true);
	});

	it("treats a null provider as 'no provider known', not as a sentinel matching null origins", () => {
		// Guards against fail-closed behavior if a caller ever passes provider=null
		// directly (bypassing the `?? undefined` normalization in the capture path).
		expect(isLocalOrigin(null, null)).toBe(true);
		expect(isLocalOrigin("anything", null)).toBe(true);
	});
});

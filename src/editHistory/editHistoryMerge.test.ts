import { describe, it, expect, vi } from "vitest";
import { loadMergedEntry } from "./editHistoryMerge";
import type { VersionSnapshot } from "./types";

function makeMockVault(files: Map<string, string>) {
	return {
		adapter: {
			exists: vi.fn(async (p: string) => files.has(p) || p === ".yaos-extension"),
			read: vi.fn(async (p: string) => files.get(p) ?? ""),
			list: vi.fn(async () => ({
				files: Array.from(files.keys()),
				folders: [],
			})),
		},
	} as any;
}

describe("loadMergedEntry", () => {
	it("merges versions across two device files in ts order", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
			version: 3,
			entries: {
				fX: {
					path: "notes/x.md",
					baseIndex: 0,
					versions: [{ ts: 1, device: "alpha", content: "alpha-v1" }],
				},
			},
		}));
		files.set(".yaos-extension/edit-history-beta.json", JSON.stringify({
			version: 3,
			entries: {
				fX: {
					path: "notes/x.md",
					baseIndex: 0,
					versions: [{ ts: 2, device: "beta", content: "beta-v1" }],
				},
			},
		}));

		const mockVault = makeMockVault(files);

		const merged = await loadMergedEntry(mockVault, "fX");
		expect(merged).not.toBeNull();
		expect(merged!.path).toBe("notes/x.md");
		expect(merged!.versions.map((v: VersionSnapshot) => v.device)).toEqual(["alpha", "beta"]);
		expect(merged!.absoluteContents).toEqual(["alpha-v1", "beta-v1"]);
	});

	it("returns null when no device file contains the fileId", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
			version: 3,
			entries: { other: { path: "p", baseIndex: 0, versions: [{ ts: 1, device: "a", content: "x" }] } },
		}));
		const mockVault = makeMockVault(files);
		expect(await loadMergedEntry(mockVault, "fX")).toBeNull();
	});

	it("skips files whose version !== 3", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history-old.json", JSON.stringify({ version: 2, entries: {} }));
		files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
			version: 3,
			entries: { fX: { path: "a.md", baseIndex: 0, versions: [{ ts: 5, device: "a", content: "keep" }] } },
		}));
		const mockVault = makeMockVault(files);
		const merged = await loadMergedEntry(mockVault, "fX");
		expect(merged!.absoluteContents).toEqual(["keep"]);
	});

	it("skips a file whose JSON is corrupt without failing the merge", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history-bad.json", "{ this is not json");
		files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
			version: 3,
			entries: { fX: { path: "a.md", baseIndex: 0, versions: [{ ts: 1, device: "a", content: "ok" }] } },
		}));
		const mockVault = makeMockVault(files);
		const merged = await loadMergedEntry(mockVault, "fX");
		expect(merged!.absoluteContents).toEqual(["ok"]);
	});

	it("reconstructs device-local deltas before merging", async () => {
		const files = new Map<string, string>();
		files.set(".yaos-extension/edit-history-alpha.json", JSON.stringify({
			version: 3,
			entries: {
				fX: {
					path: "a.md",
					baseIndex: 0,
					versions: [
						{ ts: 1, device: "a", content: "line1\nline2" },
						// a adds "line3" on top of its own v0. Hunk: s=2, d=0, a=["line3"]
						{ ts: 3, device: "a", hunks: [{ s: 2, d: 0, a: ["line3"] }] },
					],
				},
			},
		}));
		files.set(".yaos-extension/edit-history-beta.json", JSON.stringify({
			version: 3,
			entries: {
				fX: {
					path: "a.md",
					baseIndex: 0,
					versions: [{ ts: 2, device: "b", content: "beta-abs" }],
				},
			},
		}));
		const mockVault = makeMockVault(files);
		const merged = await loadMergedEntry(mockVault, "fX");
		// Ordered by ts: alpha[0]=1, beta=2, alpha[1]=3
		expect(merged!.sourceDeviceIds).toEqual(["alpha", "beta", "alpha"]);
		expect(merged!.absoluteContents).toEqual([
			"line1\nline2",
			"beta-abs",
			"line1\nline2\nline3",  // alpha[1] reconstructed inside alpha's chain
		]);
	});
});

import { describe, it, expect, vi } from "vitest";
import { loadMergedEntry } from "./editHistoryMerge";

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

		const mockVault = {
			adapter: {
				exists: vi.fn(async (p: string) => files.has(p) || p === ".yaos-extension"),
				read: vi.fn(async (p: string) => files.get(p) ?? ""),
				list: vi.fn(async () => ({
					files: Array.from(files.keys()),
					folders: [],
				})),
			},
		};

		const merged = await loadMergedEntry(mockVault as any, "fX");
		expect(merged).not.toBeNull();
		expect(merged!.path).toBe("notes/x.md");
		expect(merged!.versions.map((v) => v.device)).toEqual(["alpha", "beta"]);
		expect(merged!.absoluteContents).toEqual(["alpha-v1", "beta-v1"]);
	});
});

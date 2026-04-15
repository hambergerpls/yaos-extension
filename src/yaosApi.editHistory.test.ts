import { describe, it, expect, vi } from "vitest";
import {
	getYDoc,
	getVaultSync,
	getFileId,
	getFilePath,
} from "./yaosApi";

function makeFakeApp(yaosPlugin: unknown) {
	return { plugins: { getPlugin: vi.fn(() => yaosPlugin) } } as any;
}

describe("getYDoc", () => {
	it("returns the Y.Doc when vaultSync.ydoc exists", () => {
		const mockDoc = { on: vi.fn() };
		const app = makeFakeApp({ vaultSync: { ydoc: mockDoc } });
		expect(getYDoc(app)).toBe(mockDoc);
	});

	it("returns null when YAOS plugin is not installed", () => {
		const app = makeFakeApp(null);
		expect(getYDoc(app)).toBeNull();
	});

	it("returns null when vaultSync is missing", () => {
		const app = makeFakeApp({});
		expect(getYDoc(app)).toBeNull();
	});

	it("returns null when ydoc is missing", () => {
		const app = makeFakeApp({ vaultSync: {} });
		expect(getYDoc(app)).toBeNull();
	});
});

describe("getVaultSync", () => {
	it("returns vaultSync when present", () => {
		const vaultSync = { ydoc: {}, provider: {} };
		const app = makeFakeApp({ vaultSync });
		expect(getVaultSync(app)).toBe(vaultSync);
	});

	it("returns null when YAOS plugin is not installed", () => {
		const app = makeFakeApp(null);
		expect(getVaultSync(app)).toBeNull();
	});

	it("returns null when vaultSync is missing", () => {
		const app = makeFakeApp({});
		expect(getVaultSync(app)).toBeNull();
	});
});

describe("getFileId", () => {
	it("returns the file ID for a known path", () => {
		const app = makeFakeApp({
			vaultSync: { getFileId: vi.fn((p: string) => p === "notes/test.md" ? "abc123" : undefined) },
		});
		expect(getFileId(app, "notes/test.md")).toBe("abc123");
	});

	it("returns undefined for an unknown path", () => {
		const app = makeFakeApp({
			vaultSync: { getFileId: vi.fn(() => undefined) },
		});
		expect(getFileId(app, "unknown.md")).toBeUndefined();
	});

	it("returns undefined when YAOS plugin is missing", () => {
		const app = makeFakeApp(null);
		expect(getFileId(app, "test.md")).toBeUndefined();
	});

	it("returns undefined when vaultSync is missing", () => {
		const app = makeFakeApp({});
		expect(getFileId(app, "test.md")).toBeUndefined();
	});
});

describe("getFilePath", () => {
	it("returns the path for a known file ID via idToText", () => {
		const app = makeFakeApp({
			vaultSync: {
				meta: {
					get: vi.fn(() => ({ path: "notes/test.md" })),
				},
			},
		});
		expect(getFilePath(app, "abc123")).toBe("notes/test.md");
	});

	it("returns undefined when file ID is not in meta", () => {
		const app = makeFakeApp({
			vaultSync: {
				meta: { get: vi.fn(() => undefined) },
			},
		});
		expect(getFilePath(app, "unknown")).toBeUndefined();
	});

	it("returns undefined when meta entry has no path", () => {
		const app = makeFakeApp({
			vaultSync: {
				meta: { get: vi.fn(() => ({ device: "Dev1" })) },
			},
		});
		expect(getFilePath(app, "abc123")).toBeUndefined();
	});

	it("returns undefined when YAOS plugin is missing", () => {
		const app = makeFakeApp(null);
		expect(getFilePath(app, "abc123")).toBeUndefined();
	});

	it("returns undefined when vaultSync is missing", () => {
		const app = makeFakeApp({});
		expect(getFilePath(app, "abc123")).toBeUndefined();
	});
});

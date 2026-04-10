import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeviceStore } from "./deviceStore";
import type { DeviceRecord } from "./deviceStore";

const DEVICE_FILE = ".yaos-extension/devices.json";

function makeVault(files: Record<string, string> = {}) {
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

function deviceFileContent(devices: Record<string, DeviceRecord>): string {
  return JSON.stringify({ devices }, null, 2);
}

describe("DeviceStore", () => {
  let vault: ReturnType<typeof makeVault>;
  let files: Record<string, string>;
  let store: DeviceStore;

  beforeEach(() => {
    files = {};
    vault = makeVault(files);
    store = new DeviceStore(vault);
  });

  describe("load", () => {
    it("returns empty object when file does not exist", async () => {
      const registry = await store.load();
      expect(registry).toEqual({});
    });

    it("returns empty object when file has invalid JSON", async () => {
      files[DEVICE_FILE] = "not json";
      const registry = await store.load();
      expect(registry).toEqual({});
    });

    it("returns empty object when file has no devices key", async () => {
      files[DEVICE_FILE] = JSON.stringify({});
      const registry = await store.load();
      expect(registry).toEqual({});
    });

    it("returns devices from file", async () => {
      const now = Date.now();
      files[DEVICE_FILE] = deviceFileContent({
        "Alice-Laptop": { firstSeen: now, lastSeen: now, color: "#ff0000" },
        "Bob-Phone": { firstSeen: now - 1000, lastSeen: now, color: "#00ff00" },
      });
      const registry = await store.load();
      expect(Object.keys(registry)).toHaveLength(2);
      expect(registry["Alice-Laptop"]!.color).toBe("#ff0000");
      expect(registry["Bob-Phone"]!.color).toBe("#00ff00");
    });
  });

  describe("save", () => {
    it("creates the .yaos-extension folder if it does not exist", async () => {
      const registry: Record<string, DeviceRecord> = {};
      await store.save(registry);
      expect(vault.adapter.mkdir).toHaveBeenCalledWith(".yaos-extension");
    });

    it("does not create folder if it already exists", async () => {
      files[".yaos-extension"] = "";
      const registry: Record<string, DeviceRecord> = {};
      await store.save(registry);
      expect(vault.adapter.mkdir).not.toHaveBeenCalled();
    });

    it("writes devices as JSON", async () => {
      const now = Date.now();
      const registry: Record<string, DeviceRecord> = {
        "Alice": { firstSeen: now, lastSeen: now, color: "#ff0000" },
      };
      await store.save(registry);
      expect(vault.adapter.write).toHaveBeenCalledWith(
        DEVICE_FILE,
        deviceFileContent(registry),
      );
    });
  });

  describe("registerDevice", () => {
    it("adds a new device to an empty registry", async () => {
      await store.registerDevice("Alice-Laptop", "#ff0000");
      const written = JSON.parse(files[DEVICE_FILE]!);
      expect(written.devices["Alice-Laptop"]).toBeDefined();
      expect(written.devices["Alice-Laptop"].color).toBe("#ff0000");
      expect(written.devices["Alice-Laptop"].firstSeen).toBeGreaterThan(0);
      expect(written.devices["Alice-Laptop"].lastSeen).toBeGreaterThan(0);
    });

    it("updates lastSeen and color for an existing device", async () => {
      const oldTime = 1000;
      files[DEVICE_FILE] = deviceFileContent({
        "Alice-Laptop": { firstSeen: oldTime, lastSeen: oldTime, color: "#ff0000" },
      });

      await store.registerDevice("Alice-Laptop", "#00ff00");

      const written = JSON.parse(files[DEVICE_FILE]);
      const record = written.devices["Alice-Laptop"];
      expect(record.firstSeen).toBe(oldTime);
      expect(record.lastSeen).toBeGreaterThan(oldTime);
      expect(record.color).toBe("#00ff00");
    });

    it("preserves other devices when adding a new one", async () => {
      const now = Date.now();
      files[DEVICE_FILE] = deviceFileContent({
        "Alice-Laptop": { firstSeen: now, lastSeen: now, color: "#ff0000" },
      });

      await store.registerDevice("Bob-Phone", "#00ff00");

      const written = JSON.parse(files[DEVICE_FILE]);
      expect(Object.keys(written.devices)).toHaveLength(2);
      expect(written.devices["Alice-Laptop"].color).toBe("#ff0000");
      expect(written.devices["Bob-Phone"].color).toBe("#00ff00");
    });
  });
});

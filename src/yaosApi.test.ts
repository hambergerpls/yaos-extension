import { describe, it, expect, vi } from "vitest";
import {
  getAwareness,
  isYaosAvailable,
  isYaosConnected,
  getRemotePeers,
  getLocalDeviceName,
  getDeviceRegistry,
  getAllKnownDevices,
  type AwarenessLike,
  type DeviceRecord,
  type KnownDevice,
} from "./yaosApi";

function makeFakeApp(yaosPlugin: unknown) {
  return { plugins: { getPlugin: vi.fn(() => yaosPlugin) } } as any;
}

function makeAwareness(
  clientId: number,
  states: Map<number, Record<string, unknown>>
): AwarenessLike {
  const listeners = new Map<string, Set<Function>>();
  return {
    clientID: clientId,
    states,
    getStates: () => states,
    getLocalState: () => states.get(clientId) ?? null,
    on: (event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    },
  };
}

describe("isYaosAvailable", () => {
  it("returns true when YAOS plugin is present", () => {
    const app = makeFakeApp({ vaultSync: {} });
    expect(isYaosAvailable(app)).toBe(true);
  });

  it("returns false when YAOS plugin is not found", () => {
    const app = makeFakeApp(null);
    expect(isYaosAvailable(app)).toBe(false);
  });

  it("returns false when app.plugins throws", () => {
    const app = { plugins: { getPlugin: () => { throw new Error("nope"); } } } as any;
    expect(isYaosAvailable(app)).toBe(false);
  });
});

describe("getAwareness", () => {
  it("returns awareness when the full access path exists", () => {
    const states = new Map();
    const awareness = makeAwareness(1, states);
    const app = makeFakeApp({ vaultSync: { provider: { awareness } } });
    expect(getAwareness(app)).toBe(awareness);
  });

  it("returns null when YAOS plugin is not installed", () => {
    const app = makeFakeApp(null);
    expect(getAwareness(app)).toBeNull();
  });

  it("returns null when vaultSync is missing", () => {
    const app = makeFakeApp({});
    expect(getAwareness(app)).toBeNull();
  });

  it("returns null when provider is missing", () => {
    const app = makeFakeApp({ vaultSync: {} });
    expect(getAwareness(app)).toBeNull();
  });

  it("returns null when awareness is missing", () => {
    const app = makeFakeApp({ vaultSync: { provider: {} } });
    expect(getAwareness(app)).toBeNull();
  });

  it("returns null when awareness has no getStates", () => {
    const app = makeFakeApp({ vaultSync: { provider: { awareness: {} } } });
    expect(getAwareness(app)).toBeNull();
  });
});

describe("isYaosConnected", () => {
  it("returns true when wsconnected is true", () => {
    const app = makeFakeApp({ vaultSync: { provider: { wsconnected: true } } });
    expect(isYaosConnected(app)).toBe(true);
  });

  it("returns false when wsconnected is false", () => {
    const app = makeFakeApp({ vaultSync: { provider: { wsconnected: false } } });
    expect(isYaosConnected(app)).toBe(false);
  });

  it("returns false when plugin is missing", () => {
    const app = makeFakeApp(null);
    expect(isYaosConnected(app)).toBe(false);
  });
});

describe("getRemotePeers", () => {
  it("excludes the local client", () => {
    const states = new Map([
      [1, { user: { name: "Me", color: "#fff", colorLight: "#fff33" } }],
    ]);
    const awareness = makeAwareness(1, states);
    expect(getRemotePeers(awareness)).toEqual([]);
  });

  it("returns remote peers with user info", () => {
    const states = new Map([
      [1, { user: { name: "Me", color: "#fff", colorLight: "#fff33" } }],
      [2, { user: { name: "Alice", color: "#f00", colorLight: "#f0033" } }],
    ]);
    const awareness = makeAwareness(1, states);
    const peers = getRemotePeers(awareness);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({
      clientId: 2,
      name: "Alice",
      color: "#f00",
      colorLight: "#f0033",
      hasCursor: false,
    });
  });

  it("defaults to Anonymous when user name is missing", () => {
    const states = new Map([
      [1, {}],
      [2, {}],
    ]);
    const awareness = makeAwareness(1, states);
    const peers = getRemotePeers(awareness);
    expect(peers).toHaveLength(1);
    expect(peers[0]!.name).toBe("Anonymous");
  });

  it("detects hasCursor when cursor is present", () => {
    const states = new Map([
      [1, {}],
      [2, { user: { name: "Bob", color: "#0f0", colorLight: "#0f033" }, cursor: { anchor: 0, head: 5 } }],
    ]);
    const awareness = makeAwareness(1, states);
    const peers = getRemotePeers(awareness);
    expect(peers[0]!.hasCursor).toBe(true);
  });

  it("reports hasCursor false when cursor is null", () => {
    const states = new Map([
      [1, {}],
      [2, { user: { name: "Bob", color: "#0f0", colorLight: "#0f033" }, cursor: null }],
    ]);
    const awareness = makeAwareness(1, states);
    const peers = getRemotePeers(awareness);
    expect(peers[0]!.hasCursor).toBe(false);
  });
});

describe("getLocalDeviceName", () => {
  it("returns the device name from YAOS settings", () => {
    const app = makeFakeApp({ settings: { deviceName: "MyLaptop" } });
    expect(getLocalDeviceName(app)).toBe("MyLaptop");
  });

  it("returns Unknown when plugin is missing", () => {
    const app = makeFakeApp(null);
    expect(getLocalDeviceName(app)).toBe("Unknown");
  });

  it("returns Unknown when deviceName is not set", () => {
    const app = makeFakeApp({ settings: {} });
    expect(getLocalDeviceName(app)).toBe("Unknown");
  });
});

function makeDevicesMap(entries: [string, DeviceRecord][]): Map<string, DeviceRecord> {
  return new Map(entries);
}

describe("getDeviceRegistry", () => {
  it("returns null when YAOS plugin is not installed", () => {
    const app = makeFakeApp(null);
    expect(getDeviceRegistry(app)).toBeNull();
  });

  it("returns null when vaultSync is missing", () => {
    const app = makeFakeApp({});
    expect(getDeviceRegistry(app)).toBeNull();
  });

  it("returns null when devices map is missing", () => {
    const app = makeFakeApp({ vaultSync: {} });
    expect(getDeviceRegistry(app)).toBeNull();
  });

  it("returns empty map when devices map has no entries", () => {
    const devicesMap = makeDevicesMap([]);
    const app = makeFakeApp({ vaultSync: { devices: devicesMap } });
    const result = getDeviceRegistry(app);
    expect(result).not.toBeNull();
    expect(result!.size).toBe(0);
  });

  it("returns a copy of the device registry entries", () => {
    const now = Date.now();
    const record: DeviceRecord = { firstSeen: now, lastSeen: now, color: "#ff0000" };
    const devicesMap = makeDevicesMap([["Alice-Laptop", record]]);
    const app = makeFakeApp({ vaultSync: { devices: devicesMap } });

    const result = getDeviceRegistry(app);
    expect(result).not.toBeNull();
    expect(result!.size).toBe(1);
    const entry = result!.get("Alice-Laptop")!;
    expect(entry.firstSeen).toBe(now);
    expect(entry.lastSeen).toBe(now);
    expect(entry.color).toBe("#ff0000");
  });

  it("returns multiple entries", () => {
    const now = Date.now();
    const devicesMap = makeDevicesMap([
      ["Alice-Laptop", { firstSeen: now, lastSeen: now, color: "#ff0000" }],
      ["Bob-Phone", { firstSeen: now - 1000, lastSeen: now, color: "#00ff00" }],
    ]);
    const app = makeFakeApp({ vaultSync: { devices: devicesMap } });
    const result = getDeviceRegistry(app);
    expect(result!.size).toBe(2);
    expect(result!.has("Alice-Laptop")).toBe(true);
    expect(result!.has("Bob-Phone")).toBe(true);
  });
});

describe("getAllKnownDevices", () => {
  function makeAppWithDevices(devices: [string, DeviceRecord][] | null, localName = "MyDevice") {
    const vaultSync: Record<string, unknown> = {};
    if (devices !== null) {
      vaultSync.devices = makeDevicesMap(devices);
    }
    return makeFakeApp({ vaultSync, settings: { deviceName: localName } });
  }

  it("returns online peers when no registry exists", () => {
    const app = makeAppWithDevices(null);
    const states = new Map([
      [1, { user: { name: "Me", color: "#fff", colorLight: "#fff33" } }],
      [2, { user: { name: "Alice", color: "#f00", colorLight: "#f0033" } }],
    ]);
    const awareness = makeAwareness(1, states);

    const devices = getAllKnownDevices(app, awareness);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toEqual({
      name: "Alice",
      color: "#f00",
      colorLight: "#f0033",
      online: true,
      hasCursor: false,
    });
  });

  it("returns empty array when no awareness and no registry", () => {
    const app = makeAppWithDevices(null);
    const devices = getAllKnownDevices(app, null);
    expect(devices).toEqual([]);
  });

  it("merges online peers with offline devices from registry", () => {
    const now = Date.now();
    const app = makeAppWithDevices([
      ["Alice-Laptop", { firstSeen: now, lastSeen: now, color: "#ff0000" }],
      ["Bob-Phone", { firstSeen: now, lastSeen: now, color: "#00ff00" }],
    ]);
    const states = new Map([
      [1, { user: { name: "Me", color: "#fff", colorLight: "#fff33" } }],
      [2, { user: { name: "Alice-Laptop", color: "#ff0000", colorLight: "#ff000033" } }],
    ]);
    const awareness = makeAwareness(1, states);

    const devices = getAllKnownDevices(app, awareness);
    expect(devices).toHaveLength(2);

    const online = devices.find(d => d.name === "Alice-Laptop")!;
    expect(online.online).toBe(true);
    expect(online.hasCursor).toBe(false);
    expect(online.color).toBe("#ff0000");

    const offline = devices.find(d => d.name === "Bob-Phone")!;
    expect(offline.online).toBe(false);
    expect(offline.hasCursor).toBe(false);
    expect(offline.color).toBe("#00ff00");
  });

  it("does not duplicate a device that is both online and in registry", () => {
    const now = Date.now();
    const app = makeAppWithDevices([
      ["Alice-Laptop", { firstSeen: now, lastSeen: now, color: "#ff0000" }],
    ]);
    const states = new Map([
      [1, { user: { name: "Me", color: "#fff", colorLight: "#fff33" } }],
      [2, { user: { name: "Alice-Laptop", color: "#ff0000", colorLight: "#ff000033" } }],
    ]);
    const awareness = makeAwareness(1, states);

    const devices = getAllKnownDevices(app, awareness);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toBe("Alice-Laptop");
    expect(devices[0]!.online).toBe(true);
  });

  it("excludes the local device from offline registry entries", () => {
    const now = Date.now();
    const app = makeAppWithDevices([
      ["MyDevice", { firstSeen: now, lastSeen: now, color: "#30bced" }],
      ["Alice-Laptop", { firstSeen: now, lastSeen: now, color: "#ff0000" }],
    ], "MyDevice");

    const states = new Map([
      [1, { user: { name: "MyDevice", color: "#30bced", colorLight: "#30bced33" } }],
    ]);
    const awareness = makeAwareness(1, states);

    const devices = getAllKnownDevices(app, awareness);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toBe("Alice-Laptop");
    expect(devices[0]!.online).toBe(false);
  });

  it("places online peers before offline devices", () => {
    const now = Date.now();
    const app = makeAppWithDevices([
      ["Alice-Laptop", { firstSeen: now, lastSeen: now, color: "#ff0000" }],
    ]);
    const states = new Map([
      [1, { user: { name: "Me", color: "#fff", colorLight: "#fff33" } }],
      [2, { user: { name: "Bob-Phone", color: "#00ff00", colorLight: "#00ff0033" } }],
    ]);
    const awareness = makeAwareness(1, states);

    const devices = getAllKnownDevices(app, awareness);
    expect(devices).toHaveLength(2);
    expect(devices[0]!.name).toBe("Bob-Phone");
    expect(devices[0]!.online).toBe(true);
    expect(devices[1]!.name).toBe("Alice-Laptop");
    expect(devices[1]!.online).toBe(false);
  });

  it("detects hasCursor from awareness for online peers", () => {
    const now = Date.now();
    const app = makeAppWithDevices([]);
    const states = new Map([
      [1, { user: { name: "Me", color: "#fff", colorLight: "#fff33" } }],
      [2, {
        user: { name: "Alice", color: "#f00", colorLight: "#f0033" },
        cursor: { anchor: 10, head: 20 },
      }],
    ]);
    const awareness = makeAwareness(1, states);

    const devices = getAllKnownDevices(app, awareness);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.hasCursor).toBe(true);
  });

  it("sets colorLight for offline devices with 33 suffix", () => {
    const now = Date.now();
    const app = makeAppWithDevices([
      ["Alice", { firstSeen: now, lastSeen: now, color: "#ff0000" }],
    ]);

    const devices = getAllKnownDevices(app, null);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.colorLight).toBe("#ff000033");
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  getAwareness,
  isYaosAvailable,
  isYaosConnected,
  getRemotePeers,
  getLocalDeviceName,
  type AwarenessLike,
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

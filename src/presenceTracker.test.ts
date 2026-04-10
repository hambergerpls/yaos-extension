import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PresenceTracker } from "./presenceTracker";
import { type AwarenessLike, type RemotePeer } from "./yaosApi";

vi.mock("./yaosApi", () => ({
  getAwareness: vi.fn(),
  isYaosAvailable: vi.fn(),
  getRemotePeers: vi.fn(),
}));

import { getAwareness, isYaosAvailable, getRemotePeers } from "./yaosApi";
const mockedGetAwareness = vi.mocked(getAwareness);
const mockedIsYaosAvailable = vi.mocked(isYaosAvailable);
const mockedGetRemotePeers = vi.mocked(getRemotePeers);

function makeFakeApp() {
  return {} as any;
}

function makeMockAwareness(clientId = 1): AwarenessLike {
  const listeners = new Map<string, Set<Function>>();
  const result: AwarenessLike = {
    clientID: clientId,
    states: new Map(),
    getStates: () => new Map(),
    getLocalState: () => null,
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),
  };
  (result as any)._listeners = listeners;
  return result;
}

const fakePeers: RemotePeer[] = [
  { clientId: 2, name: "Alice", color: "#f00", colorLight: "#f0033", hasCursor: true },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockedGetRemotePeers.mockReturnValue(fakePeers);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PresenceTracker", () => {
  it("is not ready before start", () => {
    const tracker = new PresenceTracker(makeFakeApp());
    expect(tracker.isReady).toBe(false);
  });

  it("connects immediately when YAOS is available and awareness exists", () => {
    const awareness = makeMockAwareness();
    mockedIsYaosAvailable.mockReturnValue(true);
    mockedGetAwareness.mockReturnValue(awareness);

    const onChange = vi.fn();
    const tracker = new PresenceTracker(makeFakeApp());
    tracker.start(onChange);

    expect(tracker.isReady).toBe(true);
    expect(mockedGetAwareness).toHaveBeenCalled();
    expect(awareness.on).toHaveBeenCalledWith("change", expect.any(Function));
    expect(onChange).toHaveBeenCalledWith(fakePeers, awareness);
  });

  it("subscribes to awareness change events", () => {
    const awareness = makeMockAwareness();
    mockedIsYaosAvailable.mockReturnValue(true);
    mockedGetAwareness.mockReturnValue(awareness);

    const onChange = vi.fn();
    const tracker = new PresenceTracker(makeFakeApp());
    tracker.start(onChange);

    const changeHandler = (awareness.on as any).mock.calls.find(
      (c: any[]) => c[0] === "change"
    )[1];

    changeHandler({ added: [2], updated: [], removed: [] }, null);

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(mockedGetRemotePeers).toHaveBeenCalledWith(awareness);
  });

  it("polls when YAOS is not yet available, then connects", () => {
    mockedIsYaosAvailable.mockReturnValue(false);
    const awareness = makeMockAwareness();

    const onChange = vi.fn();
    const tracker = new PresenceTracker(makeFakeApp());
    tracker.start(onChange);

    expect(tracker.isReady).toBe(false);

    mockedIsYaosAvailable.mockReturnValue(true);
    mockedGetAwareness.mockReturnValue(awareness);
    vi.advanceTimersByTime(2000);

    expect(tracker.isReady).toBe(true);
    expect(onChange).toHaveBeenCalledWith(fakePeers, awareness);
  });

  it("polls when awareness is not yet available", () => {
    mockedIsYaosAvailable.mockReturnValue(true);
    mockedGetAwareness.mockReturnValue(null);
    const awareness = makeMockAwareness();

    const onChange = vi.fn();
    const tracker = new PresenceTracker(makeFakeApp());
    tracker.start(onChange);

    expect(tracker.isReady).toBe(false);

    mockedGetAwareness.mockReturnValue(awareness);
    vi.advanceTimersByTime(3000);

    expect(tracker.isReady).toBe(true);
    expect(onChange).toHaveBeenCalledWith(fakePeers, awareness);
  });

  it("stops tracking and cleans up on stop()", () => {
    const awareness = makeMockAwareness();
    mockedIsYaosAvailable.mockReturnValue(true);
    mockedGetAwareness.mockReturnValue(awareness);

    const onChange = vi.fn();
    const tracker = new PresenceTracker(makeFakeApp());
    tracker.start(onChange);
    tracker.stop();

    expect(awareness.off).toHaveBeenCalledWith("change", expect.any(Function));
    expect(tracker.isReady).toBe(false);
    expect(tracker.currentAwareness).toBeNull();
  });

  it("clears polling interval on stop()", () => {
    mockedIsYaosAvailable.mockReturnValue(false);

    const tracker = new PresenceTracker(makeFakeApp());
    tracker.start(vi.fn());
    tracker.stop();

    vi.advanceTimersByTime(10000);
    expect(mockedGetAwareness).not.toHaveBeenCalled();
  });

  it("does not fire callback after stop", () => {
    const awareness = makeMockAwareness();
    mockedIsYaosAvailable.mockReturnValue(true);
    mockedGetAwareness.mockReturnValue(awareness);

    const onChange = vi.fn();
    const tracker = new PresenceTracker(makeFakeApp());
    tracker.start(onChange);
    tracker.stop();

    const callCount = onChange.mock.calls.length;

    const changeHandler = (awareness.on as any).mock.calls.find(
      (c: any[]) => c[0] === "change"
    )[1];
    changeHandler({ added: [2], updated: [], removed: [] }, null);

    expect(onChange.mock.calls.length).toBe(callCount);
  });

  it("exposes currentAwareness after connecting", () => {
    const awareness = makeMockAwareness();
    mockedIsYaosAvailable.mockReturnValue(true);
    mockedGetAwareness.mockReturnValue(awareness);

    const tracker = new PresenceTracker(makeFakeApp());
    tracker.start(vi.fn());

    expect(tracker.currentAwareness).toBe(awareness);
  });
});

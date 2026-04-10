import { describe, test, expect, beforeEach, vi } from "vitest";
import { PresenceStatusBar } from "./statusBar";
import type { RemotePeer } from "./yaosApi";
import { DEFAULT_SETTINGS, type YaosExtensionSettings } from "./settings";

const mockPeers: RemotePeer[] = [
  { clientId: 1, name: "Alice", color: "#f00", colorLight: "#f0033", hasCursor: true },
  { clientId: 2, name: "Bob", color: "#0f0", colorLight: "#0f033", hasCursor: false },
];

describe("PresenceStatusBar", () => {
  let statusBarEl: HTMLElement;
  let settings: YaosExtensionSettings;

  beforeEach(() => {
    statusBarEl = document.createElement("div");
    settings = { ...DEFAULT_SETTINGS };
  });

  test("renders disconnected state when not connected and no peers", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update([], false, "Me");
    expect(statusBarEl.textContent).toContain("Not synced");
    const dot = statusBarEl.querySelector(".yaos-extension-dot.disconnected");
    expect(dot).not.toBeNull();
  });

  test("renders 1 device online when connected with no peers", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update([], true, "Me");
    expect(statusBarEl.textContent).toContain("1 device online");
    const dot = statusBarEl.querySelector(".yaos-extension-dot.connected");
    expect(dot).not.toBeNull();
  });

  test("renders peer name when connected with 1 peer", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update([mockPeers[0]!], true, "Me");
    expect(statusBarEl.textContent).toContain("You + Alice");
  });

  test("renders collaborator count when connected with 2+ peers", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update(mockPeers, true, "Me");
    expect(statusBarEl.textContent).toContain("You + 2 collaborators");
  });

  test("renders peer dots when setting enabled", () => {
    settings.showPeerDotsInStatusBar = true;
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update(mockPeers, true, "Me");
    const dots = statusBarEl.querySelectorAll(".yaos-extension-peer-dot");
    expect(dots.length).toBe(2);
  });

  test("does not render peer dots when setting disabled", () => {
    settings.showPeerDotsInStatusBar = false;
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update(mockPeers, true, "Me");
    const dots = statusBarEl.querySelectorAll(".yaos-extension-peer-dot");
    expect(dots.length).toBe(0);
  });

  test("destroy clears status bar content", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update(mockPeers, true, "Me");
    bar.destroy();
    expect(statusBarEl.textContent).toBe("");
  });

  test("connected dot has aria-label", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update([], true, "Me");
    const dot = statusBarEl.querySelector(".yaos-extension-dot");
    expect(dot?.getAttribute("aria-label")).toBe("Sync connected");
  });

  test("disconnected dot has aria-label", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update([], false, "Me");
    const dot = statusBarEl.querySelector(".yaos-extension-dot");
    expect(dot?.getAttribute("aria-label")).toBe("Sync disconnected");
  });
});

describe("PresenceStatusBar notification badge", () => {
  let statusBarEl: HTMLElement;
  let settings: YaosExtensionSettings;

  beforeEach(() => {
    statusBarEl = document.createElement("div");
    settings = { ...DEFAULT_SETTINGS };
  });

  test("shows badge when unreadCount > 0", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update(mockPeers, true, "Me", 3);
    const badge = statusBarEl.querySelector(".yaos-extension-notification-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("3");
  });

  test("does not show badge when unreadCount is 0", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update(mockPeers, true, "Me", 0);
    const badge = statusBarEl.querySelector(".yaos-extension-notification-badge");
    expect(badge).toBeNull();
  });

  test("does not show badge when unreadCount is undefined", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update(mockPeers, true, "Me");
    const badge = statusBarEl.querySelector(".yaos-extension-notification-badge");
    expect(badge).toBeNull();
  });

  test("badge click handler calls provided callback", () => {
    const onClickBadge = vi.fn();
    const bar = new PresenceStatusBar(statusBarEl, settings, onClickBadge);
    bar.update(mockPeers, true, "Me", 5);
    const badge = statusBarEl.querySelector(".yaos-extension-notification-badge") as HTMLElement;
    badge.click();
    expect(onClickBadge).toHaveBeenCalled();
  });

  test("badge is cleaned up on destroy", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update(mockPeers, true, "Me", 3);
    bar.destroy();
    const badge = statusBarEl.querySelector(".yaos-extension-notification-badge");
    expect(badge).toBeNull();
  });

  test("shows badge when disconnected with unread notifications", () => {
    const bar = new PresenceStatusBar(statusBarEl, settings);
    bar.update([], false, "Me", 2);
    const badge = statusBarEl.querySelector(".yaos-extension-notification-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("2");
  });
});

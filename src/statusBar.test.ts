import { describe, it, expect, vi, beforeEach } from "vitest";
import { PresenceStatusBar } from "./statusBar";
import { DEFAULT_SETTINGS } from "./settings";
import { type RemotePeer } from "./yaosApi";

function createContainer(): HTMLElement {
  return document.createElement("div");
}

const alice: RemotePeer = { clientId: 2, name: "Alice", color: "#f00", colorLight: "#f0033", hasCursor: true };
const bob: RemotePeer = { clientId: 3, name: "Bob", color: "#0f0", colorLight: "#0f033", hasCursor: false };

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("PresenceStatusBar", () => {
  it("adds the yaos-extension-statusbar class to the element", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    expect(el.classList.contains("yaos-extension-statusbar")).toBe(true);
  });

  it("renders disconnected state when not connected and no peers", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([], false, "MyDevice");

    expect(el.textContent).toContain("Not synced");
    expect(el.querySelector(".yaos-extension-dot.disconnected")).not.toBeNull();
  });

  it("renders '1 device online' when connected with no peers", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([], true, "MyDevice");

    expect(el.textContent).toContain("1 device online");
    expect(el.querySelector(".yaos-extension-dot.connected")).not.toBeNull();
  });

  it("renders 'You + Alice' with one peer", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice], true, "MyDevice");

    expect(el.textContent).toContain("You + Alice");
  });

  it("renders 'You + N collaborators' with multiple peers", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice, bob], true, "MyDevice");

    expect(el.textContent).toContain("You + 2 collaborators");
  });

  it("shows peer dots when showPeerDotsInStatusBar is true", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice, bob], true, "MyDevice");

    const dots = el.querySelectorAll(".yaos-extension-peer-dot");
    expect(dots.length).toBe(2);
  });

  it("hides peer dots when showPeerDotsInStatusBar is false", () => {
    const el = createContainer();
    const settings = { ...DEFAULT_SETTINGS, showPeerDotsInStatusBar: false };
    const bar = new PresenceStatusBar(el, settings);
    bar.update([alice, bob], true, "MyDevice");

    const dots = el.querySelectorAll(".yaos-extension-peer-dot");
    expect(dots.length).toBe(0);
  });

  it("peer dots have the correct background color", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice], true, "MyDevice");

    const dot = el.querySelector(".yaos-extension-peer-dot") as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("peer dots have aria-label with peer name", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice], true, "MyDevice");

    const dot = el.querySelector(".yaos-extension-peer-dot") as HTMLElement;
    expect(dot.getAttribute("aria-label")).toBe("Alice");
  });

  it("shows tooltip on peer dot mouseenter", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice], true, "MyDevice");

    const dot = el.querySelector(".yaos-extension-peer-dot") as HTMLElement;
    dot.dispatchEvent(new MouseEvent("mouseenter", { clientX: 100, clientY: 200 }));

    const tooltip = document.querySelector(".yaos-extension-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).toContain("Alice");
  });

  it("hides tooltip on peer dot mouseleave", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice], true, "MyDevice");

    const dot = el.querySelector(".yaos-extension-peer-dot") as HTMLElement;
    dot.dispatchEvent(new MouseEvent("mouseenter", { clientX: 100, clientY: 200 }));
    dot.dispatchEvent(new MouseEvent("mouseleave"));

    expect(document.querySelector(".yaos-extension-tooltip")).toBeNull();
  });

  it("shows edit indicator in tooltip for peers with cursor", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice], true, "MyDevice");

    const dot = el.querySelector(".yaos-extension-peer-dot") as HTMLElement;
    dot.dispatchEvent(new MouseEvent("mouseenter", { clientX: 100, clientY: 200 }));

    const tooltip = document.querySelector(".yaos-extension-tooltip")!;
    expect(tooltip.textContent).toContain("\u270E");
  });

  it("destroys cleanly and removes tooltip", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([alice], true, "MyDevice");

    const dot = el.querySelector(".yaos-extension-peer-dot") as HTMLElement;
    dot.dispatchEvent(new MouseEvent("mouseenter", { clientX: 100, clientY: 200 }));

    bar.destroy();

    expect(document.querySelector(".yaos-extension-tooltip")).toBeNull();
    expect(el.innerHTML).toBe("");
  });

  it("connection dot has correct aria-label when connected", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([], true, "MyDevice");

    const dot = el.querySelector(".yaos-extension-dot.connected") as HTMLElement;
    expect(dot.getAttribute("aria-label")).toBe("Sync connected");
  });

  it("connection dot has correct aria-label when disconnected", () => {
    const el = createContainer();
    const bar = new PresenceStatusBar(el, DEFAULT_SETTINGS);
    bar.update([], false, "MyDevice");

    const dot = el.querySelector(".yaos-extension-dot.disconnected") as HTMLElement;
    expect(dot.getAttribute("aria-label")).toBe("Sync disconnected");
  });
});

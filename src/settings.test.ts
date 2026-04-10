import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, type YaosExtensionSettings } from "./settings";

describe("DEFAULT_SETTINGS", () => {
  it("has showCursorNames enabled by default", () => {
    expect(DEFAULT_SETTINGS.showCursorNames).toBe(true);
  });

  it("has showStatusBar enabled by default", () => {
    expect(DEFAULT_SETTINGS.showStatusBar).toBe(true);
  });

  it("has showPeerDotsInStatusBar enabled by default", () => {
    expect(DEFAULT_SETTINGS.showPeerDotsInStatusBar).toBe(true);
  });

  it("has showComments enabled by default", () => {
    expect(DEFAULT_SETTINGS.showComments).toBe(true);
  });

  it("has showNotifications enabled by default", () => {
    expect(DEFAULT_SETTINGS.showNotifications).toBe(true);
  });

  it("satisfies the YaosExtensionSettings interface", () => {
    const s: YaosExtensionSettings = DEFAULT_SETTINGS;
    expect(typeof s.showCursorNames).toBe("boolean");
    expect(typeof s.showStatusBar).toBe("boolean");
    expect(typeof s.showPeerDotsInStatusBar).toBe("boolean");
    expect(typeof s.showComments).toBe("boolean");
    expect(typeof s.showNotifications).toBe("boolean");
  });
});

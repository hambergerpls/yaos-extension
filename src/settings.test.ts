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

describe("edit history settings", () => {
  it("has showEditHistory enabled by default", () => {
    expect(DEFAULT_SETTINGS.showEditHistory).toBe(true);
  });

  it("has editHistoryRetentionDays defaulting to 30", () => {
    expect(DEFAULT_SETTINGS.editHistoryRetentionDays).toBe(30);
  });

  it("has editHistoryMaxPerFilePerDay defaulting to 50", () => {
    expect(DEFAULT_SETTINGS.editHistoryMaxPerFilePerDay).toBe(50);
  });

  it("has editHistoryDebounceMs defaulting to 5000", () => {
    expect(DEFAULT_SETTINGS.editHistoryDebounceMs).toBe(5000);
  });

  it("has editHistoryRebaseInterval defaulting to 10", () => {
    expect(DEFAULT_SETTINGS.editHistoryRebaseInterval).toBe(10);
  });

  it("edit history fields have correct types", () => {
    const s: YaosExtensionSettings = DEFAULT_SETTINGS;
    expect(typeof s.showEditHistory).toBe("boolean");
    expect(typeof s.editHistoryRetentionDays).toBe("number");
    expect(typeof s.editHistoryMaxPerFilePerDay).toBe("number");
    expect(typeof s.editHistoryDebounceMs).toBe("number");
    expect(typeof s.editHistoryRebaseInterval).toBe("number");
  });
});

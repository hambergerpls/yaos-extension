import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { MentionSuggest } from "./mentionSuggest";
import type { KnownDevice } from "../yaosApi";

const mockPeers: KnownDevice[] = [
  { name: "Alice", color: "#ff0000", colorLight: "#ff000033", online: true, hasCursor: true },
  { name: "Bob", color: "#00ff00", colorLight: "#00ff0033", online: true, hasCursor: false },
  { name: "Charlie", color: "#0000ff", colorLight: "#0000ff33", online: false, hasCursor: false },
];

describe("MentionSuggest", () => {
  let textarea: HTMLTextAreaElement;
  let suggest: MentionSuggest;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    textarea = document.createElement("textarea");
    container.appendChild(textarea);
  });

  afterEach(() => {
    suggest?.destroy();
    container.remove();
  });

  function typeText(text: string, cursorPos?: number) {
    textarea.value = text;
    const pos = cursorPos ?? text.length;
    textarea.selectionStart = pos;
    textarea.selectionEnd = pos;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function pressKey(key: string, opts?: KeyboardEventInit) {
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts }));
  }

  test("shows dropdown with all peers when @ is typed", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@");
    const items = document.querySelectorAll(".yaos-extension-mention-item");
    expect(items.length).toBe(3);
  });

  test("filters peers by typed prefix after @", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@Al");
    const items = document.querySelectorAll(".yaos-extension-mention-item");
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain("Alice");
  });

  test("hides dropdown when Escape is pressed", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@");
    pressKey("Escape");
    const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
    expect(dropdown).toBeNull();
  });

  test("inserts @DeviceName on Enter", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@");
    pressKey("Enter");
    expect(textarea.value).toBe("@Alice ");
  });

  test("navigates with arrow keys and selects with Enter", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@");
    pressKey("ArrowDown");
    pressKey("ArrowDown");
    pressKey("Enter");
    expect(textarea.value).toBe("@Charlie ");
  });

  test("selects peer on click", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@");
    const items = document.querySelectorAll(".yaos-extension-mention-item");
    items[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(textarea.value).toBe("@Bob ");
  });

  test("does not show dropdown for regular text", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("hello world");
    const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
    expect(dropdown).toBeNull();
  });

  test("handles @ in middle of text", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("hello @");
    const items = document.querySelectorAll(".yaos-extension-mention-item");
    expect(items.length).toBe(3);
  });

  test("inserts at correct position for @ in middle of text", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("hello @Bo");
    pressKey("Enter");
    expect(textarea.value).toBe("hello @Bob ");
  });

  test("destroy removes dropdown and stops responding", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@");
    suggest.destroy();
    const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
    expect(dropdown).toBeNull();
    typeText("@");
    const newDropdown = document.querySelector(".yaos-extension-mention-dropdown");
    expect(newDropdown).toBeNull();
  });

  test("wraps around on arrow up from first item", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@");
    pressKey("ArrowUp");
    pressKey("Enter");
    expect(textarea.value).toBe("@Charlie ");
  });

  test("filters case-insensitively", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@alice");
    const items = document.querySelectorAll(".yaos-extension-mention-item");
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain("Alice");
  });

  test("does not show dropdown when no peers match", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@xyz");
    const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
    expect(dropdown).toBeNull();
  });

  test("shows each peer with a color dot", () => {
    suggest = new MentionSuggest(textarea, () => mockPeers);
    typeText("@");
    const dots = document.querySelectorAll(".yaos-extension-mention-color-dot");
    expect(dots.length).toBe(3);
    expect((dots[0]! as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  describe("offline devices", () => {
    test("applies offline CSS class to offline devices", () => {
      suggest = new MentionSuggest(textarea, () => mockPeers);
      typeText("@");
      const offlineItems = document.querySelectorAll(".yaos-extension-mention-item.yaos-extension-mention-offline");
      expect(offlineItems.length).toBe(1);
      expect(offlineItems[0]!.textContent).toContain("Charlie");
    });

    test("does not apply offline class to online devices", () => {
      suggest = new MentionSuggest(textarea, () => mockPeers);
      typeText("@");
      const onlineItems = document.querySelectorAll(".yaos-extension-mention-item:not(.yaos-extension-mention-offline)");
      expect(onlineItems.length).toBe(2);
    });

    test("can select an offline device via click", () => {
      suggest = new MentionSuggest(textarea, () => mockPeers);
      typeText("@");
      const items = document.querySelectorAll(".yaos-extension-mention-item");
      items[2]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(textarea.value).toBe("@Charlie ");
    });

    test("can navigate to and select an offline device via keyboard", () => {
      suggest = new MentionSuggest(textarea, () => mockPeers);
      typeText("@");
      pressKey("ArrowDown");
      pressKey("ArrowDown");
      pressKey("Enter");
      expect(textarea.value).toBe("@Charlie ");
    });
  });
});

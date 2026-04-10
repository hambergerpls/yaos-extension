import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { editorMentionExtension } from "./editorMentionPlugin";
import type { RemotePeer } from "../yaosApi";

const PEERS: RemotePeer[] = [
  { clientId: 1, name: "Alice", color: "#ff0000", colorLight: "#ff000033", hasCursor: true },
  { clientId: 2, name: "Bob", color: "#00ff00", colorLight: "#00ff0033", hasCursor: false },
];

function createEditor(getPeers = () => PEERS) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ext = editorMentionExtension(getPeers);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pluginSpec = ext[0] as ViewPlugin<any>;
  const state = EditorState.create({
    doc: "",
    extensions: ext,
  });
  const view = new EditorView({ state, parent });
  return { view, parent, pluginSpec };
}

function cleanup(view: EditorView, parent: HTMLElement) {
  view.destroy();
  parent.remove();
  document.querySelectorAll(".yaos-extension-mention-dropdown").forEach((el) => el.remove());
}

function insertText(view: EditorView, text: string, from = 0) {
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + text.length },
  });
}

function getPlugin(view: EditorView, pluginSpec: ViewPlugin<any>) {
  return view.plugin(pluginSpec) as {
    query: unknown;
    filteredPeers: unknown[];
    activeIndex: number;
    dropdown: HTMLElement | null;
    confirmSelection(): boolean;
    cancel(): boolean;
    moveActive(dir: number): boolean;
  };
}

describe("editorMentionPlugin", () => {
  let view: EditorView;
  let parent: HTMLElement;
  let pluginSpec: ViewPlugin<any>;
  let plugin: ReturnType<typeof getPlugin>;

  beforeEach(() => {
    const result = createEditor();
    view = result.view;
    parent = result.parent;
    pluginSpec = result.pluginSpec;
    plugin = getPlugin(view, pluginSpec);
  });

  afterEach(() => {
    cleanup(view, parent);
  });

  describe("detecting @ mention", () => {
    it("shows dropdown when @ is typed after whitespace", () => {
      insertText(view, "hello @A");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).not.toBeNull();
      const items = dropdown!.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(1);
      expect(items[0]!.textContent).toContain("Alice");
    });

    it("shows dropdown when @ is typed at start of line", () => {
      insertText(view, "@B");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).not.toBeNull();
      const items = dropdown!.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(1);
      expect(items[0]!.textContent).toContain("Bob");
    });

    it("shows all peers when @ is typed with no query text", () => {
      insertText(view, " @");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).not.toBeNull();
      const items = dropdown!.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(2);
    });

    it("ignores @ preceded by non-whitespace (email addresses)", () => {
      insertText(view, "test@example.com");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).toBeNull();
    });

    it("filters peers by name prefix case-insensitively", () => {
      insertText(view, " @aLi");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).not.toBeNull();
      const items = dropdown!.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(1);
      expect(items[0]!.textContent).toContain("Alice");
    });

    it("hides dropdown when no peers match query", () => {
      insertText(view, " @Zzz");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).toBeNull();
    });
  });

  describe("dropdown lifecycle", () => {
    it("hides dropdown when cursor moves away from @ query", () => {
      insertText(view, " @Al");
      expect(document.querySelector(".yaos-extension-mention-dropdown")).not.toBeNull();

      view.dispatch({ selection: { anchor: 0 } });
      expect(document.querySelector(".yaos-extension-mention-dropdown")).toBeNull();
    });

    it("hides dropdown when @ query is deleted", () => {
      insertText(view, " @Al");
      expect(document.querySelector(".yaos-extension-mention-dropdown")).not.toBeNull();

      view.dispatch({
        changes: { from: 1, to: 4, insert: "" },
        selection: { anchor: 1 },
      });
      expect(document.querySelector(".yaos-extension-mention-dropdown")).toBeNull();
    });

    it("hides dropdown when no peers are available", () => {
      const emptyPeers = createEditor(() => []);
      try {
        insertText(emptyPeers.view, " @Al");
        const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
        expect(dropdown).toBeNull();
      } finally {
        cleanup(emptyPeers.view, emptyPeers.parent);
      }
    });
  });

  describe("peer selection via plugin methods", () => {
    it("confirmSelection replaces @query with @DeviceName", () => {
      insertText(view, " @Al");
      expect(document.querySelector(".yaos-extension-mention-dropdown")).not.toBeNull();

      plugin.confirmSelection();

      expect(view.state.doc.toString()).toBe(" @Alice ");
      expect(document.querySelector(".yaos-extension-mention-dropdown")).toBeNull();
    });

    it("cancel closes dropdown without modifying text", () => {
      insertText(view, " @A");
      expect(document.querySelector(".yaos-extension-mention-dropdown")).not.toBeNull();

      plugin.cancel();

      expect(document.querySelector(".yaos-extension-mention-dropdown")).toBeNull();
      expect(view.state.doc.toString()).toBe(" @A");
    });

    it("moveActive(1) highlights the next item", () => {
      insertText(view, " @");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).not.toBeNull();

      plugin.moveActive(1);

      const items = dropdown!.querySelectorAll(".yaos-extension-mention-item");
      expect(items[0]!.classList.contains("active")).toBe(false);
      expect(items[1]!.classList.contains("active")).toBe(true);
    });

    it("moveActive(-1) wraps to last item", () => {
      insertText(view, " @");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).not.toBeNull();

      plugin.moveActive(-1);

      const items = dropdown!.querySelectorAll(".yaos-extension-mention-item");
      expect(items[0]!.classList.contains("active")).toBe(false);
      expect(items[1]!.classList.contains("active")).toBe(true);
    });

    it("moveActive then confirmSelection selects the second peer", () => {
      insertText(view, " @");

      plugin.moveActive(1);
      plugin.confirmSelection();

      expect(view.state.doc.toString()).toBe(" @Bob ");
    });

    it("confirmSelection returns false when dropdown is not visible", () => {
      insertText(view, "hello");
      expect(plugin.confirmSelection()).toBe(false);
      expect(view.state.doc.toString()).toBe("hello");
    });

    it("cancel returns false when dropdown is not visible", () => {
      insertText(view, "hello");
      expect(plugin.cancel()).toBe(false);
    });

    it("moveActive returns false when dropdown is not visible", () => {
      insertText(view, "hello");
      expect(plugin.moveActive(1)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("finds the rightmost @ before cursor when multiple @ on same line", () => {
      insertText(view, "hello @Al @Bo");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).not.toBeNull();
      const items = dropdown!.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(1);
      expect(items[0]!.textContent).toContain("Bob");
    });

    it("shows dropdown for @ at end of document with no text after", () => {
      insertText(view, "hello @");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown");
      expect(dropdown).not.toBeNull();
      const items = dropdown!.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(2);
    });

    it("narrows dropdown when backspacing within query", () => {
      insertText(view, " @Bo");
      expect(document.querySelector(".yaos-extension-mention-dropdown")).not.toBeNull();
      expect(document.querySelectorAll(".yaos-extension-mention-item").length).toBe(1);

      view.dispatch({
        changes: { from: 3, to: 4, insert: "" },
        selection: { anchor: 3 },
      });
      const items = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(1);

      view.dispatch({
        changes: { from: 2, to: 3, insert: "" },
        selection: { anchor: 2 },
      });
      const items2 = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items2.length).toBe(2);
    });
  });

  describe("dropdown positioning and styling", () => {
    it("positions dropdown using fixed positioning", () => {
      insertText(view, " @A");
      const dropdown = document.querySelector(".yaos-extension-mention-dropdown") as HTMLElement;
      expect(dropdown).not.toBeNull();
      expect(dropdown.style.position).toBe("fixed");
    });

    it("renders color dots with peer colors", () => {
      insertText(view, " @");
      const dots = document.querySelectorAll(".yaos-extension-mention-color-dot");
      expect(dots.length).toBe(2);
      expect((dots[0] as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
      expect((dots[1] as HTMLElement).style.backgroundColor).toBe("rgb(0, 255, 0)");
    });
  });
});

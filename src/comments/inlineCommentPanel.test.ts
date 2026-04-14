import { describe, it, expect, vi, beforeEach } from "vitest";
import { InlineCommentPanel } from "./inlineCommentPanel";
import { CommentStore } from "./commentStore";
import type { CommentThread, Comment } from "./types";

function makeStore(threads: CommentThread[]) {
  return {
    getThreadsForFile: vi.fn(async () => threads),
  } as unknown as CommentStore;
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    type: "comment",
    id: "comment-1",
    text: "This looks good",
    author: "Alice",
    authorColor: "#f00",
    createdAt: Date.now() - 60000,
    rangeText: "selected text",
    rangeContext: "some context before selected text and after",
    rangeOffset: 20,
    rangeLength: 13,
    resolved: false,
    mentions: [],
    ...overrides,
  };
}

function createPanel(threads: CommentThread[], callbacks?: Record<string, unknown>): InlineCommentPanel {
  const store = makeStore(threads);
  const app = {
    workspace: {
      getLeavesOfType: vi.fn(() => []),
      openLinkText: vi.fn(),
    },
    vault: {
      adapter: {
        exists: vi.fn(),
        read: vi.fn(),
      },
    },
  } as any;

  return new InlineCommentPanel(store, app, callbacks);
}

function createContainer(): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="cm-scroller">
      <div class="cm-sizer">
        <div class="inline-title"></div>
        <div class="cm-contentContainer">
          <div class="cm-content"></div>
        </div>
      </div>
    </div>
  `;
  return container;
}

function createContainerWithMetadata(): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="cm-scroller">
      <div class="cm-sizer">
        <div class="inline-title"></div>
        <div class="metadata-container"></div>
        <div class="cm-contentContainer">
          <div class="cm-content"></div>
        </div>
      </div>
    </div>
  `;
  return container;
}

describe("InlineCommentPanel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("attach/detach", () => {
    it("attaches panel before cm-contentContainer in cm-sizer", () => {
      const panel = createPanel([]);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;
      const contentContainer = container.querySelector(".cm-contentContainer")!;

      panel.attach(scroller as HTMLElement);

      const panelEl = container.querySelector(".yaos-extension-inline-comment-panel");
      expect(panelEl).not.toBeNull();
      expect(contentContainer.previousElementSibling).toBe(panelEl);
    });

    it("does not attach twice if already attached", () => {
      const panel = createPanel([]);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      panel.attach(scroller as HTMLElement);

      const panels = container.querySelectorAll(".yaos-extension-inline-comment-panel");
      expect(panels.length).toBe(1);
    });

    it("detaches panel from DOM", () => {
      const panel = createPanel([]);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      panel.detach();

      const panelEl = container.querySelector(".yaos-extension-inline-comment-panel");
      expect(panelEl).toBeNull();
    });

    it("detach is safe when not attached", () => {
      const panel = createPanel([]);
      expect(() => panel.detach()).not.toThrow();
    });

    it("attaches between metadata-container and cm-contentContainer", () => {
      const panel = createPanel([]);
      const container = createContainerWithMetadata();
      const scroller = container.querySelector(".cm-scroller")!;
      const metadata = container.querySelector(".metadata-container")!;
      const contentContainer = container.querySelector(".cm-contentContainer")!;

      panel.attach(scroller as HTMLElement);

      const panelEl = container.querySelector(".yaos-extension-inline-comment-panel");
      expect(panelEl).not.toBeNull();
      expect(metadata.nextElementSibling).toBe(panelEl);
      expect(contentContainer.previousElementSibling).toBe(panelEl);
    });
  });

  describe("no collapsible header", () => {
    it("does not render a collapsible header", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header");
      expect(header).toBeNull();
    });

    it("does not render a content wrapper", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const content = container.querySelector(".yaos-extension-inline-comment-content");
      expect(content).toBeNull();
    });
  });

  describe("earliest unresolved only", () => {
    it("renders only the earliest unresolved thread", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
        { comment: makeComment({ id: "c2", author: "Bob" }), replies: [] },
        { comment: makeComment({ id: "c3", author: "Carol" }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const threadCards = container.querySelectorAll(".yaos-extension-comment-thread");
      expect(threadCards.length).toBe(1);
      const authorName = threadCards[0]?.querySelector(".yaos-extension-author-name");
      expect(authorName?.textContent).toBe("Alice");
    });

    it("does not render resolved threads", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const threadCards = container.querySelectorAll(".yaos-extension-comment-thread");
      expect(threadCards.length).toBe(0);
    });

    it("renders the add comment input even when all threads are resolved", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).not.toBeNull();
    });

    it("hides add comment input when there are unresolved threads", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: false }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).toBeNull();
    });

    it("renders the add comment input when there are no threads", async () => {
      const panel = createPanel([]);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).not.toBeNull();
    });

    it("renders thread content immediately without needing to expand", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice", authorColor: "#f00" }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const avatar = container.querySelector(".yaos-extension-avatar");
      expect(avatar).not.toBeNull();
    });

    it("skips the resolved divider", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: false }), replies: [] },
        { comment: makeComment({ id: "c2", resolved: true }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const divider = container.querySelector(".yaos-extension-comment-resolved-divider");
      expect(divider).toBeNull();
    });

    it("does not render empty state message", async () => {
      const panel = createPanel([]);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const empty = container.querySelector(".yaos-extension-comment-empty");
      expect(empty).toBeNull();
    });
  });

  describe("destroy cleanup", () => {
    it("destroys editors on detach", async () => {
      const panel = createPanel([]);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");
      panel.detach();

      const panelEl = container.querySelector(".yaos-extension-inline-comment-panel");
      expect(panelEl).toBeNull();
    });
  });

  describe("pending selection", () => {
    it("delegates setPendingSelection to renderer", async () => {
      const panel = createPanel([], { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      panel.setPendingSelection({
        rangeText: "selected text",
        rangeOffset: 0,
        rangeContext: "some context",
        rangeLength: 13,
      });
      await panel.refresh("test.md");

      const cmEditors = container.querySelectorAll(".cm-editor");
      const commentEditor = cmEditors[0]!;
      const content = commentEditor.querySelector(".cm-content") as HTMLElement;
      expect(content?.textContent).toContain("selected text");
    });
  });
});

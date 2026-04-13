import { describe, it, expect, vi, beforeEach } from "vitest";
import { InlineCommentPanel } from "./inlineCommentPanel";
import { CommentStore } from "./commentStore";
import type { CommentThread, Comment, Reply } from "./types";

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

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    type: "reply",
    id: "reply-1",
    commentId: "comment-1",
    text: "I agree",
    author: "Bob",
    authorColor: "#0f0",
    createdAt: Date.now() - 30000,
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

  describe("collapsible header", () => {
    it("renders a collapsed header showing 'Comments (0)' when no threads", async () => {
      const panel = createPanel([]);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header");
      expect(header).not.toBeNull();
      expect(header?.textContent).toContain("Comments");
      expect(header?.textContent).toContain("0");
    });

    it("renders header with thread count", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
        { comment: makeComment({ id: "c2" }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header");
      expect(header?.textContent).toContain("2");
    });

    it("is collapsed by default — content is hidden", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const content = container.querySelector(".yaos-extension-inline-comment-content");
      expect(content).not.toBeNull();
      expect(content?.classList.contains("expanded")).toBe(false);
    });

    it("expands content when header is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const content = container.querySelector(".yaos-extension-inline-comment-content");
      expect(content?.classList.contains("expanded")).toBe(true);
    });

    it("collapses content when header is clicked again", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();
      header.click();

      const content = container.querySelector(".yaos-extension-inline-comment-content");
      expect(content?.classList.contains("expanded")).toBe(false);
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

  describe("delete comment button", () => {
    it("renders a delete button for the user's own comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onDelete });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const deleteBtn = container.querySelector(".yaos-extension-delete-btn");
      expect(deleteBtn).not.toBeNull();
      expect(deleteBtn?.textContent).toBe("Delete");
    });

    it("does not render a delete button for another user's comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Bob" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onDelete });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const deleteBtn = container.querySelector(".yaos-extension-delete-btn");
      expect(deleteBtn).toBeNull();
    });

    it("calls onDelete with the comment id when delete is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c-42", author: "Alice" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onDelete });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const deleteBtn = container.querySelector(".yaos-extension-delete-btn") as HTMLElement;
      expect(deleteBtn).not.toBeNull();
      deleteBtn.click();

      expect(onDelete).toHaveBeenCalledWith("c-42");
    });
  });

  describe("delete reply button", () => {
    it("renders a delete button for the user's own reply when thread is expanded", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [makeReply({ id: "r-42", commentId: "c1", author: "Alice" })],
        },
      ];
      const onDeleteReply = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onDeleteReply });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const panelHeader = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      panelHeader.click();

      const threadHeader = container.querySelector(".yaos-extension-comment-header") as HTMLElement;
      threadHeader.click();

      const deleteBtn = container.querySelector(".yaos-extension-delete-reply-btn") as HTMLElement;
      expect(deleteBtn).not.toBeNull();
    });

    it("calls onDeleteReply with the reply id when delete is clicked", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [makeReply({ id: "r-99", commentId: "c1", author: "Alice" })],
        },
      ];
      const onDeleteReply = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onDeleteReply });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const panelHeader = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      panelHeader.click();

      const threadHeader = container.querySelector(".yaos-extension-comment-header") as HTMLElement;
      threadHeader.click();

      const deleteBtn = container.querySelector(".yaos-extension-delete-reply-btn") as HTMLElement;
      deleteBtn.click();

      expect(onDeleteReply).toHaveBeenCalledWith("r-99");
    });
  });

  describe("resolve button", () => {
    it("renders a resolve button on each thread", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const onResolve = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onResolve });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const panelHeader = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      panelHeader.click();

      const resolveBtn = container.querySelector(".yaos-extension-resolve-btn") as HTMLElement;
      expect(resolveBtn).not.toBeNull();
      expect(resolveBtn.textContent).toBe("Resolve");
    });

    it("calls onResolve when resolve is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const onResolve = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onResolve });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const panelHeader = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      panelHeader.click();

      const resolveBtn = container.querySelector(".yaos-extension-resolve-btn") as HTMLElement;
      resolveBtn.click();

      expect(onResolve).toHaveBeenCalledWith("c1", true);
    });

    it("renders resolved threads with resolved class", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice", resolved: true }), replies: [] },
      ];
      const panel = createPanel(threads, { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const panelHeader = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      panelHeader.click();

      const thread = container.querySelector(".yaos-extension-comment-thread");
      expect(thread?.classList.contains("resolved")).toBe(true);

      const resolveBtn = container.querySelector(".yaos-extension-resolve-btn");
      expect(resolveBtn?.textContent).toBe("Reopen");
    });
  });

  describe("edit comment button", () => {
    it("renders an edit button for the user's own comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const onEditComment = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onEditComment });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const panelHeader = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      panelHeader.click();

      const editBtn = container.querySelector(".yaos-extension-edit-btn");
      expect(editBtn).not.toBeNull();
      expect(editBtn?.textContent).toBe("Edit");
    });

    it("does not render an edit button for another user's comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Bob" }), replies: [] },
      ];
      const panel = createPanel(threads, { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const panelHeader = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      panelHeader.click();

      const editBtn = container.querySelector(".yaos-extension-edit-btn");
      expect(editBtn).toBeNull();
    });
  });

  describe("CM6 editor integration", () => {
    it("renders a CM6 editor for comment input when expanded", async () => {
      const panel = createPanel([], { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const cmEditor = container.querySelector(".yaos-extension-comment-input .cm-editor");
      expect(cmEditor).not.toBeNull();
    });

    it("cleans up CM6 editors on detach", async () => {
      const panel = createPanel([], { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      expect(container.querySelector(".cm-editor")).not.toBeNull();

      panel.detach();

      expect(document.querySelectorAll(".cm-editor").length).toBe(0);
    });
  });

  describe("draft preservation", () => {
    function getPanelEditors(panel: InlineCommentPanel): any[] {
      return (panel as any).editors;
    }

    it("clears comment input draft when switching to a different file", async () => {
      const panel = createPanel([], { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("file-a.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const editors = getPanelEditors(panel);
      expect(editors.length).toBe(1);
      editors[0].setText("draft for file A");

      await panel.refresh("file-b.md");

      const newEditors = getPanelEditors(panel);
      expect(newEditors.length).toBe(1);
      expect(newEditors[0].getText()).toBe("");
    });

    it("preserves comment input draft when refreshing with the same file", async () => {
      const panel = createPanel([], { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const editors = getPanelEditors(panel);
      expect(editors.length).toBe(1);
      editors[0].setText("my draft comment");

      await panel.refresh("test.md");

      const newEditors = getPanelEditors(panel);
      expect(newEditors.length).toBe(1);
      expect(newEditors[0].getText()).toBe("my draft comment");
    });
  });

  describe("edited indicator", () => {
    it("shows edited indicator on a comment that has been edited", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice", editedAt: 5000 }), replies: [] },
      ];
      const panel = createPanel(threads, { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const edited = container.querySelector(".yaos-extension-edited-indicator");
      expect(edited).not.toBeNull();
      expect(edited?.textContent).toContain("edited");
    });

    it("does not show edited indicator on a comment that has not been edited", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const panel = createPanel(threads, { localDeviceName: "Alice" });
      const container = createContainer();
      const scroller = container.querySelector(".cm-scroller")!;

      panel.attach(scroller as HTMLElement);
      await panel.refresh("test.md");

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const edited = container.querySelector(".yaos-extension-edited-indicator");
      expect(edited).toBeNull();
    });
  });

  describe("pending selection", () => {
    it("sets pending selection text in comment input when expanded", async () => {
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

      const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
      header.click();

      const cmEditors = container.querySelectorAll(".cm-editor");
      const commentEditor = cmEditors[0]!;
      const content = commentEditor.querySelector(".cm-content") as HTMLElement;
      expect(content?.textContent).toContain("selected text");
    });
  });
});

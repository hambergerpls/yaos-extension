import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentView, COMMENTS_VIEW_TYPE } from "./commentView";
import { CommentStore } from "./commentStore";
import type { CommentThread, Comment, Reply } from "./types";

function makeStore(threads: CommentThread[]) {
  return {
    getThreadsForFile: vi.fn(async () => threads),
  } as unknown as CommentStore;
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
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

function createView(threads: CommentThread[], callbacks?: Record<string, unknown>): CommentView {
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

  return new CommentView({} as any, store, app, callbacks);
}

describe("CommentView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("ItemView basics", () => {
    it("returns correct view type", () => {
      const view = createView([]);
      expect(view.getViewType()).toBe(COMMENTS_VIEW_TYPE);
    });

    it("returns display text 'Comments'", () => {
      const view = createView([]);
      expect(view.getDisplayText()).toBe("Comments");
    });

    it("returns icon 'message-square'", () => {
      const view = createView([]);
      expect(view.getIcon()).toBe("message-square");
    });

    it("exports COMMENTS_VIEW_TYPE as 'yaos-extension-comments'", () => {
      expect(COMMENTS_VIEW_TYPE).toBe("yaos-extension-comments");
    });
  });

  describe("lifecycle", () => {
    it("onOpen does not throw", async () => {
      const view = createView([]);
      await expect(view.onOpen()).resolves.toBeUndefined();
    });

    it("onClose cleans up renderer", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const view = createView(threads);
      await view.refresh("test.md");

      await view.onClose();

      expect(document.querySelectorAll(".cm-editor").length).toBe(0);
    });
  });

  describe("refresh", () => {
    it("renders threads into contentEl", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice", authorColor: "#f00" }), replies: [] },
      ];
      const view = createView(threads);
      await view.refresh("test.md");

      const avatar = view.contentEl.querySelector(".yaos-extension-avatar");
      expect(avatar).not.toBeNull();
      expect(avatar?.textContent).toBe("A");
    });

    it("renders empty state when no threads", async () => {
      const view = createView([]);
      await view.refresh("test.md");

      const empty = view.contentEl.querySelector(".yaos-extension-comment-empty");
      expect(empty).not.toBeNull();
    });

    it("renders comment input at the top", async () => {
      const view = createView([]);
      await view.refresh("test.md");

      const input = view.contentEl.querySelector(".yaos-extension-comment-input");
      expect(input).not.toBeNull();
    });

    it("renders thread with replies", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1", author: "Bob" }),
            makeReply({ id: "r2", commentId: "c1", author: "Carol" }),
          ],
        },
      ];
      const view = createView(threads);
      await view.refresh("test.md");

      const replyItems = view.contentEl.querySelectorAll(".yaos-extension-comment-replies .yaos-extension-comment-item");
      expect(replyItems.length).toBe(2);
    });
  });

  describe("getThreads", () => {
    it("returns loaded threads after refresh", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
        { comment: makeComment({ id: "c2" }), replies: [] },
      ];
      const view = createView(threads);
      await view.refresh("test.md");

      expect(view.getThreads().length).toBe(2);
    });

    it("returns empty array before refresh", () => {
      const view = createView([]);
      expect(view.getThreads()).toEqual([]);
    });
  });

  describe("setPendingSelection", () => {
    it("delegates to renderer", async () => {
      const view = createView([]);
      view.setPendingSelection({
        rangeText: "selected text",
        rangeOffset: 0,
        rangeContext: "context",
        rangeLength: 13,
      });
      await view.refresh("test.md");

      const cmEditors = view.contentEl.querySelectorAll(".cm-editor");
      const content = cmEditors[0]?.querySelector(".cm-content") as HTMLElement;
      expect(content?.textContent).toContain("selected text");
    });
  });

  describe("callbacks", () => {
    it("passes onAddComment callback to renderer", async () => {
      const onAddComment = vi.fn();
      const view = createView([], { localDeviceName: "Alice", onAddComment });
      await view.refresh("test.md");

      const editors = (view as any).renderer.editors as any[];
      editors[0].setText("New comment");

      const submitBtn = view.contentEl.querySelector(".yaos-extension-comment-submit") as HTMLElement;
      submitBtn.click();

      expect(onAddComment).toHaveBeenCalledWith("New comment");
    });

    it("passes onResolve callback to renderer", async () => {
      const onResolve = vi.fn();
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const view = createView(threads, { localDeviceName: "Alice", onResolve });
      await view.refresh("test.md");

      const resolveBtn = view.contentEl.querySelector(".yaos-extension-resolve-btn") as HTMLElement;
      resolveBtn.click();

      expect(onResolve).toHaveBeenCalledWith("c1", true);
    });
  });

  describe("internal link click handler", () => {
    it("calls openLinkText when internal link is clicked", async () => {
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
      const store = makeStore([]);
      const view = new CommentView({} as any, store, app, {});
      await view.onOpen();

      const link = document.createElement("a");
      link.className = "internal-link";
      link.setAttribute("data-href", "other-file.md");
      link.textContent = "link";
      view.containerEl.appendChild(link);

      link.click();

      expect(app.workspace.openLinkText).toHaveBeenCalledWith("other-file.md", "");
    });
  });
});

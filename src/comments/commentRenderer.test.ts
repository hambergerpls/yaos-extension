import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentRenderer } from "./commentRenderer";
import { CommentStore } from "./commentStore";
import type { CommentThread, Comment, Reply } from "./types";

function createRendererWithOptions(threads: CommentThread[], options: { maxUnresolved?: number; showResolved?: boolean }, callbacks?: Record<string, unknown>): CommentRenderer {
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

  return new CommentRenderer(store, app, callbacks, options);
}

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

function createRenderer(threads: CommentThread[], callbacks?: Record<string, unknown>): CommentRenderer {
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

  return new CommentRenderer(store, app, callbacks);
}

describe("CommentRenderer", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  describe("empty state", () => {
    it("renders empty message when there are no threads", async () => {
      const renderer = createRenderer([]);
      await renderer.refresh(container, "test.md");

      const empty = container.querySelector(".yaos-extension-comment-empty");
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain("No comments on this file");
    });
  });

  describe("getThreadCount", () => {
    it("returns 0 when no threads", async () => {
      const renderer = createRenderer([]);
      await renderer.refresh(container, "test.md");
      expect(renderer.getThreadCount()).toBe(0);
    });

    it("returns thread count after refresh", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
        { comment: makeComment({ id: "c2" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");
      expect(renderer.getThreadCount()).toBe(2);
    });
  });

  describe("getThreads", () => {
    it("returns loaded threads", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");
      expect(renderer.getThreads()).toBe(threads);
    });
  });

  describe("avatar rendering", () => {
    it("renders a 24px avatar circle with author initial for each comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice", authorColor: "#f00" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const avatar = container.querySelector(".yaos-extension-avatar");
      expect(avatar).not.toBeNull();
      expect(avatar?.textContent).toBe("A");
      expect((avatar as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
    });

    it("renders avatar with different author initial", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Bob", authorColor: "#0f0" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const avatar = container.querySelector(".yaos-extension-avatar");
      expect(avatar?.textContent).toBe("B");
    });
  });

  describe("comment item row", () => {
    it("renders author name and timestamp in a row with the avatar", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const row = container.querySelector(".yaos-extension-comment-item-row");
      expect(row).not.toBeNull();
      expect(row?.querySelector(".yaos-extension-avatar")).not.toBeNull();
      expect(row?.querySelector(".yaos-extension-author-name")?.textContent).toBe("Alice");
      expect(row?.querySelector(".yaos-extension-timestamp")).not.toBeNull();
    });

    it("renders edited indicator when comment is edited", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ editedAt: 5000 }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const edited = container.querySelector(".yaos-extension-edited-indicator");
      expect(edited).not.toBeNull();
      expect(edited?.textContent).toContain("edited");
    });

    it("does not render edited indicator when comment is not edited", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const edited = container.querySelector(".yaos-extension-edited-indicator");
      expect(edited).toBeNull();
    });
  });

  describe("thread line", () => {
    it("renders a vertical thread line on the original comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const threadLine = container.querySelector(".yaos-extension-thread-line");
      expect(threadLine).not.toBeNull();
    });
  });

  describe("comment body and quote", () => {
    it("renders the selected text as a quote above the comment body", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ rangeText: "highlighted code" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const itemBody = container.querySelector(".yaos-extension-comment-item-body");
      expect(itemBody).not.toBeNull();
      const quote = itemBody?.querySelector(".yaos-extension-comment-quote");
      expect(quote).not.toBeNull();
      expect(quote?.textContent).toContain("highlighted code");
    });

    it("renders comment body text", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ text: "Hello world" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const body = container.querySelector(".yaos-extension-comment-item-body .yaos-extension-comment-body");
      expect(body).not.toBeNull();
      expect(body?.textContent).toContain("Hello world");
    });
  });

  describe("hover action toolbar", () => {
    it("renders a resolve action button on each thread", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const onResolve = vi.fn();
      const renderer = createRenderer(threads, { localDeviceName: "Alice", onResolve });
      await renderer.refresh(container, "test.md");

      const actions = container.querySelector(".yaos-extension-comment-actions");
      expect(actions).not.toBeNull();
      const resolveBtn = actions?.querySelector(".yaos-extension-resolve-btn");
      expect(resolveBtn).not.toBeNull();
      expect(resolveBtn?.getAttribute("aria-label")).toBe("Resolve");
    });

    it("calls onResolve when resolve button is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const onResolve = vi.fn();
      const renderer = createRenderer(threads, { localDeviceName: "Alice", onResolve });
      await renderer.refresh(container, "test.md");

      const resolveBtn = container.querySelector(".yaos-extension-resolve-btn") as HTMLElement;
      resolveBtn.click();

      expect(onResolve).toHaveBeenCalledWith("c1", true);
    });

    it("renders a delete button for the user's own comment in the action toolbar", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const renderer = createRenderer(threads, { localDeviceName: "Alice", onDelete });
      await renderer.refresh(container, "test.md");

      const deleteBtn = container.querySelector(".yaos-extension-comment-actions .yaos-extension-delete-btn");
      expect(deleteBtn).not.toBeNull();
    });

    it("does not render a delete button for another user's comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Bob" }), replies: [] },
      ];
      const renderer = createRenderer(threads, { localDeviceName: "Alice" });
      await renderer.refresh(container, "test.md");

      const deleteBtn = container.querySelector(".yaos-extension-comment-actions .yaos-extension-delete-btn");
      expect(deleteBtn).toBeNull();
    });

    it("renders an edit button for the user's own comment in the action toolbar", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const renderer = createRenderer(threads, { localDeviceName: "Alice" });
      await renderer.refresh(container, "test.md");

      const editBtn = container.querySelector(".yaos-extension-comment-actions .yaos-extension-edit-btn");
      expect(editBtn).not.toBeNull();
    });

    it("does not render an edit button for another user's comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Bob" }), replies: [] },
      ];
      const renderer = createRenderer(threads, { localDeviceName: "Alice" });
      await renderer.refresh(container, "test.md");

      const editBtn = container.querySelector(".yaos-extension-comment-actions .yaos-extension-edit-btn");
      expect(editBtn).toBeNull();
    });

    it("calls onDelete when delete button is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c-42", author: "Alice" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const renderer = createRenderer(threads, { localDeviceName: "Alice", onDelete });
      await renderer.refresh(container, "test.md");

      const deleteBtn = container.querySelector(".yaos-extension-delete-btn") as HTMLElement;
      deleteBtn.click();

      expect(onDelete).toHaveBeenCalledWith("c-42");
    });
  });

  describe("show replies button", () => {
    it("renders 'Show N-1 more replies' button when thread has more than 3 replies (default collapsed)", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1" }),
            makeReply({ id: "r2", commentId: "c1" }),
            makeReply({ id: "r3", commentId: "c1" }),
            makeReply({ id: "r4", commentId: "c1" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies");
      expect(showBtn).not.toBeNull();
      expect(showBtn?.textContent).toContain("Show 3 more replies");
      const repliesContainer = container.querySelector(".yaos-extension-comment-replies");
      const replyItems = repliesContainer?.querySelectorAll(".yaos-extension-comment-item");
      expect(replyItems?.length).toBe(1);
    });

    it("expands all replies when 'Show N-1 more replies' is clicked", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1" }),
            makeReply({ id: "r2", commentId: "c1" }),
            makeReply({ id: "r3", commentId: "c1" }),
            makeReply({ id: "r4", commentId: "c1" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      expect(showBtn?.textContent).toContain("Show 3 more replies");

      showBtn.click();

      const updatedBtn = container.querySelector(".yaos-extension-show-replies");
      expect(updatedBtn).toBeNull();
      const repliesContainer = container.querySelector(".yaos-extension-comment-replies");
      const replyItems = repliesContainer?.querySelectorAll(".yaos-extension-comment-item");
      expect(replyItems?.length).toBe(4);
    });

    it("does not render show replies button when thread has 3 or fewer replies", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1" }),
            makeReply({ id: "r2", commentId: "c1" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies");
      expect(showBtn).toBeNull();
    });

    it("does not render show replies button when thread has no replies", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies");
      expect(showBtn).toBeNull();
    });

    it("shows reply author avatars when expanded", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Alice", authorColor: "#f00" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1", author: "Bob", authorColor: "#0f0" }),
            makeReply({ id: "r2", commentId: "c1" }),
            makeReply({ id: "r3", commentId: "c1" }),
            makeReply({ id: "r4", commentId: "c1" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      showBtn.click();

      const avatars = container.querySelectorAll(".yaos-extension-comment-replies .yaos-extension-avatar");
      expect(avatars.length).toBe(4);
      expect(avatars[0]!.textContent).toBe("B");
    });

    it("shows last reply with correct author when collapsed", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Alice", authorColor: "#f00" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1", author: "Bob", authorColor: "#0f0" }),
            makeReply({ id: "r2", commentId: "c1", author: "Charlie", authorColor: "#00f" }),
            makeReply({ id: "r3", commentId: "c1", author: "Dave", authorColor: "#ff0" }),
            makeReply({ id: "r4", commentId: "c1", author: "Eve", authorColor: "#f0f" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const repliesContainer = container.querySelector(".yaos-extension-comment-replies");
      const replyItems = repliesContainer?.querySelectorAll(".yaos-extension-comment-item");
      expect(replyItems?.length).toBe(1);

      const avatar = repliesContainer?.querySelector(".yaos-extension-avatar");
      expect(avatar?.textContent).toBe("E");
      const authorName = repliesContainer?.querySelector(".yaos-extension-author-name");
      expect(authorName?.textContent).toBe("Eve");
    });

    it("shows last reply with correct text when collapsed", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1", text: "first" }),
            makeReply({ id: "r2", commentId: "c1", text: "second" }),
            makeReply({ id: "r3", commentId: "c1", text: "third" }),
            makeReply({ id: "r4", commentId: "c1", text: "last reply text" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const body = container.querySelector(".yaos-extension-comment-replies .yaos-extension-comment-body");
      expect(body?.textContent).toContain("last reply text");
    });

    it("renders delete button for own reply when replies are expanded", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1", author: "Alice" }),
            makeReply({ id: "r2", commentId: "c1" }),
            makeReply({ id: "r3", commentId: "c1" }),
            makeReply({ id: "r4", commentId: "c1" }),
          ],
        },
      ];
      const onDeleteReply = vi.fn();
      const renderer = createRenderer(threads, { localDeviceName: "Alice", onDeleteReply });
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      showBtn.click();

      const deleteBtn = container.querySelector(".yaos-extension-comment-replies .yaos-extension-delete-btn");
      expect(deleteBtn).not.toBeNull();
    });

    it("calls onDeleteReply when reply delete button is clicked", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [
            makeReply({ id: "r-99", commentId: "c1", author: "Alice" }),
            makeReply({ id: "r2", commentId: "c1" }),
            makeReply({ id: "r3", commentId: "c1" }),
            makeReply({ id: "r4", commentId: "c1" }),
          ],
        },
      ];
      const onDeleteReply = vi.fn();
      const renderer = createRenderer(threads, { localDeviceName: "Alice", onDeleteReply });
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      showBtn.click();

      const deleteBtn = container.querySelector(".yaos-extension-comment-replies .yaos-extension-delete-btn") as HTMLElement;
      deleteBtn.click();

      expect(onDeleteReply).toHaveBeenCalledWith("r-99");
    });
  });

  describe("reply input", () => {
    it("renders a reply input for thread with no replies", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const replyInput = container.querySelector(".yaos-extension-thread-wrapper > .yaos-extension-reply-input");
      expect(replyInput).not.toBeNull();
    });

    it("renders a reply input for thread with replies when collapsed", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [makeReply({ id: "r1", commentId: "c1" })],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const replyInput = container.querySelector(".yaos-extension-thread-wrapper > .yaos-extension-reply-input");
      expect(replyInput).not.toBeNull();
    });

    it("renders a reply input for thread with replies when expanded", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1" }),
            makeReply({ id: "r2", commentId: "c1" }),
            makeReply({ id: "r3", commentId: "c1" }),
            makeReply({ id: "r4", commentId: "c1" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      showBtn.click();

      const replyInput = container.querySelector(".yaos-extension-thread-wrapper > .yaos-extension-reply-input");
      expect(replyInput).not.toBeNull();
    });

    it("calls onAddReply when reply is submitted from the always-visible reply input", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
      ];
      const onAddReply = vi.fn();
      const renderer = createRenderer(threads, { onAddReply });
      await renderer.refresh(container, "test.md");

      const replyEditors = (renderer as any).replyEditors as any[];
      expect(replyEditors.length).toBeGreaterThan(0);
      replyEditors[0].setText("My reply");

      const replyBtn = container.querySelector(".yaos-extension-thread-wrapper > .yaos-extension-reply-input .yaos-extension-reply-submit") as HTMLElement;
      replyBtn.click();

      expect(onAddReply).toHaveBeenCalledWith("c1", "My reply");
    });

    it("places reply input outside the collapsible replies container", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1" }),
            makeReply({ id: "r2", commentId: "c1" }),
            makeReply({ id: "r3", commentId: "c1" }),
            makeReply({ id: "r4", commentId: "c1" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const showBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      showBtn.click();

      const repliesContainer = container.querySelector(".yaos-extension-comment-replies");
      const replyInputInsideReplies = repliesContainer?.querySelector(".yaos-extension-reply-input");
      expect(replyInputInsideReplies).toBeNull();

      const replyInputOutsideReplies = container.querySelector(".yaos-extension-thread-wrapper > .yaos-extension-reply-input");
      expect(replyInputOutsideReplies).not.toBeNull();
    });

    it("always shows replies directly when thread has 3 or fewer replies", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1", author: "Bob" }),
            makeReply({ id: "r2", commentId: "c1", author: "Carol" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const repliesContainer = container.querySelector(".yaos-extension-comment-replies");
      expect(repliesContainer?.classList.contains("expanded")).toBe(true);
      const replyItems = repliesContainer?.querySelectorAll(".yaos-extension-comment-item");
      expect(replyItems?.length).toBe(2);
    });
  });

  describe("resolve button placement", () => {
    it("renders resolve button on root comment only", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1" }),
            makeReply({ id: "r2", commentId: "c1" }),
          ],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const allResolveBtns = container.querySelectorAll(".yaos-extension-resolve-btn");
      expect(allResolveBtns.length).toBe(1);
    });

    it("does not render resolve button on reply items", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [makeReply({ id: "r1", commentId: "c1" })],
        },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const items = container.querySelectorAll(".yaos-extension-comment-item");
      expect(items.length).toBe(2);
      const replyItem = items[1]!;
      const resolveBtnOnReply = replyItem.querySelector(".yaos-extension-resolve-btn");
      expect(resolveBtnOnReply).toBeNull();
    });
  });

  describe("resolved threads", () => {
    it("renders resolved threads with resolved class", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const thread = container.querySelector(".yaos-extension-comment-thread");
      expect(thread?.classList.contains("resolved")).toBe(true);
    });

    it("shows reopen button on resolved threads", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const onResolve = vi.fn();
      const renderer = createRenderer(threads, { onResolve });
      await renderer.refresh(container, "test.md");

      const resolveBtn = container.querySelector(".yaos-extension-resolve-btn");
      expect(resolveBtn?.getAttribute("aria-label")).toContain("Reopen");
    });

    it("calls onResolve with false when reopen button is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const onResolve = vi.fn();
      const renderer = createRenderer(threads, { onResolve });
      await renderer.refresh(container, "test.md");

      const reopenBtn = container.querySelector(".yaos-extension-resolve-btn") as HTMLElement;
      reopenBtn.click();

      expect(onResolve).toHaveBeenCalledWith("c1", false);
    });

    it("separates resolved threads with a divider", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: false }), replies: [] },
        { comment: makeComment({ id: "c2", resolved: true }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const divider = container.querySelector(".yaos-extension-comment-resolved-divider");
      expect(divider).not.toBeNull();
    });
  });

  describe("CM6 editor integration", () => {
    it("renders a CM6 editor for comment input", async () => {
      const renderer = createRenderer([], { localDeviceName: "Alice" });
      await renderer.refresh(container, "test.md");

      const cmEditor = container.querySelector(".yaos-extension-comment-input .cm-editor");
      expect(cmEditor).not.toBeNull();
    });

    it("cleans up CM6 editors on destroy", async () => {
      const renderer = createRenderer([], { localDeviceName: "Alice" });
      await renderer.refresh(container, "test.md");

      expect(container.querySelector(".cm-editor")).not.toBeNull();

      renderer.destroy();

      expect(document.querySelectorAll(".cm-editor").length).toBe(0);
    });
  });

  describe("draft preservation", () => {
    it("clears comment input draft when switching to a different file", async () => {
      const renderer = createRenderer([], { localDeviceName: "Alice" });
      await renderer.refresh(container, "file-a.md");

      const editors = (renderer as any).editors as any[];
      expect(editors.length).toBe(1);
      editors[0].setText("draft for file A");

      await renderer.refresh(container, "file-b.md");

      const newEditors = (renderer as any).editors as any[];
      expect(newEditors.length).toBe(1);
      expect(newEditors[0].getText()).toBe("");
    });

    it("preserves comment input draft when refreshing with the same file", async () => {
      const renderer = createRenderer([], { localDeviceName: "Alice" });
      await renderer.refresh(container, "test.md");

      const editors = (renderer as any).editors as any[];
      expect(editors.length).toBe(1);
      editors[0].setText("my draft comment");

      await renderer.refresh(container, "test.md");

      const newEditors = (renderer as any).editors as any[];
      expect(newEditors.length).toBe(1);
      expect(newEditors[0].getText()).toBe("my draft comment");
    });
  });

  describe("pending selection", () => {
    it("sets pending selection text in comment input", async () => {
      const renderer = createRenderer([], { localDeviceName: "Alice" });
      renderer.setPendingSelection({
        rangeText: "selected text",
        rangeOffset: 0,
        rangeContext: "some context",
        rangeLength: 13,
      });
      await renderer.refresh(container, "test.md");

      const cmEditors = container.querySelectorAll(".cm-editor");
      const commentEditor = cmEditors[0]!;
      const content = commentEditor.querySelector(".cm-content") as HTMLElement;
      expect(content?.textContent).toContain("selected text");
    });
  });

  describe("comment input", () => {
    it("renders comment input at the top of the container", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).not.toBeNull();
      const firstChild = container.firstElementChild;
      expect(firstChild?.classList.contains("yaos-extension-comment-input")).toBe(true);
    });

    it("renders a Comment button", async () => {
      const renderer = createRenderer([]);
      await renderer.refresh(container, "test.md");

      const submitBtn = container.querySelector(".yaos-extension-comment-submit");
      expect(submitBtn).not.toBeNull();
      expect(submitBtn?.textContent).toBe("Comment");
    });

    it("calls onAddComment when Comment button is clicked", async () => {
      const onAddComment = vi.fn();
      const renderer = createRenderer([], { onAddComment });
      await renderer.refresh(container, "test.md");

      const editors = (renderer as any).editors as any[];
      editors[0].setText("New comment");

      const submitBtn = container.querySelector(".yaos-extension-comment-submit") as HTMLElement;
      submitBtn.click();

      expect(onAddComment).toHaveBeenCalledWith("New comment");
    });
  });

  describe("maxUnresolved option", () => {
    it("renders only 1 unresolved thread when maxUnresolved is 1", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
        { comment: makeComment({ id: "c2", author: "Bob" }), replies: [] },
        { comment: makeComment({ id: "c3", author: "Carol" }), replies: [] },
      ];
      const renderer = createRendererWithOptions(threads, { maxUnresolved: 1 });
      await renderer.refresh(container, "test.md");

      const threadCards = container.querySelectorAll(".yaos-extension-comment-thread");
      expect(threadCards.length).toBe(1);
      const authorName = threadCards[0]?.querySelector(".yaos-extension-author-name");
      expect(authorName?.textContent).toBe("Alice");
    });

    it("skips resolved section when maxUnresolved is set", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: false }), replies: [] },
        { comment: makeComment({ id: "c2", resolved: true }), replies: [] },
      ];
      const renderer = createRendererWithOptions(threads, { maxUnresolved: 1 });
      await renderer.refresh(container, "test.md");

      const divider = container.querySelector(".yaos-extension-comment-resolved-divider");
      expect(divider).toBeNull();
      const threadCards = container.querySelectorAll(".yaos-extension-comment-thread");
      expect(threadCards.length).toBe(1);
      expect(threadCards[0]?.classList.contains("resolved")).toBe(false);
    });

    it("renders no thread cards when all threads are resolved and maxUnresolved is set", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
        { comment: makeComment({ id: "c2", resolved: true }), replies: [] },
      ];
      const renderer = createRendererWithOptions(threads, { maxUnresolved: 1 });
      await renderer.refresh(container, "test.md");

      const threadCards = container.querySelectorAll(".yaos-extension-comment-thread");
      expect(threadCards.length).toBe(0);
      const divider = container.querySelector(".yaos-extension-comment-resolved-divider");
      expect(divider).toBeNull();
      const empty = container.querySelector(".yaos-extension-comment-empty");
      expect(empty).toBeNull();
    });

    it("still renders comment input when no unresolved threads with maxUnresolved", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const renderer = createRendererWithOptions(threads, { maxUnresolved: 1 });
      await renderer.refresh(container, "test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).not.toBeNull();
    });

    it("renders 2 unresolved threads when maxUnresolved is 2", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
        { comment: makeComment({ id: "c2", author: "Bob" }), replies: [] },
        { comment: makeComment({ id: "c3", author: "Carol" }), replies: [] },
      ];
      const renderer = createRendererWithOptions(threads, { maxUnresolved: 2 });
      await renderer.refresh(container, "test.md");

      const threadCards = container.querySelectorAll(".yaos-extension-comment-thread");
      expect(threadCards.length).toBe(2);
    });

    it("does not limit threads when maxUnresolved is not set", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
        { comment: makeComment({ id: "c2" }), replies: [] },
        { comment: makeComment({ id: "c3" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const threadCards = container.querySelectorAll(".yaos-extension-comment-thread");
      expect(threadCards.length).toBe(3);
    });

    it("hides comment input when maxUnresolved is set and unresolved threads exist", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
      ];
      const renderer = createRendererWithOptions(threads, { maxUnresolved: 1 });
      await renderer.refresh(container, "test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).toBeNull();
    });

    it("shows comment input when maxUnresolved is set and no unresolved threads exist", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const renderer = createRendererWithOptions(threads, { maxUnresolved: 1 });
      await renderer.refresh(container, "test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).not.toBeNull();
    });

    it("shows comment input when maxUnresolved is set and there are no threads", async () => {
      const renderer = createRendererWithOptions([], { maxUnresolved: 1 });
      await renderer.refresh(container, "test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).not.toBeNull();
    });

    it("always shows comment input when maxUnresolved is not set", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
      ];
      const renderer = createRenderer(threads);
      await renderer.refresh(container, "test.md");

      const input = container.querySelector(".yaos-extension-comment-input");
      expect(input).not.toBeNull();
    });
  });
});

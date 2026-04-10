import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentView } from "./commentView";
import { CommentStore } from "./commentStore";
import type { CommentThread, Comment, Reply } from "./types";
import type { KnownDevice } from "../yaosApi";

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

describe("CommentView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("delete comment button", () => {
    it("renders a delete button for the user's own comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const store = makeStore(threads);
      const onDelete = vi.fn();

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", onDelete },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const deleteBtn = view.contentEl.querySelector(".yaos-extension-delete-btn");
      expect(deleteBtn).not.toBeNull();
      expect(deleteBtn?.textContent).toBe("Delete");
    });

    it("does not render a delete button for another user's comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Bob" }), replies: [] },
      ];
      const store = makeStore(threads);
      const onDelete = vi.fn();

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", onDelete },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const deleteBtn = view.contentEl.querySelector(".yaos-extension-delete-btn");
      expect(deleteBtn).toBeNull();
    });

    it("calls onDelete with the comment id when delete is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c-42", author: "Alice" }), replies: [] },
      ];
      const store = makeStore(threads);
      const onDelete = vi.fn();

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", onDelete },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const deleteBtn = view.contentEl.querySelector(".yaos-extension-delete-btn") as HTMLElement;
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
      const store = makeStore(threads);
      const onDeleteReply = vi.fn();

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", onDeleteReply },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      expect(header).not.toBeNull();
      header.click();

      const deleteBtn = view.contentEl.querySelector(".yaos-extension-delete-reply-btn") as HTMLElement;
      expect(deleteBtn).not.toBeNull();
    });

    it("does not render a delete button for another user's reply", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [makeReply({ id: "r-42", commentId: "c1", author: "Bob" })],
        },
      ];
      const store = makeStore(threads);
      const onDeleteReply = vi.fn();

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", onDeleteReply },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      header.click();

      const deleteBtn = view.contentEl.querySelector(".yaos-extension-delete-reply-btn");
      expect(deleteBtn).toBeNull();
    });

    it("calls onDeleteReply with the reply id when delete is clicked", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [makeReply({ id: "r-99", commentId: "c1", author: "Alice" })],
        },
      ];
      const store = makeStore(threads);
      const onDeleteReply = vi.fn();

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", onDeleteReply },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      header.click();

      const deleteBtn = view.contentEl.querySelector(".yaos-extension-delete-reply-btn") as HTMLElement;
      deleteBtn.click();

      expect(onDeleteReply).toHaveBeenCalledWith("r-99");
    });
  });

  describe("resolved threads", () => {
    it("renders resolved threads with replies collapsed by default", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Alice", resolved: true }),
          replies: [makeReply({ id: "r1", commentId: "c1", author: "Bob" })],
        },
      ];
      const store = makeStore(threads);

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice" },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const repliesContainer = view.contentEl.querySelector(".yaos-extension-comment-replies") as HTMLElement;
      expect(repliesContainer).not.toBeNull();
      expect(repliesContainer.classList.contains("expanded")).toBe(false);
    });

    it("renders unresolved threads with replies collapsed by default", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Alice", resolved: false }),
          replies: [makeReply({ id: "r1", commentId: "c1", author: "Bob" })],
        },
      ];
      const store = makeStore(threads);

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice" },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const repliesContainer = view.contentEl.querySelector(".yaos-extension-comment-replies") as HTMLElement;
      expect(repliesContainer).not.toBeNull();
      expect(repliesContainer.classList.contains("expanded")).toBe(false);
    });

    it("expands replies when header is clicked", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Alice" }),
          replies: [makeReply({ id: "r1", commentId: "c1", author: "Bob", text: "Reply text" })],
        },
      ];
      const store = makeStore(threads);

      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice" },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      header.click();

      await new Promise(r => setTimeout(r, 50));

      const repliesContainer = view.contentEl.querySelector(".yaos-extension-comment-replies") as HTMLElement;
      expect(repliesContainer.classList.contains("expanded")).toBe(true);
      expect(repliesContainer.textContent).toContain("Reply text");
    });
  });

  describe("mention suggest integration", () => {
    const mockPeers: KnownDevice[] = [
      { name: "Alice", color: "#f00", colorLight: "#f0033", online: true, hasCursor: true },
      { name: "Bob", color: "#0f0", colorLight: "#0f033", online: true, hasCursor: false },
    ];

    it("shows mention dropdown when typing @ in comment textarea with getPeers callback", async () => {
      const store = makeStore([]);
      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", getPeers: () => mockPeers },
      );

      await view.onOpen();

      const textarea = view.contentEl.querySelector(".yaos-extension-comment-textarea") as HTMLTextAreaElement;
      expect(textarea).not.toBeNull();
      textarea.value = "@";
      textarea.selectionStart = 1;
      textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      const items = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(2);
    });

    it("shows mention dropdown in reply textarea when thread is expanded", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [],
        },
      ];
      const store = makeStore(threads);
      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", getPeers: () => mockPeers },
      );

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      header.click();

      await new Promise(r => setTimeout(r, 50));

      const replyTextarea = view.contentEl.querySelector(".yaos-extension-reply-textarea") as HTMLTextAreaElement;
      expect(replyTextarea).not.toBeNull();
      replyTextarea.value = "@";
      replyTextarea.selectionStart = 1;
      replyTextarea.selectionEnd = 1;
      replyTextarea.dispatchEvent(new Event("input", { bubbles: true }));

      const items = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(2);
    });

    it("does not show mention dropdown when getPeers is not provided", async () => {
      const store = makeStore([]);
      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice" },
      );

      await view.onOpen();

      const textarea = view.contentEl.querySelector(".yaos-extension-comment-textarea") as HTMLTextAreaElement;
      textarea.value = "@";
      textarea.selectionStart = 1;
      textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      const items = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(0);
    });

    it("cleans up mention suggest on onClose", async () => {
      const store = makeStore([]);
      const view = new CommentView(
        {} as any,
        store,
        { localDeviceName: "Alice", getPeers: () => mockPeers },
      );

      await view.onOpen();

      const textarea = view.contentEl.querySelector(".yaos-extension-comment-textarea") as HTMLTextAreaElement;
      textarea.value = "@";
      textarea.selectionStart = 1;
      textarea.selectionEnd = 1;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      expect(document.querySelectorAll(".yaos-extension-mention-item").length).toBe(2);

      await view.onClose();

      expect(document.querySelectorAll(".yaos-extension-mention-item").length).toBe(0);
    });
  });
});

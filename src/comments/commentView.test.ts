import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentView } from "./commentView";
import { CommentStore } from "./commentStore";
import type { EmbeddedEditorHandle } from "./embeddedEditor";
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

function getCommentEditorHandles(view: CommentView): EmbeddedEditorHandle[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (view as any).editors as EmbeddedEditorHandle[];
}

function getReplyEditorHandles(view: CommentView): EmbeddedEditorHandle[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (view as any).replyEditors as EmbeddedEditorHandle[];
}

describe("CommentView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function createView(threads: CommentThread[], callbacks?: Record<string, unknown>): CommentView {
    const store = makeStore(threads);
    const leaf = {
      view: {} as any,
    } as any;
    const view = new CommentView(leaf, store, callbacks);
    (view as any).registerDomEvent = vi.fn();
    (view as any).app = {
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
    };
    return view;
  }

  describe("delete comment button", () => {
    it("renders a delete button for the user's own comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onDelete });

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
      const onDelete = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onDelete });

      await view.onOpen();
      await view.refresh("test.md");

      const deleteBtn = view.contentEl.querySelector(".yaos-extension-delete-btn");
      expect(deleteBtn).toBeNull();
    });

    it("calls onDelete with the comment id when delete is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c-42", author: "Alice" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onDelete });

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
      const onDeleteReply = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onDeleteReply });

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
      const onDeleteReply = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onDeleteReply });

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
      const onDeleteReply = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onDeleteReply });

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
      const view = createView(threads, { localDeviceName: "Alice" });

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
      const view = createView(threads, { localDeviceName: "Alice" });

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
      const view = createView(threads, { localDeviceName: "Alice" });

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

  describe("CM6 editor integration", () => {
    it("renders a CM6 editor for comment input", async () => {
      const view = createView([], { localDeviceName: "Alice" });

      await view.onOpen();

      const cmEditor = view.contentEl.querySelector(".yaos-extension-comment-input .cm-editor");
      expect(cmEditor).not.toBeNull();
    });

    it("submits comment via button click", async () => {
      const onAddComment = vi.fn();
      const view = createView([], { localDeviceName: "Alice", onAddComment });

      await view.onOpen();

      const handles = getCommentEditorHandles(view);
      expect(handles.length).toBe(1);
      handles[0]!.setText("hello world");

      const submitBtn = view.contentEl.querySelector(".yaos-extension-comment-submit") as HTMLElement;
      submitBtn.click();

      expect(onAddComment).toHaveBeenCalledWith("hello world");
    });

    it("cleans up CM6 editors on onClose", async () => {
      const view = createView([], { localDeviceName: "Alice" });

      await view.onOpen();
      expect(view.contentEl.querySelector(".cm-editor")).not.toBeNull();

      await view.onClose();

      expect(document.querySelectorAll(".cm-editor").length).toBe(0);
    });
  });

  describe("draft preservation", () => {
    it("clears comment input draft when switching to a different file", async () => {
      const view = createView([], { localDeviceName: "Alice" });

      await view.onOpen();
      await view.refresh("file-a.md");

      const handles = getCommentEditorHandles(view);
      handles[0]!.setText("draft for file A");

      // Refresh with a different file (simulates switching active file)
      await view.refresh("file-b.md");

      const newHandles = getCommentEditorHandles(view);
      expect(newHandles.length).toBe(1);
      expect(newHandles[0]!.getText()).toBe("");
    });

    it("pendingSelection overrides saved draft", async () => {
      const view = createView([], { localDeviceName: "Alice" });

      await view.onOpen();
      await view.refresh("test.md");

      const handles = getCommentEditorHandles(view);
      handles[0]!.setText("my draft");

      // Set pending selection before refresh
      view.setPendingSelection({
        rangeText: "selected text",
        rangeOffset: 0,
        rangeContext: "some context",
        rangeLength: 13,
      });

      // Refresh same file — pendingSelection should win over draft
      await view.refresh("test.md");

      const newHandles = getCommentEditorHandles(view);
      expect(newHandles[0]!.getText()).not.toContain("my draft");
    });

    it("preserves comment input draft when refreshing with the same file", async () => {
      const view = createView([], { localDeviceName: "Alice" });

      await view.onOpen();
      await view.refresh("test.md");

      const handles = getCommentEditorHandles(view);
      expect(handles.length).toBe(1);
      handles[0]!.setText("my draft comment");

      // Refresh with the same file (simulates active-leaf-change to same file)
      await view.refresh("test.md");

      const newHandles = getCommentEditorHandles(view);
      expect(newHandles.length).toBe(1);
      expect(newHandles[0]!.getText()).toBe("my draft comment");
    });
  });

  describe("mention integration", () => {
    const mockPeers: KnownDevice[] = [
      { name: "Alice", color: "#f00", colorLight: "#f0033", online: true, hasCursor: true },
      { name: "Bob", color: "#0f0", colorLight: "#0f033", online: true, hasCursor: false },
    ];

    it("shows mention dropdown when typing @ in comment editor with getPeers callback", async () => {
      const view = createView([], { localDeviceName: "Alice", getPeers: () => mockPeers });

      await view.onOpen();

      const handles = getCommentEditorHandles(view);
      expect(handles.length).toBe(1);
      handles[0]!.setText(" @");
      handles[0]!.view.dispatch({
        selection: { anchor: 2 },
      });

      await new Promise(r => setTimeout(r, 50));

      const items = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(2);
    });

    it("does not show mention dropdown when getPeers is not provided", async () => {
      const view = createView([], { localDeviceName: "Alice" });

      await view.onOpen();

      const handles = getCommentEditorHandles(view);
      handles[0]!.setText(" @");

      await new Promise(r => setTimeout(r, 50));

      const items = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(0);
    });

    it("cleans up mention dropdown on onClose", async () => {
      const view = createView([], { localDeviceName: "Alice", getPeers: () => mockPeers });

      await view.onOpen();

      const handles = getCommentEditorHandles(view);
      handles[0]!.setText(" @");

      await new Promise(r => setTimeout(r, 50));

      expect(document.querySelectorAll(".yaos-extension-mention-item").length).toBe(2);

      await view.onClose();

      expect(document.querySelectorAll(".yaos-extension-mention-item").length).toBe(0);
    });
  });

  describe("edit comment button", () => {
    it("renders an edit button for the user's own comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const onEditComment = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onEditComment });

      await view.onOpen();
      await view.refresh("test.md");

      const editBtn = view.contentEl.querySelector(".yaos-extension-edit-btn");
      expect(editBtn).not.toBeNull();
      expect(editBtn?.textContent).toBe("Edit");
    });

    it("does not render an edit button for another user's comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Bob" }), replies: [] },
      ];
      const onEditComment = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onEditComment });

      await view.onOpen();
      await view.refresh("test.md");

      const editBtn = view.contentEl.querySelector(".yaos-extension-edit-btn");
      expect(editBtn).toBeNull();
    });

    it("calls onEditComment with id and new text when save is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const onEditComment = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onEditComment });

      await view.onOpen();
      await view.refresh("test.md");

      const editBtn = view.contentEl.querySelector(".yaos-extension-edit-btn") as HTMLElement;
      editBtn.click();

      const saveBtn = view.contentEl.querySelector(".yaos-extension-edit-save-btn") as HTMLElement;
      expect(saveBtn).not.toBeNull();

      // The edit mode now uses an embedded CM6 editor instead of a textarea.
      // The editor handle is pushed to the editors array; the first handle is the
      // main comment input, and the second is the edit editor.
      const handles = getCommentEditorHandles(view);
      const editHandle = handles[handles.length - 1]!;
      editHandle.setText("updated comment");

      saveBtn.click();

      expect(onEditComment).toHaveBeenCalledWith("c1", "updated comment");
    });
  });

  describe("edit reply button", () => {
    it("renders an edit button for the user's own reply when thread is expanded", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [makeReply({ id: "r1", commentId: "c1", author: "Alice" })],
        },
      ];
      const onEditReply = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onEditReply });

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      header.click();

      const editBtn = view.contentEl.querySelector(".yaos-extension-edit-reply-btn");
      expect(editBtn).not.toBeNull();
    });

    it("does not render an edit button for another user's reply", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [makeReply({ id: "r1", commentId: "c1", author: "Bob" })],
        },
      ];
      const onEditReply = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onEditReply });

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      header.click();

      const editBtn = view.contentEl.querySelector(".yaos-extension-edit-reply-btn");
      expect(editBtn).toBeNull();
    });

    it("calls onEditReply with id and new text when save is clicked", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [makeReply({ id: "r1", commentId: "c1", author: "Alice", text: "original reply" })],
        },
      ];
      const onEditReply = vi.fn();
      const view = createView(threads, { localDeviceName: "Alice", onEditReply });

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      header.click();

      const editBtn = view.contentEl.querySelector(".yaos-extension-edit-reply-btn") as HTMLElement;
      editBtn.click();

      const saveBtn = view.contentEl.querySelector(".yaos-extension-edit-save-btn") as HTMLElement;
      expect(saveBtn).not.toBeNull();

      // The edit mode now uses an embedded CM6 editor instead of a textarea.
      // The edit editor is pushed first, then the reply input editor, so index 0.
      const replyHandles = getReplyEditorHandles(view);
      const editHandle = replyHandles[0]!;
      editHandle.setText("updated reply");

      saveBtn.click();

      expect(onEditReply).toHaveBeenCalledWith("r1", "updated reply");
    });
  });

  describe("edited indicator", () => {
    it("shows edited indicator on a comment that has been edited", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice", editedAt: 5000 }), replies: [] },
      ];
      const view = createView(threads, { localDeviceName: "Alice" });

      await view.onOpen();
      await view.refresh("test.md");

      const edited = view.contentEl.querySelector(".yaos-extension-edited-indicator");
      expect(edited).not.toBeNull();
      expect(edited?.textContent).toContain("edited");
    });

    it("does not show edited indicator on a comment that has not been edited", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", author: "Alice" }), replies: [] },
      ];
      const view = createView(threads, { localDeviceName: "Alice" });

      await view.onOpen();
      await view.refresh("test.md");

      const edited = view.contentEl.querySelector(".yaos-extension-edited-indicator");
      expect(edited).toBeNull();
    });

    it("shows edited indicator on a reply that has been edited", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1", author: "Bob" }),
          replies: [makeReply({ id: "r1", commentId: "c1", author: "Alice", editedAt: 6000 })],
        },
      ];
      const view = createView(threads, { localDeviceName: "Alice" });

      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
      header.click();

      await new Promise(r => setTimeout(r, 50));

      const edited = view.contentEl.querySelector(".yaos-extension-reply .yaos-extension-edited-indicator");
      expect(edited).not.toBeNull();
      expect(edited?.textContent).toContain("edited");
    });
  });
});
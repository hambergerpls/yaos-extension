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

async function expandPanel(panel: InlineCommentPanel, container: HTMLElement) {
  panel.attach(container.querySelector(".cm-scroller")! as HTMLElement);
  await panel.refresh("test.md");
  const header = container.querySelector(".yaos-extension-inline-comment-header") as HTMLElement;
  header.click();
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
    it("renders a collapsed header showing Comments count when no threads", async () => {
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

  describe("avatar rendering", () => {
    it("renders a 24px avatar circle with author initial for each comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice", authorColor: "#f00" }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const avatar = container.querySelector(".yaos-extension-avatar");
      expect(avatar).not.toBeNull();
      expect(avatar?.textContent).toBe("A");
      expect((avatar as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
    });

    it("renders avatar with different author initial", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Bob", authorColor: "#0f0" }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const avatar = container.querySelector(".yaos-extension-avatar");
      expect(avatar?.textContent).toBe("B");
    });
  });

  describe("comment item row", () => {
    it("renders author name and timestamp in a row with the avatar", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const edited = container.querySelector(".yaos-extension-edited-indicator");
      expect(edited).not.toBeNull();
      expect(edited?.textContent).toContain("edited");
    });

    it("does not render edited indicator when comment is not edited", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const edited = container.querySelector(".yaos-extension-edited-indicator");
      expect(edited).toBeNull();
    });
  });

  describe("thread line", () => {
    it("renders a vertical thread line on the original comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment(), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const threadLine = container.querySelector(".yaos-extension-thread-line");
      expect(threadLine).not.toBeNull();
    });
  });

  describe("comment body and quote", () => {
    it("renders the selected text as a quote above the comment body", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ rangeText: "highlighted code" }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads, { localDeviceName: "Alice", onResolve });
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads, { localDeviceName: "Alice", onResolve });
      const container = createContainer();

      await expandPanel(panel, container);

      const resolveBtn = container.querySelector(".yaos-extension-resolve-btn") as HTMLElement;
      resolveBtn.click();

      expect(onResolve).toHaveBeenCalledWith("c1", true);
    });

    it("renders a delete button for the user's own comment in the action toolbar", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onDelete });
      const container = createContainer();

      await expandPanel(panel, container);

      const deleteBtn = container.querySelector(".yaos-extension-comment-actions .yaos-extension-delete-btn");
      expect(deleteBtn).not.toBeNull();
    });

    it("does not render a delete button for another user's comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Bob" }), replies: [] },
      ];
      const panel = createPanel(threads, { localDeviceName: "Alice" });
      const container = createContainer();

      await expandPanel(panel, container);

      const deleteBtn = container.querySelector(".yaos-extension-comment-actions .yaos-extension-delete-btn");
      expect(deleteBtn).toBeNull();
    });

    it("renders an edit button for the user's own comment in the action toolbar", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Alice" }), replies: [] },
      ];
      const panel = createPanel(threads, { localDeviceName: "Alice" });
      const container = createContainer();

      await expandPanel(panel, container);

      const editBtn = container.querySelector(".yaos-extension-comment-actions .yaos-extension-edit-btn");
      expect(editBtn).not.toBeNull();
    });

    it("does not render an edit button for another user's comment", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ author: "Bob" }), replies: [] },
      ];
      const panel = createPanel(threads, { localDeviceName: "Alice" });
      const container = createContainer();

      await expandPanel(panel, container);

      const editBtn = container.querySelector(".yaos-extension-comment-actions .yaos-extension-edit-btn");
      expect(editBtn).toBeNull();
    });

    it("calls onDelete when delete button is clicked", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c-42", author: "Alice" }), replies: [] },
      ];
      const onDelete = vi.fn();
      const panel = createPanel(threads, { localDeviceName: "Alice", onDelete });
      const container = createContainer();

      await expandPanel(panel, container);

      const deleteBtn = container.querySelector(".yaos-extension-delete-btn") as HTMLElement;
      deleteBtn.click();

      expect(onDelete).toHaveBeenCalledWith("c-42");
    });
  });

  describe("show replies button", () => {
    it("renders 'Hide replies' button when thread has more than 3 replies (auto-expanded)", async () => {
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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const showBtn = container.querySelector(".yaos-extension-show-replies");
      expect(showBtn).not.toBeNull();
      expect(showBtn?.textContent).toContain("Hide replies");
    });

    it("collapses replies when 'Hide replies' is clicked and shows 'Show N replies'", async () => {
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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const showBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      expect(showBtn?.textContent).toContain("Hide replies");

      showBtn.click();

      const repliesContainer = container.querySelector(".yaos-extension-comment-replies");
      expect(repliesContainer?.classList.contains("expanded")).toBe(false);
      const updatedBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      expect(updatedBtn?.textContent).toContain("Show 4 replies");
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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const showBtn = container.querySelector(".yaos-extension-show-replies");
      expect(showBtn).toBeNull();
    });

    it("does not render show replies button when thread has no replies", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1" }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const showBtn = container.querySelector(".yaos-extension-show-replies");
      expect(showBtn).toBeNull();
    });

    it("expands replies when 'Show N replies' is clicked after collapsing", async () => {
      const threads: CommentThread[] = [
        {
          comment: makeComment({ id: "c1" }),
          replies: [
            makeReply({ id: "r1", commentId: "c1", author: "Bob" }),
            makeReply({ id: "r2", commentId: "c1" }),
            makeReply({ id: "r3", commentId: "c1" }),
            makeReply({ id: "r4", commentId: "c1" }),
          ],
        },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const showBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      showBtn.click();
      const collapsedBtn = container.querySelector(".yaos-extension-show-replies") as HTMLElement;
      expect(collapsedBtn?.textContent).toContain("Show 4 replies");

      collapsedBtn.click();

      const repliesContainer = container.querySelector(".yaos-extension-comment-replies");
      expect(repliesContainer?.classList.contains("expanded")).toBe(true);
      const replyItems = repliesContainer?.querySelectorAll(".yaos-extension-comment-item");
      expect(replyItems?.length).toBe(4);
    });

    it("shows reply author avatars when auto-expanded", async () => {
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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const avatars = container.querySelectorAll(".yaos-extension-comment-replies .yaos-extension-avatar");
      expect(avatars.length).toBe(4);
      expect(avatars[0]!.textContent).toBe("B");
    });

    it("renders delete button for own reply when replies are auto-expanded", async () => {
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
      const panel = createPanel(threads, { localDeviceName: "Alice", onDeleteReply });
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads, { localDeviceName: "Alice", onDeleteReply });
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads, { onAddReply });
      const container = createContainer();

      await expandPanel(panel, container);

      const replyEditors = (panel as any).replyEditors as any[];
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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

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
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const repliesContainer = container.querySelector(".yaos-extension-comment-replies");
      expect(repliesContainer?.classList.contains("expanded")).toBe(true);
      const replyItems = repliesContainer?.querySelectorAll(".yaos-extension-comment-item");
      expect(replyItems?.length).toBe(2);
    });
  });

  describe("resolved threads", () => {
    it("renders resolved threads with resolved class", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const thread = container.querySelector(".yaos-extension-comment-thread");
      expect(thread?.classList.contains("resolved")).toBe(true);
    });

    it("shows reopen button on resolved threads", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: true }), replies: [] },
      ];
      const onResolve = vi.fn();
      const panel = createPanel(threads, { onResolve });
      const container = createContainer();

      await expandPanel(panel, container);

      const resolveBtn = container.querySelector(".yaos-extension-resolve-btn");
      expect(resolveBtn?.getAttribute("aria-label")).toContain("Reopen");
    });

    it("separates resolved threads with a divider", async () => {
      const threads: CommentThread[] = [
        { comment: makeComment({ id: "c1", resolved: false }), replies: [] },
        { comment: makeComment({ id: "c2", resolved: true }), replies: [] },
      ];
      const panel = createPanel(threads);
      const container = createContainer();

      await expandPanel(panel, container);

      const divider = container.querySelector(".yaos-extension-comment-resolved-divider");
      expect(divider).not.toBeNull();
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

  describe("CM6 editor integration", () => {
    it("renders a CM6 editor for comment input when expanded", async () => {
      const panel = createPanel([], { localDeviceName: "Alice" });
      const container = createContainer();

      await expandPanel(panel, container);

      const cmEditor = container.querySelector(".yaos-extension-comment-input .cm-editor");
      expect(cmEditor).not.toBeNull();
    });

    it("cleans up CM6 editors on detach", async () => {
      const panel = createPanel([], { localDeviceName: "Alice" });
      const container = createContainer();

      await expandPanel(panel, container);

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

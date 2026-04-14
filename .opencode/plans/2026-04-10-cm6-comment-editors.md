# Replace Comment Textareas with CM6 Editors

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the plain `<textarea>` elements in the comment sidebar with embedded CodeMirror 6 editors that match Obsidian's theme, support @mentions natively via the existing `editorMentionExtension`, and submit on Enter.

**Architecture:** Create a `createEmbeddedEditor()` helper that instantiates a compact CM6 `EditorView` with Obsidian theme extensions copied from the active editor, the mention plugin, and custom Enter-to-submit keybinding. `CommentView.renderInput()` and `CommentView.renderReplies()` will call this helper instead of creating `<textarea>` elements. The `MentionSuggest` class (textarea-only) will be deleted entirely.

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`), Obsidian's internal `.cm` property for theme extraction, existing `editorMentionExtension`.

---

## Task 1: Create embedded CM6 editor factory

**Files:**
- Create: `src/comments/embeddedEditor.ts`
- Test: `src/comments/embeddedEditor.test.ts`

**Step 1: Write the failing test**

```ts
// src/comments/embeddedEditor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEmbeddedEditor, type EmbeddedEditorHandle } from "./embeddedEditor";

describe("createEmbeddedEditor", () => {
  let container: HTMLElement;
  let handle: EmbeddedEditorHandle | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    handle?.destroy();
    handle = null;
    container.remove();
    document.querySelectorAll(".yaos-extension-mention-dropdown").forEach((el) => el.remove());
  });

  it("creates an EditorView inside the container", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    const cmEl = container.querySelector(".cm-editor");
    expect(cmEl).not.toBeNull();
  });

  it("returns a handle with getText that reads the document", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    expect(handle.getText()).toBe("");
    handle.setText("hello");
    expect(handle.getText()).toBe("hello");
  });

  it("clears the document via clear()", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    handle.setText("some text");
    handle.clear();
    expect(handle.getText()).toBe("");
  });

  it("focuses the editor via focus()", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    handle.focus();
    expect(handle.view.hasFocus).toBe(true);
  });

  it("calls onSubmit when Enter is pressed without Shift", () => {
    const onSubmit = vi.fn();
    handle = createEmbeddedEditor(container, { placeholder: "Test...", onSubmit });
    handle.setText("comment");
    handle.view.focus();

    const keyboardEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    handle.view.contentDOM.dispatchEvent(keyboardEvent);

    expect(onSubmit).toHaveBeenCalledWith("comment");
  });

  it("does not call onSubmit when Shift+Enter is pressed", () => {
    const onSubmit = vi.fn();
    handle = createEmbeddedEditor(container, { placeholder: "Test...", onSubmit });
    handle.setText("comment");

    const keyboardEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    handle.view.contentDOM.dispatchEvent(keyboardEvent);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("destroys the EditorView when destroy() is called", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    const view = handle.view;
    handle.destroy();
    handle = null;
    expect(view.dom.parentNode).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/comments/embeddedEditor.test.ts`
Expected: FAIL — `createEmbeddedEditor` is not defined.

**Step 3: Write the implementation**

```ts
// src/comments/embeddedEditor.ts
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";

export interface EmbeddedEditorOptions {
  placeholder?: string;
  onSubmit?: (text: string) => void;
  extraExtensions?: Extension[];
}

export interface EmbeddedEditorHandle {
  view: EditorView;
  getText(): string;
  setText(text: string): void;
  clear(): void;
  focus(): void;
  destroy(): void;
}

function getObsidianThemeExtensions(): Extension[] {
  const extensions: Extension[] = [];

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (window as any).app;
    const activeView = app?.workspace?.getActiveViewOfType?.("markdown");
    if (activeView?.editor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cmView = (activeView.editor as any).cm as EditorView | undefined;
      if (cmView) {
        const themeComp = cmView.state.facet(EditorView.theme);
        if (themeComp) extensions.push(EditorView.theme(themeComp));
        const darkComp = cmView.state.facet(EditorView.darkTheme);
        if (darkComp) extensions.push(EditorView.darkTheme.of(darkComp));
      }
    }
  } catch {
    // Fall through to CSS-variable-based fallback
  }

  return extensions;
}

const embeddedEditorTheme = EditorView.theme({
  "&": {
    fontSize: "var(--font-ui-small, 13px)",
    border: "1px solid var(--background-modifier-border)",
    borderRadius: "4px",
    backgroundColor: "var(--background-primary)",
  },
  ".cm-content": {
    fontFamily: "var(--font-text, inherit)",
    color: "var(--text-normal)",
    padding: "4px 0",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text-normal)",
  },
  ".cm-placeholder": {
    color: "var(--text-faint)",
    fontStyle: "italic",
    padding: "0 4px",
  },
  ".cm-focused": {
    outline: "none",
    borderColor: "var(--interactive-accent, #7f6df2)",
  },
  ".cm-scroller": {
    overflow: "auto",
    maxHeight: "120px",
    minHeight: "40px",
  },
  "&.yaos-extension-reply-editor .cm-scroller": {
    maxHeight: "80px",
    minHeight: "30px",
  },
});

export function createEmbeddedEditor(
  parent: HTMLElement,
  options: EmbeddedEditorOptions = {},
): EmbeddedEditorHandle {
  const { placeholder, onSubmit, extraExtensions = [] } = options;

  const enterKeymap = keymap.of([
    {
      key: "Enter",
      run: (view: EditorView): boolean => {
        if (onSubmit) {
          const text = view.state.doc.toString().trim();
          if (text) {
            onSubmit(text);
            return true;
          }
        }
        return false;
      },
    },
  ]);

  const themeExtensions = getObsidianThemeExtensions();

  const state = EditorState.create({
    doc: "",
    extensions: [
      ...themeExtensions,
      embeddedEditorTheme,
      EditorView.lineWrapping,
      enterKeymap,
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      ...extraExtensions,
    ],
  });

  const view = new EditorView({
    state,
    parent,
  });

  return {
    view,
    getText(): string {
      return view.state.doc.toString();
    },
    setText(text: string): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      });
    },
    clear(): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "" },
      });
    },
    focus(): void {
      view.focus();
    },
    destroy(): void {
      view.destroy();
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/comments/embeddedEditor.test.ts`
Expected: PASS (all tests green)

**Step 5: Commit**

```bash
git add src/comments/embeddedEditor.ts src/comments/embeddedEditor.test.ts
git commit -m "feat: add createEmbeddedEditor factory for CM6 editors in sidebar"
```

---

## Task 2: Refactor CommentView to use embedded CM6 editors

**Files:**
- Modify: `src/comments/commentView.ts`
- Modify: `src/comments/commentView.test.ts`

This is the core change. We replace both `<textarea>` usages with `createEmbeddedEditor`, wire up the `editorMentionExtension`, and track editor handles for cleanup.

**Step 1: Update CommentView**

Key changes to `src/comments/commentView.ts`:

1. Remove the `MentionSuggest` import. Add imports for `createEmbeddedEditor`, `EmbeddedEditorHandle`, and `editorMentionExtension`.
2. Replace `mentionSuggests: MentionSuggest[]` and `replyMentionSuggests: MentionSuggest[]` fields with `editors: EmbeddedEditorHandle[]` and `replyEditors: EmbeddedEditorHandle[]`.
3. Rewrite `renderInput()` — replace `<textarea>` creation with `createEmbeddedEditor(inputContainer, { placeholder: "Add a comment...", onSubmit, extraExtensions })`. Pass `editorMentionExtension(this.getPeers)` when `getPeers` is available.
4. Rewrite `renderReplies()` — same pattern with `placeholder: "Write a reply..."`.
5. Update `destroyMentionSuggests()` → `destroyEditors()` which calls `handle.destroy()` for each editor.
6. Update `destroyReplyMentionSuggests()` → `destroyReplyEditors()`.
7. Update `onClose()` to call `destroyEditors()`.
8. In `renderThreadCard()`, the collapse handler calls `destroyReplyEditors()` instead of `destroyReplyMentionSuggests()`.

The full rewritten `commentView.ts`:

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import { CommentStore } from "./commentStore";
import { createEmbeddedEditor, type EmbeddedEditorHandle } from "./embeddedEditor";
import { editorMentionExtension } from "../mentions/editorMentionPlugin";
import type { KnownDevice } from "../yaosApi";
import type { CommentThread } from "./types";

export const COMMENTS_VIEW_TYPE = "yaos-extension-comments";

export class CommentView extends ItemView {
  private store: CommentStore;
  private threads: CommentThread[] = [];
  private localDeviceName: string;
  private onOpenThread?: (threadId: string) => void;
  private onAddComment?: (text: string) => void;
  private onAddReply?: (commentId: string, text: string) => void;
  private onResolve?: (commentId: string, resolved: boolean) => void;
  private onDelete?: (commentId: string) => void;
  private onDeleteReply?: (replyId: string) => void;
  private getPeers?: () => KnownDevice[];
  private editors: EmbeddedEditorHandle[] = [];
  private replyEditors: EmbeddedEditorHandle[] = [];
  private pendingSelection: { rangeText: string; rangeOffset: number; rangeContext: string; rangeLength: number } | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    store: CommentStore,
    callbacks?: {
      localDeviceName?: string;
      onOpenThread?: (threadId: string) => void;
      onAddComment?: (text: string) => void;
      onAddReply?: (commentId: string, text: string) => void;
      onResolve?: (commentId: string, resolved: boolean) => void;
      onDelete?: (commentId: string) => void;
      onDeleteReply?: (replyId: string) => void;
      getPeers?: () => KnownDevice[];
    },
  ) {
    super(leaf);
    this.store = store;
    this.localDeviceName = callbacks?.localDeviceName ?? "";
    this.onOpenThread = callbacks?.onOpenThread;
    this.onAddComment = callbacks?.onAddComment;
    this.onAddReply = callbacks?.onAddReply;
    this.onResolve = callbacks?.onResolve;
    this.onDelete = callbacks?.onDelete;
    this.onDeleteReply = callbacks?.onDeleteReply;
    this.getPeers = callbacks?.getPeers;
  }

  getViewType(): string {
    return COMMENTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Comments";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.destroyEditors();
    this.contentEl.empty();
  }

  setPendingSelection(selection: { rangeText: string; rangeOffset: number; rangeContext: string; rangeLength: number } | null): void {
    this.pendingSelection = selection;
    this.render();
  }

  async refresh(filePath: string): Promise<void> {
    this.threads = await this.store.getThreadsForFile(filePath);
    await this.render();
  }

  getThreads(): CommentThread[] {
    return this.threads;
  }

  private async render(): Promise<void> {
    this.destroyEditors();
    this.contentEl.empty();
    this.contentEl.addClass("yaos-extension-comment-view");

    this.renderInput();

    if (this.threads.length === 0) {
      const empty = this.contentEl.createDiv({ cls: "yaos-extension-comment-empty" });
      empty.createSpan({ text: "No comments on this file" });
      return;
    }

    const unresolved = this.threads.filter(t => !t.comment.resolved);
    const resolved = this.threads.filter(t => t.comment.resolved);

    for (const thread of unresolved) {
      this.renderThreadCard(thread);
    }

    if (resolved.length > 0) {
      this.contentEl.createDiv({ cls: "yaos-extension-comment-resolved-divider", text: "Resolved" });
      for (const thread of resolved) {
        this.renderThreadCard(thread);
      }
    }
  }

  private renderInput(): void {
    const inputContainer = this.contentEl.createDiv({ cls: "yaos-extension-comment-input" });

    const extensions = this.getPeers
      ? [editorMentionExtension(this.getPeers)]
      : [];

    const handle = createEmbeddedEditor(inputContainer, {
      placeholder: "Add a comment...",
      onSubmit: (text) => {
        if (!text) return;
        this.onAddComment?.(text);
        handle.clear();
      },
      extraExtensions: extensions,
    });

    if (this.pendingSelection) {
      handle.setText(`> ${this.pendingSelection.rangeText}\n`);
      handle.focus();
      this.pendingSelection = null;
    }

    this.editors.push(handle);

    const submitBtn = inputContainer.createEl("button", { cls: "yaos-extension-comment-submit", text: "Comment" });
    submitBtn.addEventListener("click", () => {
      const text = handle.getText().trim();
      if (!text) return;
      this.onAddComment?.(text);
      handle.clear();
    });
  }

  private renderThreadCard(thread: CommentThread): void {
    const card = this.contentEl.createDiv({
      cls: `yaos-extension-comment-thread${thread.comment.resolved ? " resolved" : ""}`,
    });

    const header = card.createDiv({ cls: "yaos-extension-comment-header" });

    const quote = header.createDiv({ cls: "yaos-extension-comment-quote" });
    quote.createSpan({ text: thread.comment.rangeText });

    const meta = header.createDiv({ cls: "yaos-extension-comment-meta" });
    const colorDot = meta.createSpan({ cls: "yaos-extension-author-dot" });
    colorDot.style.backgroundColor = thread.comment.authorColor;
    meta.createSpan({ cls: "yaos-extension-author-name", text: thread.comment.author });
    meta.createSpan({ cls: "yaos-extension-timestamp", text: this.formatRelativeTime(thread.comment.createdAt) });

    const body = card.createDiv({ cls: "yaos-extension-comment-body" });
    this.renderMentionsInto(body, thread.comment.text);

    if (thread.replies.length > 0) {
      header.createSpan({ cls: "yaos-extension-reply-count", text: `${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}` });
    }

    const actions = header.createDiv({ cls: "yaos-extension-comment-actions" });
    const resolveBtn = actions.createEl("button", {
      cls: "yaos-extension-resolve-btn",
      text: thread.comment.resolved ? "Reopen" : "Resolve",
    });
    resolveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onResolve?.(thread.comment.id, !thread.comment.resolved);
    });

    if (thread.comment.author === this.localDeviceName) {
      const deleteBtn = actions.createEl("button", {
        cls: "yaos-extension-delete-btn",
        text: "Delete",
      });
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onDelete?.(thread.comment.id);
      });
    }

    const repliesContainer = card.createDiv({ cls: "yaos-extension-comment-replies" });

    let expanded = false;
    header.addEventListener("click", () => {
      expanded = !expanded;
      if (expanded) {
        repliesContainer.empty();
        this.renderReplies(repliesContainer, thread);
        requestAnimationFrame(() => {
          repliesContainer.classList.add("expanded");
        });
      } else {
        this.destroyReplyEditors();
        repliesContainer.classList.remove("expanded");
      }
    });
  }

  private renderReplies(container: HTMLElement, thread: CommentThread): void {
    container.empty();

    for (const reply of thread.replies) {
      const replyEl = container.createDiv({ cls: "yaos-extension-reply" });
      const replyMeta = replyEl.createDiv({ cls: "yaos-extension-comment-meta" });
      const dot = replyMeta.createSpan({ cls: "yaos-extension-author-dot" });
      dot.style.backgroundColor = reply.authorColor;
      replyMeta.createSpan({ cls: "yaos-extension-author-name", text: reply.author });
      replyMeta.createSpan({ cls: "yaos-extension-timestamp", text: this.formatRelativeTime(reply.createdAt) });
      if (reply.author === this.localDeviceName) {
        const replyDeleteBtn = replyMeta.createEl("button", {
          cls: "yaos-extension-delete-reply-btn",
          text: "Delete",
        });
        replyDeleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onDeleteReply?.(reply.id);
        });
      }
      const replyBody = replyEl.createDiv({ cls: "yaos-extension-comment-body" });
      this.renderMentionsInto(replyBody, reply.text);
    }

    const replyInput = container.createDiv({ cls: "yaos-extension-reply-input" });

    const extensions = this.getPeers
      ? [editorMentionExtension(this.getPeers)]
      : [];

    const replyHandle = createEmbeddedEditor(replyInput, {
      placeholder: "Write a reply...",
      onSubmit: (text) => {
        if (!text) return;
        this.onAddReply?.(thread.comment.id, text);
        replyHandle.clear();
      },
      extraExtensions: extensions,
    });

    this.replyEditors.push(replyHandle);

    const replyBtn = replyInput.createEl("button", { cls: "yaos-extension-reply-submit", text: "Reply" });
    replyBtn.addEventListener("click", () => {
      const text = replyHandle.getText().trim();
      if (!text) return;
      this.onAddReply?.(thread.comment.id, text);
      replyHandle.clear();
    });
  }

  private renderMentionsInto(container: HTMLElement, text: string): void {
    const parts = text.split(/(@\w+)/g);
    for (const part of parts) {
      if (/^@\w+$/.test(part)) {
        container.createEl("strong", { cls: "yaos-extension-mention", text: part });
      } else if (part) {
        container.appendChild(document.createTextNode(part));
      }
    }
  }

  private destroyEditors(): void {
    for (const editor of this.editors) {
      editor.destroy();
    }
    this.editors = [];
    this.destroyReplyEditors();
  }

  private destroyReplyEditors(): void {
    for (const editor of this.replyEditors) {
      editor.destroy();
    }
    this.replyEditors = [];
  }

  private formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    return `${days}d ago`;
  }
}
```

**Step 2: Update the tests**

The existing tests in `commentView.test.ts` need updating:

- Tests querying `.yaos-extension-comment-textarea` → query `.cm-editor` instead
- Tests setting `textarea.value` + dispatching `input` → use CM6 dispatch API
- All non-mention tests (delete, resolve, reply, expand) keep working with minimal changes
- New tests for Enter-to-submit and CM6 editor lifecycle

Updated test file:

```ts
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

function getCommentEditorView(view: CommentView) {
  const cmEl = view.contentEl.querySelector(".yaos-extension-comment-input .cm-editor") as HTMLElement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (cmEl as any)?.cmView?.view ?? null;
}

function insertIntoCommentEditor(view: CommentView, text: string) {
  const editorView = getCommentEditorView(view);
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: text },
    selection: { anchor: text.length },
  });
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

      const view = new CommentView({} as any, store, { localDeviceName: "Alice", onDelete });
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

      const view = new CommentView({} as any, store, { localDeviceName: "Alice", onDelete });
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

      const view = new CommentView({} as any, store, { localDeviceName: "Alice", onDelete });
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

      const view = new CommentView({} as any, store, { localDeviceName: "Alice", onDeleteReply });
      await view.onOpen();
      await view.refresh("test.md");

      const header = view.contentEl.querySelector(".yaos-extension-comment-header") as HTMLElement;
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

      const view = new CommentView({} as any, store, { localDeviceName: "Alice", onDeleteReply });
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

      const view = new CommentView({} as any, store, { localDeviceName: "Alice", onDeleteReply });
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
      const view = new CommentView({} as any, store, { localDeviceName: "Alice" });
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
      const view = new CommentView({} as any, store, { localDeviceName: "Alice" });
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
      const view = new CommentView({} as any, store, { localDeviceName: "Alice" });
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
      const store = makeStore([]);
      const view = new CommentView({} as any, store, { localDeviceName: "Alice" });
      await view.onOpen();

      const cmEditor = view.contentEl.querySelector(".yaos-extension-comment-input .cm-editor");
      expect(cmEditor).not.toBeNull();
    });

    it("submits comment via button click", async () => {
      const store = makeStore([]);
      const onAddComment = vi.fn();
      const view = new CommentView({} as any, store, { localDeviceName: "Alice", onAddComment });
      await view.onOpen();

      insertIntoCommentEditor(view, "hello world");

      const submitBtn = view.contentEl.querySelector(".yaos-extension-comment-submit") as HTMLElement;
      submitBtn.click();
      expect(onAddComment).toHaveBeenCalledWith("hello world");
    });

    it("cleans up CM6 editors on onClose", async () => {
      const store = makeStore([]);
      const view = new CommentView({} as any, store, { localDeviceName: "Alice" });
      await view.onOpen();
      expect(view.contentEl.querySelector(".cm-editor")).not.toBeNull();

      await view.onClose();
      expect(document.querySelectorAll(".cm-editor").length).toBe(0);
    });
  });

  describe("mention integration", () => {
    const mockPeers: KnownDevice[] = [
      { name: "Alice", color: "#f00", colorLight: "#f0033", online: true, hasCursor: true },
      { name: "Bob", color: "#0f0", colorLight: "#0f033", online: true, hasCursor: false },
    ];

    it("shows mention dropdown when typing @ in comment editor with getPeers callback", async () => {
      const store = makeStore([]);
      const view = new CommentView({} as any, store, { localDeviceName: "Alice", getPeers: () => mockPeers });
      await view.onOpen();

      insertIntoCommentEditor(view, " @");
      await new Promise(r => setTimeout(r, 50));

      const items = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(2);
    });

    it("does not show mention dropdown when getPeers is not provided", async () => {
      const store = makeStore([]);
      const view = new CommentView({} as any, store, { localDeviceName: "Alice" });
      await view.onOpen();

      insertIntoCommentEditor(view, " @");
      await new Promise(r => setTimeout(r, 50));

      const items = document.querySelectorAll(".yaos-extension-mention-item");
      expect(items.length).toBe(0);
    });

    it("cleans up mention dropdown on onClose", async () => {
      const store = makeStore([]);
      const view = new CommentView({} as any, store, { localDeviceName: "Alice", getPeers: () => mockPeers });
      await view.onOpen();

      insertIntoCommentEditor(view, " @");
      await new Promise(r => setTimeout(r, 50));
      expect(document.querySelectorAll(".yaos-extension-mention-item").length).toBe(2);

      await view.onClose();
      expect(document.querySelectorAll(".yaos-extension-mention-item").length).toBe(0);
    });
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/comments/commentView.test.ts`
Expected: PASS — all existing behavior preserved, new CM6 editor tests pass.

**Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: `mentionSuggest.test.ts` still passes (its file is standalone). Proceed to Task 3.

**Step 5: Commit**

```bash
git add src/comments/commentView.ts src/comments/commentView.test.ts
git commit -m "feat: replace comment textareas with CM6 editors in sidebar"
```

---

## Task 3: Remove MentionSuggest class and tests

**Files:**
- Delete: `src/mentions/mentionSuggest.ts`
- Delete: `src/mentions/mentionSuggest.test.ts`

**Step 1: Delete the files**

```bash
rm src/mentions/mentionSuggest.ts src/mentions/mentionSuggest.test.ts
```

**Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no remaining imports of `MentionSuggest`.

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove MentionSuggest class, replaced by CM6 editorMentionPlugin"
```

---

## Task 4: Update styles.css for CM6 editors

**Files:**
- Modify: `src/styles.css`

**Step 1: Update CSS**

Remove the `.yaos-extension-comment-textarea` block (lines 161-173) and `.yaos-extension-reply-textarea` block (lines 340-352).

Replace them with:

```css
.yaos-extension-comment-input .cm-editor {
  width: 100%;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: var(--background-primary);
}

.yaos-extension-comment-input .cm-editor.cm-focused {
  border-color: var(--interactive-accent, #7f6df2);
  outline: none;
}

.yaos-extension-comment-input .cm-scroller {
  overflow: "auto";
  max-height: 120px;
  min-height: 60px;
}

.yaos-extension-reply-input .cm-editor {
  width: 100%;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  background: var(--background-primary);
}

.yaos-extension-reply-input .cm-editor.cm-focused {
  border-color: var(--interactive-accent, #7f6df2);
  outline: none;
}

.yaos-extension-reply-input .cm-scroller {
  overflow: "auto";
  max-height: 80px;
  min-height: 40px;
}
```

Keep `.yaos-extension-comment-submit` and `.yaos-extension-reply-submit` button styles as-is.

**Step 2: Commit**

```bash
git add src/styles.css
git commit -m "style: update CSS for embedded CM6 comment editors"
```

---

## Task 5: Final verification

**Step 1: Build the plugin**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 3: Run type check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: No type errors.

---

## Summary of files changed

| File | Action |
|------|--------|
| `src/comments/embeddedEditor.ts` | **Create** — CM6 editor factory |
| `src/comments/embeddedEditor.test.ts` | **Create** — Tests for factory |
| `src/comments/commentView.ts` | **Modify** — Replace textareas with embedded editors |
| `src/comments/commentView.test.ts` | **Modify** — Update tests for CM6 |
| `src/mentions/mentionSuggest.ts` | **Delete** — No longer needed |
| `src/mentions/mentionSuggest.test.ts` | **Delete** — No longer needed |
| `src/styles.css` | **Modify** — Replace textarea styles with CM6 styles |

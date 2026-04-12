import { ItemView, MarkdownRenderer, Component, WorkspaceLeaf } from "obsidian";
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
  private renderComponents: Component[] = [];
  private renderGeneration = 0;
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
    this.renderGeneration++;
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
      app: this.app,
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
    void this.renderCommentBody(body, thread.comment.text);

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
      void this.renderCommentBody(replyBody, reply.text);
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
      app: this.app,
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

  private async renderCommentBody(container: HTMLElement, text: string): Promise<void> {
    const generation = this.renderGeneration;
    const component = new Component();
    component.load();
    this.renderComponents.push(component);
    try {
      await MarkdownRenderer.render(this.app, text, container, "", component);
      if (this.renderGeneration !== generation) {
        return;
      }
      const mentions = Array.from(container.querySelectorAll("strong"));
      for (const el of mentions) {
        if (/^@\w+$/.test(el.textContent ?? "")) {
          el.addClass("yaos-extension-mention");
        }
      }
    } catch {
      if (this.renderGeneration !== generation) {
        return;
      }
      this.renderMentionsIntoFallback(container, text);
    }
  }

  private renderMentionsIntoFallback(container: HTMLElement, text: string): void {
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
    this.destroyRenderComponents();
  }

  private destroyReplyEditors(): void {
    for (const editor of this.replyEditors) {
      editor.destroy();
    }
    this.replyEditors = [];
  }

  private destroyRenderComponents(): void {
    for (const component of this.renderComponents) {
      try {
        component.unload();
      } catch {}
    }
    this.renderComponents = [];
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

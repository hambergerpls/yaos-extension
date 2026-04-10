import { ItemView, WorkspaceLeaf } from "obsidian";
import { CommentStore } from "./commentStore";
import type { CommentThread } from "./types";

export const COMMENTS_VIEW_TYPE = "yaos-extension-comments";

export class CommentView extends ItemView {
  private store: CommentStore;
  private threads: CommentThread[] = [];
  private onOpenThread?: (threadId: string) => void;
  private onAddComment?: (text: string) => void;
  private onAddReply?: (commentId: string, text: string) => void;
  private onResolve?: (commentId: string, resolved: boolean) => void;
  private pendingSelection: { rangeText: string; rangeOffset: number; rangeContext: string; rangeLength: number } | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    store: CommentStore,
    callbacks?: {
      onOpenThread?: (threadId: string) => void;
      onAddComment?: (text: string) => void;
      onAddReply?: (commentId: string, text: string) => void;
      onResolve?: (commentId: string, resolved: boolean) => void;
    },
  ) {
    super(leaf);
    this.store = store;
    this.onOpenThread = callbacks?.onOpenThread;
    this.onAddComment = callbacks?.onAddComment;
    this.onAddReply = callbacks?.onAddReply;
    this.onResolve = callbacks?.onResolve;
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

    const textarea = inputContainer.createEl("textarea", {
      cls: "yaos-extension-comment-textarea",
      attr: { placeholder: "Add a comment..." },
    });

    if (this.pendingSelection) {
      textarea.value = `> ${this.pendingSelection.rangeText}\n`;
      textarea.focus();
      this.pendingSelection = null;
    }

    const submitBtn = inputContainer.createEl("button", { cls: "yaos-extension-comment-submit", text: "Comment" });
    submitBtn.addEventListener("click", () => {
      const text = textarea.value.trim();
      if (!text) return;
      this.onAddComment?.(text);
      textarea.value = "";
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
      const replyCount = header.createSpan({ cls: "yaos-extension-reply-count", text: `${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}` });
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

    const repliesContainer = card.createDiv({ cls: "yaos-extension-comment-replies" });
    repliesContainer.style.display = "none";

    let expanded = false;
    header.addEventListener("click", () => {
      expanded = !expanded;
      if (expanded) {
        repliesContainer.style.display = "block";
        repliesContainer.empty();
        this.renderReplies(repliesContainer, thread);
      } else {
        repliesContainer.style.display = "none";
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
      const replyBody = replyEl.createDiv({ cls: "yaos-extension-comment-body" });
      this.renderMentionsInto(replyBody, reply.text);
    }

    const replyInput = container.createDiv({ cls: "yaos-extension-reply-input" });
    const replyTextarea = replyInput.createEl("textarea", {
      cls: "yaos-extension-reply-textarea",
      attr: { placeholder: "Write a reply..." },
    });
    const replyBtn = replyInput.createEl("button", { cls: "yaos-extension-reply-submit", text: "Reply" });
    replyBtn.addEventListener("click", () => {
      const text = replyTextarea.value.trim();
      if (!text) return;
      this.onAddReply?.(thread.comment.id, text);
      replyTextarea.value = "";
    });
  }

  private renderMentionsInto(container: HTMLElement, text: string): void {
    const parts = text.split(/(@\w+)/g);
    for (const part of parts) {
      if (/^@\w+$/.test(part)) {
        const strong = container.createEl("strong", { cls: "yaos-extension-mention", text: part });
      } else if (part) {
        container.appendChild(document.createTextNode(part));
      }
    }
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

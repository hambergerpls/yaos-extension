import { MarkdownRenderer, Component, setIcon, type App } from "obsidian";
import { CommentStore } from "./commentStore";
import { createEmbeddedEditor, type EmbeddedEditorHandle } from "./embeddedEditor";
import { editorMentionExtension } from "../mentions/editorMentionPlugin";
import type { KnownDevice } from "../yaosApi";
import type { CommentThread, Comment, Reply } from "./types";

export interface CommentRendererCallbacks {
  localDeviceName?: string;
  onOpenThread?: (threadId: string) => void;
  onAddComment?: (text: string) => void;
  onAddReply?: (commentId: string, text: string) => void;
  onResolve?: (commentId: string, resolved: boolean) => void;
  onDelete?: (commentId: string) => void;
  onDeleteReply?: (replyId: string) => void;
  onEditComment?: (commentId: string, newText: string) => void;
  onEditReply?: (replyId: string, newText: string) => void;
  getPeers?: () => KnownDevice[];
}

export class CommentRenderer {
  private store: CommentStore;
  private app: App;
  private threads: CommentThread[] = [];
  private localDeviceName: string;
  private onOpenThread?: (threadId: string) => void;
  private onAddComment?: (text: string) => void;
  private onAddReply?: (commentId: string, text: string) => void;
  private onResolve?: (commentId: string, resolved: boolean) => void;
  private onDelete?: (commentId: string) => void;
  private onDeleteReply?: (replyId: string) => void;
  private onEditComment?: (commentId: string, newText: string) => void;
  private onEditReply?: (replyId: string, newText: string) => void;
  private getPeers?: () => KnownDevice[];
  private editors: EmbeddedEditorHandle[] = [];
  private replyEditors: EmbeddedEditorHandle[] = [];
  private renderComponents: Component[] = [];
  private renderGeneration = 0;
  private pendingSelection: { rangeText: string; rangeOffset: number; rangeContext: string; rangeLength: number } | null = null;
  private currentFilePath = "";
  private draftText = "";
  private editingCommentId: string | null = null;
  private editingReplyId: string | null = null;
  private collapsedReplies = new Set<string>();
  private container: HTMLElement | null = null;

  constructor(store: CommentStore, app: App, callbacks?: CommentRendererCallbacks) {
    this.store = store;
    this.app = app;
    this.localDeviceName = callbacks?.localDeviceName ?? "";
    this.onOpenThread = callbacks?.onOpenThread;
    this.onAddComment = callbacks?.onAddComment;
    this.onAddReply = callbacks?.onAddReply;
    this.onResolve = callbacks?.onResolve;
    this.onDelete = callbacks?.onDelete;
    this.onDeleteReply = callbacks?.onDeleteReply;
    this.onEditComment = callbacks?.onEditComment;
    this.onEditReply = callbacks?.onEditReply;
    this.getPeers = callbacks?.getPeers;
  }

  setPendingSelection(selection: { rangeText: string; rangeOffset: number; rangeContext: string; rangeLength: number } | null): void {
    this.pendingSelection = selection;
  }

  getThreadCount(): number {
    return this.threads.length;
  }

  getThreads(): CommentThread[] {
    return this.threads;
  }

  async refresh(container: HTMLElement, filePath: string): Promise<void> {
    this.loadDraft(filePath);
    this.threads = await this.store.getThreadsForFile(filePath);
    this.container = container;
    this.renderAll(container);
  }

  async loadThreads(filePath: string): Promise<void> {
    this.loadDraft(filePath);
    this.threads = await this.store.getThreadsForFile(filePath);
  }

  render(container: HTMLElement): void {
    this.container = container;
    this.renderAll(container);
  }

  private loadDraft(filePath: string): void {
    const draft = this.editors[0]?.getText() ?? "";
    const sameFile = filePath === this.currentFilePath;
    this.currentFilePath = filePath;
    this.draftText = sameFile ? draft : "";
  }

  destroy(): void {
    this.destroyEditors();
  }

  private renderAll(container: HTMLElement): void {
    this.renderGeneration++;
    this.destroyEditors();
    container.empty();

    this.renderInput(container);
    this.renderThreads(container);
  }

  private renderInput(container: HTMLElement): void {
    const inputContainer = container.createDiv({ cls: "yaos-extension-comment-input" });

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
    } else if (this.draftText) {
      handle.setText(this.draftText);
      this.draftText = "";
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

  private renderThreads(container: HTMLElement): void {
    if (this.threads.length === 0) {
      const empty = container.createDiv({ cls: "yaos-extension-comment-empty" });
      empty.createSpan({ text: "No comments on this file" });
      return;
    }

    const unresolved = this.threads.filter(t => !t.comment.resolved);
    const resolved = this.threads.filter(t => t.comment.resolved);

    for (const thread of unresolved) {
      this.renderThreadCard(container, thread);
    }

    if (resolved.length > 0) {
      container.createDiv({ cls: "yaos-extension-comment-resolved-divider", text: "Resolved" });
      for (const thread of resolved) {
        this.renderThreadCard(container, thread);
      }
    }
  }

  private renderThreadCard(container: HTMLElement, thread: CommentThread): void {
    const card = container.createDiv({
      cls: `yaos-extension-comment-thread${thread.comment.resolved ? " resolved" : ""}`,
    });

    const wrapper = card.createDiv({ cls: "yaos-extension-thread-wrapper" });
    this.renderCommentItem(wrapper, thread.comment, thread.comment.id);

    if (thread.replies.length > 3) {
      const isCollapsed = this.collapsedReplies.has(thread.comment.id);

      const showBtn = wrapper.createDiv({ cls: "yaos-extension-show-replies" });
      const repliesContainer = wrapper.createDiv({ cls: "yaos-extension-comment-replies" });

      if (isCollapsed) {
        showBtn.textContent = `Show ${thread.replies.length} ${thread.replies.length === 1 ? "reply" : "replies"}`;
      } else {
        showBtn.textContent = "Hide replies";
        repliesContainer.classList.add("expanded");
        this.renderReplyItems(repliesContainer, thread);
      }

      showBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.collapsedReplies.has(thread.comment.id)) {
          this.collapsedReplies.delete(thread.comment.id);
        } else {
          this.collapsedReplies.add(thread.comment.id);
        }
        if (this.container) this.renderAll(this.container);
      });
    } else if (thread.replies.length > 0) {
      const repliesContainer = wrapper.createDiv({ cls: "yaos-extension-comment-replies expanded" });
      this.renderReplyItems(repliesContainer, thread);
    }

    this.renderReplyInput(wrapper, thread);
  }

  private renderCommentItem(parent: HTMLElement, comment: Comment | Reply, threadId: string): void {
    const item = parent.createDiv({ cls: "yaos-extension-comment-item" });

    const row = item.createDiv({ cls: "yaos-extension-comment-item-row" });
    const avatar = row.createDiv({ cls: "yaos-extension-avatar" });
    avatar.style.backgroundColor = comment.authorColor;
    avatar.textContent = comment.author.charAt(0).toUpperCase();

    row.createSpan({ cls: "yaos-extension-author-name", text: comment.author });
    row.createSpan({ cls: "yaos-extension-timestamp", text: this.formatRelativeTime(comment.createdAt) });
    if (comment.editedAt) {
      row.createSpan({ cls: "yaos-extension-edited-indicator", text: "(edited)" });
    }

    const threadLine = item.createDiv({ cls: "yaos-extension-thread-line" });

    const isEditing = this.editingCommentId === comment.id || this.editingReplyId === comment.id;

    const bodyContainer = item.createDiv({ cls: "yaos-extension-comment-item-body" });

    if ("rangeText" in comment) {
      const quote = bodyContainer.createDiv({ cls: "yaos-extension-comment-quote" });
      quote.createSpan({ text: (comment as Comment).rangeText });
    }

    const body = bodyContainer.createDiv({ cls: "yaos-extension-comment-body" });

    if (isEditing) {
      const editContainer = body.createDiv({ cls: "yaos-extension-comment-edit-mode" });

      const extensions = this.getPeers
        ? [editorMentionExtension(this.getPeers)]
        : [];

      const editHandle = createEmbeddedEditor(editContainer, {
        extraExtensions: extensions,
        app: this.app,
      });
      editHandle.setText(comment.text);
      editHandle.focus();
      this.editors.push(editHandle);

      const btnRow = editContainer.createDiv({ cls: "yaos-extension-edit-btn-row" });
      const saveBtn = btnRow.createEl("button", { cls: "yaos-extension-edit-save-btn", text: "Save" });
      const cancelBtn = btnRow.createEl("button", { cls: "yaos-extension-edit-cancel-btn", text: "Cancel" });
      saveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const newText = editHandle.getText().trim();
        if (!newText) return;
        this.editingCommentId = null;
        this.editingReplyId = null;
        if ("commentId" in comment) {
          this.onEditReply?.(comment.id, newText);
        } else {
          this.onEditComment?.(comment.id, newText);
        }
      });
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.editingCommentId = null;
        this.editingReplyId = null;
        if (this.container) this.renderAll(this.container);
      });
    } else {
      void this.renderCommentBody(body, comment.text);
    }

    const actions = item.createDiv({ cls: "yaos-extension-comment-actions" });

    const resolveBtn = actions.createEl("button", {
      cls: "clickable-icon yaos-extension-resolve-btn",
    });
    const isResolved = "resolved" in comment && (comment as Comment).resolved;
    setIcon(resolveBtn, "check");
    resolveBtn.setAttribute("aria-label", isResolved ? "Reopen" : "Resolve");
    resolveBtn.title = isResolved ? "Reopen" : "Resolve";
    resolveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onResolve?.(threadId, !isResolved);
    });

    if (comment.author === this.localDeviceName) {
      if (!isEditing) {
        const editBtn = actions.createEl("button", {
          cls: "clickable-icon yaos-extension-edit-btn",
        });
        setIcon(editBtn, "pencil");
        editBtn.setAttribute("aria-label", "Edit");
        editBtn.title = "Edit";
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if ("commentId" in comment) {
            this.editingReplyId = comment.id;
            this.editingCommentId = null;
          } else {
            this.editingCommentId = comment.id;
            this.editingReplyId = null;
          }
          if (this.container) this.renderAll(this.container);
        });
      }
      const deleteBtn = actions.createEl("button", {
        cls: "clickable-icon yaos-extension-delete-btn",
      });
      setIcon(deleteBtn, "trash-2");
      deleteBtn.setAttribute("aria-label", "Delete");
      deleteBtn.title = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if ("commentId" in comment) {
          this.onDeleteReply?.(comment.id);
        } else {
          this.onDelete?.(comment.id);
        }
      });
    }
  }

  private renderReplyItems(container: HTMLElement, thread: CommentThread): void {
    container.empty();

    for (const reply of thread.replies) {
      this.renderCommentItem(container, reply, thread.comment.id);
    }
  }

  private renderReplyInput(parent: HTMLElement, thread: CommentThread): void {
    const replyInput = parent.createDiv({ cls: "yaos-extension-reply-input" });

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
      await MarkdownRenderer.render(this.app, text, container, this.currentFilePath, component);
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

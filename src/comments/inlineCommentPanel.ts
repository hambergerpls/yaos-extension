import type { App } from "obsidian";
import { CommentStore } from "./commentStore";
import { CommentRenderer, type CommentRendererCallbacks } from "./commentRenderer";
import type { KnownDevice } from "../yaosApi";

export class InlineCommentPanel {
  private renderer: CommentRenderer;
  private panelEl: HTMLElement | null = null;
  private scrollerEl: HTMLElement | null = null;

  constructor(
    store: CommentStore,
    app: App,
    callbacks?: {
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
    },
  ) {
    this.renderer = new CommentRenderer(store, app, callbacks, { maxUnresolved: 1 });
  }

  attach(scroller: HTMLElement): void {
    if (this.panelEl) return;

    this.scrollerEl = scroller;
    const sizer = scroller.querySelector(".cm-sizer");
    if (!sizer) return;

    const contentContainer = sizer.querySelector(".cm-contentContainer");
    if (!contentContainer) return;

    this.panelEl = sizer.createDiv({ cls: "yaos-extension-inline-comment-panel" });
    sizer.insertBefore(this.panelEl, contentContainer);
  }

  detach(): void {
    if (!this.panelEl) return;
    this.renderer.destroy();
    this.panelEl.remove();
    this.panelEl = null;
    this.scrollerEl = null;
  }

  setPendingSelection(selection: { rangeText: string; rangeOffset: number; rangeContext: string; rangeLength: number } | null): void {
    this.renderer.setPendingSelection(selection);
  }

  async refresh(filePath: string): Promise<void> {
    if (!this.panelEl) return;
    await this.renderer.refresh(this.panelEl, filePath);
  }
}

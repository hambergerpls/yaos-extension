import { ItemView, type App } from "obsidian";
import { CommentStore } from "./commentStore";
import { CommentRenderer, type CommentRendererCallbacks } from "./commentRenderer";
import type { KnownDevice } from "../yaosApi";

export const COMMENTS_VIEW_TYPE = "yaos-extension-comments";

export class CommentView extends ItemView {
  private renderer: CommentRenderer;
  private store: CommentStore;
  private appInstance: App;

  constructor(
    leaf: any,
    store: CommentStore,
    app: App,
    callbacks?: CommentRendererCallbacks,
  ) {
    super(leaf);
    this.store = store;
    this.appInstance = app;
    this.renderer = new CommentRenderer(store, app, callbacks);
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
    this.containerEl.addEventListener("click", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest("a.internal-link") as HTMLElement | null;
      if (link) {
        e.preventDefault();
        const href = link.getAttribute("data-href") || link.getAttribute("href");
        if (href) {
          this.appInstance.workspace.openLinkText(href, "");
        }
      }
    });
  }

  async onClose(): Promise<void> {
    this.renderer.destroy();
  }

  async refresh(filePath: string): Promise<void> {
    await this.renderer.refresh(this.contentEl, filePath);
  }

  setPendingSelection(selection: { rangeText: string; rangeOffset: number; rangeContext: string; rangeLength: number } | null): void {
    this.renderer.setPendingSelection(selection);
  }

  getThreads() {
    return this.renderer.getThreads();
  }
}

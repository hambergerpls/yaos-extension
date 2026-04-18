import { ItemView, WorkspaceLeaf } from "obsidian";
import type { NotificationStore } from "./notificationStore";
import type { Notification } from "./types";

export const NOTIFICATIONS_VIEW_TYPE = "yaos-extension-notifications";

export class NotificationView extends ItemView {
  private store: NotificationStore;
  private deviceName: string;
  private onOpenFile: (fileId: string, commentId?: string) => void;
  private notifications: Notification[] = [];
  private refreshGeneration = 0;

  constructor(
    leaf: WorkspaceLeaf,
    store: NotificationStore,
    deviceName: string,
    onOpenFile: (fileId: string, commentId?: string) => void,
  ) {
    super(leaf);
    this.store = store;
    this.deviceName = deviceName;
    this.onOpenFile = onOpenFile;
  }

  getViewType(): string {
    return NOTIFICATIONS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Notifications";
  }

  getIcon(): string {
    return "bell";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async refresh(): Promise<void> {
    const gen = ++this.refreshGeneration;
    const next = await this.store.getNotificationsForDevice(this.deviceName);
    if (gen !== this.refreshGeneration) return;
    next.sort((a, b) => b.createdAt - a.createdAt);
    this.notifications = next;
    await this.render();
  }

  private async render(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("yaos-extension-notification-view");

    if (this.notifications.length === 0) {
      this.contentEl.createDiv({
        cls: "yaos-extension-notification-empty",
        text: "No notifications",
      });
      return;
    }

    const header = this.contentEl.createDiv({ cls: "yaos-extension-notification-header" });
    header.createSpan({ cls: "yaos-extension-notification-title", text: "Notifications" });

    const markAllBtn = header.createEl("button", {
      cls: "yaos-extension-notification-mark-all",
      text: "Mark all as read",
    });
    markAllBtn.addEventListener("click", async () => {
      await this.store.markAllAsRead(this.deviceName);
      await this.refresh();
    });

    for (const notif of this.notifications) {
      this.renderCard(notif);
    }
  }

  private renderCard(notif: Notification): void {
    const isUnread = !this.store.isRead(notif.id);
    const card = this.contentEl.createDiv({
      cls: `yaos-extension-notification-card${isUnread ? " unread" : ""}`,
    });
    card.setAttribute("data-id", notif.id);

    const kindIcon = card.createSpan({ cls: "yaos-extension-notification-kind-icon" });
    kindIcon.setAttribute("data-kind", notif.kind);

    const fromEl = card.createDiv({ cls: "yaos-extension-notification-from" });
    const dot = fromEl.createSpan({ cls: "yaos-extension-author-dot" });
    fromEl.createSpan({ text: `From: ${notif.fromDevice}` });

    const previewEl = card.createDiv({
      cls: "yaos-extension-notification-preview",
      text: notif.preview,
    });

    const fileEl = card.createDiv({
      cls: "yaos-extension-notification-file",
      text: notif.fileId,
    });

    card.createSpan({
      cls: "yaos-extension-timestamp",
      text: this.formatRelativeTime(notif.createdAt),
    });

    if (isUnread) {
      card.createSpan({ cls: "yaos-extension-notification-unread-dot" });
    }

    card.addEventListener("click", async () => {
      await this.store.markAsRead(notif.id);
      this.onOpenFile(notif.fileId, notif.commentId);
      await this.refresh();
    });
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

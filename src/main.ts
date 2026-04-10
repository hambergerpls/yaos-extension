import { Notice, Plugin, PluginSettingTab, App, Setting, MarkdownView } from "obsidian";
import {
  DEFAULT_SETTINGS,
  type YaosExtensionSettings,
} from "./settings";
import { PresenceTracker } from "./presenceTracker";
import { PresenceStatusBar } from "./statusBar";
import { isYaosAvailable, isYaosConnected, getLocalDeviceName, getRemotePeers, type RemotePeer } from "./yaosApi";
import { CommentStore } from "./comments/commentStore";
import { CommentView, COMMENTS_VIEW_TYPE } from "./comments/commentView";
import { registerCommentCommands, getSelectionInfo, type DeviceInfo } from "./comments/commentCommands";
import { NotificationStore } from "./notifications/notificationStore";
import { NotificationView, NOTIFICATIONS_VIEW_TYPE } from "./notifications/notificationView";
import { createMentionNotifications, createReplyNotification } from "./notifications/notificationHelpers";

export default class YaosExtensionPlugin extends Plugin {
  settings: YaosExtensionSettings = DEFAULT_SETTINGS;
  tracker: PresenceTracker | null = null;
  statusBar: PresenceStatusBar | null = null;
  statusBarEl: HTMLElement | null = null;
  commentStore: CommentStore | null = null;
  notificationStore: NotificationStore | null = null;

  async onload() {
    await this.loadSettings();

    this.applyCursorNames();

    this.statusBarEl = this.addStatusBarItem();
    this.statusBar = new PresenceStatusBar(this.statusBarEl, this.settings, () => {
      this.openNotificationsView();
    });

    if (!this.settings.showStatusBar) {
      this.statusBarEl.style.display = "none";
    }

    this.commentStore = new CommentStore(this.app.vault);
    await this.commentStore.ensureFolder();

    this.notificationStore = new NotificationStore(
      this.app.vault,
      async () => {
        const data = await this.loadData();
        return { readNotificationIds: (data as any)?.readNotificationIds ?? [] };
      },
      async (state) => {
        const data = (await this.loadData()) as any;
        await this.saveData({ ...data, readNotificationIds: state.readNotificationIds });
      },
    );
    await this.notificationStore.init();

    if (this.settings.showComments) {
      this.registerView(COMMENTS_VIEW_TYPE, (leaf) => {
        return new CommentView(leaf, this.commentStore!, {
          localDeviceName: getLocalDeviceName(this.app),
          onAddComment: (text: string) => this.handleAddComment(text),
          onAddReply: (commentId: string, text: string) => this.handleAddReply(commentId, text),
          onResolve: (commentId: string, resolved: boolean) => this.handleResolve(commentId, resolved),
          onDelete: (targetId: string) => this.handleDelete(targetId),
          onDeleteReply: (targetId: string) => this.handleDelete(targetId),
          getPeers: () => {
            const awareness = this.tracker?.currentAwareness;
            return awareness ? getRemotePeers(awareness) : [];
          },
        });
      });

      registerCommentCommands(this, this.commentStore, this.getDeviceInfo.bind(this), () => {
        this.refreshCommentView();
      });

      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          if (file.path.startsWith(".yaos-extension/comments/")) {
            this.refreshCommentView();
          }
        }),
      );

      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => {
          this.refreshCommentView();
        }),
      );
    }

    if (this.settings.showNotifications && this.notificationStore) {
      this.registerView(NOTIFICATIONS_VIEW_TYPE, (leaf) => {
        return new NotificationView(
          leaf,
          this.notificationStore!,
          getLocalDeviceName(this.app),
          (fileId, commentId) => this.openFileAndComment(fileId, commentId),
        );
      });

      this.addCommand({
        id: "open-notifications",
        name: "Open notifications",
        callback: () => this.openNotificationsView(),
      });

      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          if (file.path === ".yaos-extension/notifications.jsonl") {
            this.refreshNotifications();
          }
        }),
      );
    }

    if (!isYaosAvailable(this.app)) {
      this.statusBar.update([], false, "");
      new Notice("YAOS Extension: YAOS plugin not found. Please install and enable YAOS first.");
    } else {
      this.tracker = new PresenceTracker(this.app);
      this.tracker.start((peers: RemotePeer[]) => {
        this.onPresenceChange(peers);
      });
    }

    this.addSettingTab(new YaosExtensionSettingTab(this.app, this));
  }

  onunload() {
    this.tracker?.stop();
    this.statusBar?.destroy();
    document.body.classList.remove("yaos-extension-names");
    document.querySelectorAll(".yaos-extension-tooltip").forEach((el) => el.remove());
    document.querySelectorAll(".yaos-extension-mention-dropdown").forEach((el) => el.remove());
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  applyCursorNames() {
    if (this.settings.showCursorNames) {
      document.body.classList.add("yaos-extension-names");
    } else {
      document.body.classList.remove("yaos-extension-names");
    }
  }

  private async onPresenceChange(peers: RemotePeer[]) {
    const isConnected = isYaosConnected(this.app);
    const localName = getLocalDeviceName(this.app);
    const unreadCount = this.settings.showNotifications && this.notificationStore
      ? await this.notificationStore.getUnreadCount(localName)
      : undefined;
    this.statusBar?.update(peers, isConnected, localName, unreadCount);
  }

  private getDeviceInfo(): DeviceInfo {
    const awareness = this.tracker?.currentAwareness;
    let color = "#30bced";
    if (awareness) {
      const localState = awareness.getLocalState();
      const user = localState?.user as { color?: string } | undefined;
      if (user?.color) color = user.color;
    }
    return { name: getLocalDeviceName(this.app), color };
  }

  private getActiveFilePath(): string | null {
    const activeFile = this.app.workspace.getActiveFile();
    return activeFile?.path ?? null;
  }

  private async refreshCommentView(): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath) return;

    const leaves = this.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof CommentView) {
        await leaf.view.refresh(filePath);
      }
    }
  }

  private async openNotificationsView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(NOTIFICATIONS_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]!);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: NOTIFICATIONS_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private async openFileAndComment(fileId: string, commentId: string): Promise<void> {
    await this.app.workspace.openLinkText(fileId, "");
    await this.refreshCommentView();

    const leaves = this.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
    if (leaves.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: COMMENTS_VIEW_TYPE, active: true });
      }
    }
  }

  private async refreshNotifications(): Promise<void> {
    const localName = getLocalDeviceName(this.app);
    const unreadCount = await this.notificationStore?.getUnreadCount(localName);

    const leaves = this.app.workspace.getLeavesOfType(NOTIFICATIONS_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof NotificationView) {
        await leaf.view.refresh();
      }
    }

    if (this.tracker?.isReady) {
      const awareness = this.tracker.currentAwareness;
      if (awareness) {
        const peers = getRemotePeers(awareness);
        this.statusBar?.update(peers, isYaosConnected(this.app), localName, unreadCount);
      }
    }
  }

  private async handleAddComment(text: string): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath || !this.commentStore) return;

    const deviceInfo = this.getDeviceInfo();
    const mentions = CommentStore.extractMentions(text);

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    let rangeText = "";
    let rangeContext = "";
    let rangeOffset = 0;
    let rangeLength = 0;

    if (activeView?.editor.somethingSelected()) {
      const info = getSelectionInfo(activeView.editor);
      if (info) {
        rangeText = info.rangeText;
        rangeContext = info.rangeContext;
        rangeOffset = info.rangeOffset;
        rangeLength = info.rangeLength;
      }
    }

    const commentId = crypto.randomUUID();
    await this.commentStore.addComment(filePath, {
      type: "comment",
      id: commentId,
      text,
      author: deviceInfo.name,
      authorColor: deviceInfo.color,
      createdAt: Date.now(),
      rangeText,
      rangeContext,
      rangeOffset,
      rangeLength,
      resolved: false,
      mentions,
    });

    await this.generateNotificationsForComment(commentId, filePath, text, mentions, deviceInfo.name);
    await this.refreshCommentView();
  }

  private async handleAddReply(commentId: string, text: string): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath || !this.commentStore) return;

    const deviceInfo = this.getDeviceInfo();
    const mentions = CommentStore.extractMentions(text);

    const replyId = crypto.randomUUID();
    await this.commentStore.addReply(filePath, {
      type: "reply",
      id: replyId,
      commentId,
      text,
      author: deviceInfo.name,
      authorColor: deviceInfo.color,
      createdAt: Date.now(),
      mentions,
    });

    await this.generateNotificationsForReply(commentId, replyId, filePath, text, mentions, deviceInfo.name);
    await this.refreshCommentView();
  }

  private async handleResolve(commentId: string, resolved: boolean): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath || !this.commentStore) return;

    const deviceInfo = this.getDeviceInfo();
    await this.commentStore.resolveComment(filePath, commentId, resolved, deviceInfo.name);
    await this.refreshCommentView();
  }

  private async handleDelete(targetId: string): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath || !this.commentStore) return;

    const deviceInfo = this.getDeviceInfo();
    const threads = await this.commentStore.getThreadsForFile(filePath);
    const isOwner = threads.some(
      t => (t.comment.id === targetId && t.comment.author === deviceInfo.name) ||
        t.replies.some(r => r.id === targetId && r.author === deviceInfo.name),
    );
    if (!isOwner) return;

    await this.commentStore.deleteEntry(filePath, targetId, deviceInfo.name);
    await this.refreshCommentView();
  }

  private async generateNotificationsForComment(
    commentId: string,
    filePath: string,
    text: string,
    mentions: string[],
    fromDevice: string,
  ): Promise<void> {
    if (!this.notificationStore || mentions.length === 0) return;

    const notifications = createMentionNotifications({
      commentId,
      fileId: filePath,
      fromDevice,
      mentions,
      preview: text,
    });

    for (const notif of notifications) {
      await this.notificationStore.addNotification(notif);
    }
  }

  private async generateNotificationsForReply(
    commentId: string,
    replyId: string,
    filePath: string,
    text: string,
    mentions: string[],
    fromDevice: string,
  ): Promise<void> {
    if (!this.notificationStore) return;

    const threads = await this.commentStore!.getThreadsForFile(filePath);
    const thread = threads.find(t => t.comment.id === commentId);
    if (!thread) return;

    if (mentions.length > 0) {
      const mentionNotifs = createMentionNotifications({
        commentId,
        replyId,
        fileId: filePath,
        fromDevice,
        mentions,
        preview: text,
      });
      for (const notif of mentionNotifs) {
        await this.notificationStore.addNotification(notif);
      }
    }

    const replyNotif = createReplyNotification({
      commentId,
      replyId,
      fileId: filePath,
      fromDevice,
      commentAuthor: thread.comment.author,
      preview: text,
    });
    if (replyNotif) {
      await this.notificationStore.addNotification(replyNotif);
    }
  }
}

class YaosExtensionSettingTab extends PluginSettingTab {
  plugin: YaosExtensionPlugin;

  constructor(app: App, plugin: YaosExtensionPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.textContent = "";

    const heading = document.createElement("h2");
    heading.textContent = "YAOS Extension";
    containerEl.appendChild(heading);

    if (!isYaosAvailable(this.app)) {
      const warning = document.createElement("p");
      warning.textContent = "YAOS plugin is not installed or enabled. This extension requires YAOS to function.";
      warning.className = "mod-warning";
      containerEl.appendChild(warning);
      return;
    }

    new Setting(containerEl)
      .setName("Show collaborator names on cursors")
      .setDesc(
        "Display the device name next to each remote collaborator's cursor " +
        "in the editor. Names appear when you hover over a cursor caret."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCursorNames)
          .onChange(async (value) => {
            this.plugin.settings.showCursorNames = value;
            await this.plugin.saveSettings();
            this.plugin.applyCursorNames();
          })
      );

    new Setting(containerEl)
      .setName("Show presence in status bar")
      .setDesc(
        "Display a status bar item showing how many collaborators are " +
        "currently connected and their names."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusBar)
          .onChange(async (value) => {
            this.plugin.settings.showStatusBar = value;
            await this.plugin.saveSettings();
            if (value) {
              this.plugin.statusBarEl?.style.removeProperty("display");
            } else if (this.plugin.statusBarEl) {
              this.plugin.statusBarEl.style.display = "none";
            }
          })
      );

    new Setting(containerEl)
      .setName("Show peer color dots in status bar")
      .setDesc(
        "Show colored dots for each connected collaborator in the status bar, " +
        "using their awareness color."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showPeerDotsInStatusBar)
          .onChange(async (value) => {
            this.plugin.settings.showPeerDotsInStatusBar = value;
            await this.plugin.saveSettings();
            const awareness = this.plugin.tracker?.currentAwareness;
            if (awareness) {
              const peers = getRemotePeers(awareness);
              const isConnected = isYaosConnected(this.app);
              const localName = getLocalDeviceName(this.app);
              this.plugin.statusBar?.update(peers, isConnected, localName);
            }
          })
      );

    new Setting(containerEl)
      .setName("Show comments")
      .setDesc(
        "Enable inline comment highlights in the editor and the comments sidebar panel."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showComments)
          .onChange(async (value) => {
            this.plugin.settings.showComments = value;
            await this.plugin.saveSettings();
            new Notice("Reload the plugin for this change to take effect.");
          })
      );

    new Setting(containerEl)
      .setName("Show notifications")
      .setDesc(
        "Show the notification badge in the status bar and the notification panel."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNotifications)
          .onChange(async (value) => {
            this.plugin.settings.showNotifications = value;
            await this.plugin.saveSettings();
            new Notice("Reload the plugin for this change to take effect.");
          })
      );
  }
}

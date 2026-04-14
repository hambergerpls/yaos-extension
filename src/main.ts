import { Notice, Plugin, PluginSettingTab, App, Setting, MarkdownView } from "obsidian";
import {
  DEFAULT_SETTINGS,
  type YaosExtensionSettings,
} from "./settings";
import { PresenceTracker } from "./presenceTracker";
import { PresenceStatusBar } from "./statusBar";
import { isYaosAvailable, isYaosConnected, getLocalDeviceName, getRemotePeers, getAllKnownDevices, type RemotePeer, type KnownDevice, type DeviceRecord } from "./yaosApi";
import { CommentStore } from "./comments/commentStore";
import { InlineCommentPanel } from "./comments/inlineCommentPanel";
import { registerCommentCommands, getSelectionInfo, type DeviceInfo } from "./comments/commentCommands";
import { NotificationStore } from "./notifications/notificationStore";
import { NotificationView, NOTIFICATIONS_VIEW_TYPE } from "./notifications/notificationView";
import { createMentionNotifications, createReplyNotification, createDocumentMentionNotification } from "./notifications/notificationHelpers";
import { DeviceStore } from "./deviceStore";
import type { DeviceRegistry } from "./deviceStore";
import { log } from "./logger";
import { editorMentionExtension } from "./mentions/editorMentionPlugin";
import { CommentView, COMMENTS_VIEW_TYPE } from "./comments/commentView";
import { resetEditorDiscovery } from "./comments/editorDiscovery";

export default class YaosExtensionPlugin extends Plugin {
  settings: YaosExtensionSettings = DEFAULT_SETTINGS;
  tracker: PresenceTracker | null = null;
  statusBar: PresenceStatusBar | null = null;
  statusBarEl: HTMLElement | null = null;
  commentStore: CommentStore | null = null;
  notificationStore: NotificationStore | null = null;
  deviceStore: DeviceStore | null = null;
  deviceRegistry: DeviceRegistry = {};
  inlinePanel: InlineCommentPanel | null = null;

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

    this.deviceStore = new DeviceStore(this.app.vault);
    this.deviceRegistry = await this.deviceStore.load();

    if (this.settings.showComments) {
      this.inlinePanel = new InlineCommentPanel(this.commentStore!, this.app, {
        localDeviceName: getLocalDeviceName(this.app),
        onAddComment: (text: string) => this.handleAddComment(text),
        onAddReply: (commentId: string, text: string) => this.handleAddReply(commentId, text),
        onResolve: (commentId: string, resolved: boolean) => this.handleResolve(commentId, resolved),
        onDelete: (targetId: string) => this.handleDelete(targetId),
        onDeleteReply: (targetId: string) => this.handleDelete(targetId),
        onEditComment: (commentId: string, newText: string) => this.handleEditComment(commentId, newText),
        onEditReply: (replyId: string, newText: string) => this.handleEditReply(replyId, newText),
        getPeers: () => {
          return getAllKnownDevices(this.app, this.tracker?.currentAwareness ?? null, this.deviceRegistry);
        },
      });

      this.registerView(COMMENTS_VIEW_TYPE, (leaf) => {
        return new CommentView(
          leaf,
          this.commentStore!,
          this.app,
          {
            localDeviceName: getLocalDeviceName(this.app),
            onAddComment: (text: string) => this.handleAddComment(text),
            onAddReply: (commentId: string, text: string) => this.handleAddReply(commentId, text),
            onResolve: (commentId: string, resolved: boolean) => this.handleResolve(commentId, resolved),
            onDelete: (targetId: string) => this.handleDelete(targetId),
            onDeleteReply: (targetId: string) => this.handleDelete(targetId),
            onEditComment: (commentId: string, newText: string) => this.handleEditComment(commentId, newText),
            onEditReply: (replyId: string, newText: string) => this.handleEditReply(replyId, newText),
            getPeers: () => {
              return getAllKnownDevices(this.app, this.tracker?.currentAwareness ?? null, this.deviceRegistry);
            },
          },
        );
      });

      this.addCommand({
        id: "toggle-comment-sidebar",
        name: "Toggle comment sidebar",
        callback: () => this.toggleCommentSidebar(),
      });

      registerCommentCommands(this, this.commentStore, this.getDeviceInfo.bind(this), () => {
        this.refreshCommentView();
      }, (selection) => {
        if (this.inlinePanel) {
          this.inlinePanel.setPendingSelection(selection);
          this.attachInlinePanel();
          this.refreshCommentView();
        }
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
          this.attachInlinePanel();
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
          (fileId, commentId?) => this.openFileAndComment(fileId, commentId),
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

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file.path === ".yaos-extension/devices.json") {
          this.refreshDeviceRegistry();
        }
      }),
    );

    if (!isYaosAvailable(this.app)) {
      this.statusBar.update([], false, "");
      new Notice("YAOS Extension: YAOS plugin not found. Please install and enable YAOS first.");
    } else {
      this.tracker = new PresenceTracker(this.app);
      this.tracker.start((peers: RemotePeer[]) => {
        this.onPresenceChange(peers);
      });

      this.registerSelfDevice();
    }

    this.addSettingTab(new YaosExtensionSettingTab(this.app, this));

    this.registerEditorExtension(
      editorMentionExtension(
        () => {
          return getAllKnownDevices(this.app, this.tracker?.currentAwareness ?? null, this.deviceRegistry);
        },
        (peerName: string) => {
          if (!this.notificationStore) return;
          const filePath = this.getActiveFilePath();
          if (!filePath) return;
          const localName = getLocalDeviceName(this.app);
          if (localName === peerName) return;
          const notification = createDocumentMentionNotification({
            fileId: filePath,
            fromDevice: localName,
            targetDevice: peerName,
            preview: `@${peerName}`,
          });
          this.notificationStore.addNotification(notification);
        },
      ),
    );
  }

  onunload() {
    this.inlinePanel?.detach();
    this.tracker?.stop();
    this.statusBar?.destroy();
    resetEditorDiscovery();
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

    if (this.deviceStore) {
      for (const peer of peers) {
        await this.deviceStore.registerDevice(peer.name, peer.color);
      }
      this.deviceRegistry = await this.deviceStore.load();
    }
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

  private async registerSelfDevice(): Promise<void> {
    if (!this.deviceStore) return;
    const info = this.getDeviceInfo();
    await this.deviceStore.registerDevice(info.name, info.color);
    this.deviceRegistry = await this.deviceStore.load();
  }

  private async refreshDeviceRegistry(): Promise<void> {
    if (!this.deviceStore) return;
    this.deviceRegistry = await this.deviceStore.load();
  }

  private getActiveFilePath(): string | null {
    const activeFile = this.app.workspace.getActiveFile();
    return activeFile?.path ?? null;
  }

  private attachInlinePanel(): void {
    if (!this.inlinePanel) return;

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;

    const scroller = activeView.containerEl.querySelector(".cm-scroller") as HTMLElement | null;
    if (!scroller) return;

    this.inlinePanel.detach();
    this.inlinePanel.attach(scroller);
  }

  private async refreshCommentView(): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath) return;

    if (this.inlinePanel) {
      await this.inlinePanel.refresh(filePath);
    }

    const leaves = this.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof CommentView) {
        await leaf.view.refresh(filePath);
      }
    }
  }

  private async toggleCommentSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
    if (existing.length > 0) {
      existing.forEach(leaf => leaf.detach());
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: COMMENTS_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
      const filePath = this.getActiveFilePath();
      if (filePath && leaf.view instanceof CommentView) {
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

  private async openFileAndComment(fileId: string, commentId?: string): Promise<void> {
    await this.app.workspace.openLinkText(fileId, "");

    if (!commentId) return;

    this.attachInlinePanel();
    await this.refreshCommentView();
  }

  private async refreshNotifications(): Promise<void> {
    const localName = getLocalDeviceName(this.app);
    const unreadCount = await this.notificationStore?.getUnreadCount(localName);
    log("refreshNotifications: localName=%s unreadCount=%s", localName, unreadCount);

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
    log("handleAddComment: text=%s mentions=%o author=%s", JSON.stringify(text), mentions, deviceInfo.name);

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
    log("handleAddReply: commentId=%s text=%s mentions=%o author=%s", commentId, JSON.stringify(text), mentions, deviceInfo.name);

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

  private async handleEditComment(commentId: string, newText: string): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath || !this.commentStore) return;

    const deviceInfo = this.getDeviceInfo();
    const threads = await this.commentStore.getThreadsForFile(filePath);
    const thread = threads.find(t => t.comment.id === commentId);
    if (!thread || thread.comment.author !== deviceInfo.name) return;

    const originalMentions = thread.comment.mentions;
    await this.commentStore.editEntry(filePath, commentId, newText, deviceInfo.name);

    const newMentions = CommentStore.extractMentions(newText);
    const addedMentions = newMentions.filter(m => !originalMentions.includes(m));
    await this.generateNotificationsForEdit(commentId, undefined, filePath, newText, addedMentions, deviceInfo.name);

    await this.refreshCommentView();
  }

  private async handleEditReply(replyId: string, newText: string): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath || !this.commentStore) return;

    const deviceInfo = this.getDeviceInfo();
    const threads = await this.commentStore.getThreadsForFile(filePath);
    let originalMentions: string[] = [];
    let commentId: string | undefined;
    for (const t of threads) {
      const reply = t.replies.find(r => r.id === replyId);
      if (reply) {
        if (reply.author !== deviceInfo.name) return;
        originalMentions = reply.mentions;
        commentId = t.comment.id;
        break;
      }
    }
    if (!commentId) return;

    await this.commentStore.editEntry(filePath, replyId, newText, deviceInfo.name);

    const newMentions = CommentStore.extractMentions(newText);
    const addedMentions = newMentions.filter(m => !originalMentions.includes(m));
    await this.generateNotificationsForEdit(commentId, replyId, filePath, newText, addedMentions, deviceInfo.name);

    await this.refreshCommentView();
  }

  private async generateNotificationsForEdit(
    commentId: string,
    replyId: string | undefined,
    filePath: string,
    text: string,
    addedMentions: string[],
    fromDevice: string,
  ): Promise<void> {
    if (!this.notificationStore || addedMentions.length === 0) return;

    const notifications = createMentionNotifications({
      commentId,
      replyId,
      fileId: filePath,
      fromDevice,
      mentions: addedMentions,
      preview: text,
    });

    for (const notif of notifications) {
      await this.notificationStore.addNotification(notif);
    }
  }

  private async generateNotificationsForComment(
    commentId: string,
    filePath: string,
    text: string,
    mentions: string[],
    fromDevice: string,
  ): Promise<void> {
    if (!this.notificationStore || mentions.length === 0) {
      log("generateNotificationsForComment: skipped (store=%s mentions=%d)", !!this.notificationStore, mentions.length);
      return;
    }

    const notifications = createMentionNotifications({
      commentId,
      fileId: filePath,
      fromDevice,
      mentions,
      preview: text,
    });

    log("generateNotificationsForComment: created %d mention notifications for %o", notifications.length, mentions);
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
    if (!thread) {
      log("generateNotificationsForReply: no thread found for commentId=%s", commentId);
      return;
    }

    let totalNotifs = 0;

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
      totalNotifs += mentionNotifs.length;
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
      totalNotifs++;
    }

    log("generateNotificationsForReply: created %d notifications (mentions=%o, commentAuthor=%s, fromDevice=%s)", totalNotifs, mentions, thread.comment.author, fromDevice);
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
        "Enable inline comment highlights in the editor and the inline comments panel."
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

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

export default class YaosExtensionPlugin extends Plugin {
  settings: YaosExtensionSettings = DEFAULT_SETTINGS;
  tracker: PresenceTracker | null = null;
  statusBar: PresenceStatusBar | null = null;
  statusBarEl: HTMLElement | null = null;
  commentStore: CommentStore | null = null;

  async onload() {
    await this.loadSettings();

    this.applyCursorNames();

    this.statusBarEl = this.addStatusBarItem();
    this.statusBar = new PresenceStatusBar(this.statusBarEl, this.settings);

    if (!this.settings.showStatusBar) {
      this.statusBarEl.style.display = "none";
    }

    this.commentStore = new CommentStore(this.app.vault);
    await this.commentStore.ensureFolder();

    if (this.settings.showComments) {
      this.registerView(COMMENTS_VIEW_TYPE, (leaf) => {
        return new CommentView(leaf, this.commentStore!, {
          onAddComment: (text: string) => this.handleAddComment(text),
          onAddReply: (commentId: string, text: string) => this.handleAddReply(commentId, text),
          onResolve: (commentId: string, resolved: boolean) => this.handleResolve(commentId, resolved),
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

  private onPresenceChange(peers: RemotePeer[]) {
    const isConnected = isYaosConnected(this.app);
    const localName = getLocalDeviceName(this.app);
    this.statusBar?.update(peers, isConnected, localName);
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

    await this.commentStore.addComment(filePath, {
      type: "comment",
      id: crypto.randomUUID(),
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

    await this.refreshCommentView();
  }

  private async handleAddReply(commentId: string, text: string): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath || !this.commentStore) return;

    const deviceInfo = this.getDeviceInfo();
    const mentions = CommentStore.extractMentions(text);

    await this.commentStore.addReply(filePath, {
      type: "reply",
      id: crypto.randomUUID(),
      commentId,
      text,
      author: deviceInfo.name,
      authorColor: deviceInfo.color,
      createdAt: Date.now(),
      mentions,
    });

    await this.refreshCommentView();
  }

  private async handleResolve(commentId: string, resolved: boolean): Promise<void> {
    const filePath = this.getActiveFilePath();
    if (!filePath || !this.commentStore) return;

    const deviceInfo = this.getDeviceInfo();
    await this.commentStore.resolveComment(filePath, commentId, resolved, deviceInfo.name);
    await this.refreshCommentView();
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

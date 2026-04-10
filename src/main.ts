import { Notice, Plugin, PluginSettingTab, App, Setting } from "obsidian";
import {
  DEFAULT_SETTINGS,
  type YaosExtensionSettings,
} from "./settings";
import { PresenceTracker } from "./presenceTracker";
import { PresenceStatusBar } from "./statusBar";
import { isYaosAvailable, isYaosConnected, getLocalDeviceName, getRemotePeers, type RemotePeer } from "./yaosApi";

export default class YaosExtensionPlugin extends Plugin {
  settings: YaosExtensionSettings = DEFAULT_SETTINGS;
  tracker: PresenceTracker | null = null;
  statusBar: PresenceStatusBar | null = null;
  statusBarEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    this.applyCursorNames();

    this.statusBarEl = this.addStatusBarItem();
    this.statusBar = new PresenceStatusBar(this.statusBarEl, this.settings);

    if (!this.settings.showStatusBar) {
      this.statusBarEl.style.display = "none";
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
  }
}

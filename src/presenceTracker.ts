import { App } from "obsidian";
import {
  getAwareness,
  isYaosAvailable,
  getRemotePeers,
  type AwarenessLike,
  type AwarenessChangeData,
  type RemotePeer,
} from "./yaosApi";

export type PresenceChangeCallback = (
  peers: RemotePeer[],
  awareness: AwarenessLike
) => void;

export class PresenceTracker {
  private app: App;
  private awareness: AwarenessLike | null = null;
  private handler: ((data: AwarenessChangeData, origin: unknown) => void) | null = null;
  private callback: PresenceChangeCallback | null = null;
  private pollingInterval: number | null = null;
  private initialized = false;

  constructor(app: App) {
    this.app = app;
  }

  start(onChange: PresenceChangeCallback): void {
    this.callback = onChange;
    this.tryConnect();
  }

  stop(): void {
    this.detachFromAwareness();
    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.callback = null;
    this.initialized = false;
    this.awareness = null;
  }

  private tryConnect(): void {
    if (!isYaosAvailable(this.app)) {
      this.pollingInterval = window.setInterval(() => {
        if (isYaosAvailable(this.app)) {
          if (this.pollingInterval !== null) {
            window.clearInterval(this.pollingInterval);
            this.pollingInterval = null;
          }
          this.tryConnect();
        }
      }, 2000);
      return;
    }

    const awareness = getAwareness(this.app);
    if (!awareness) {
      this.pollingInterval = window.setInterval(() => {
        const aw = getAwareness(this.app);
        if (aw) {
          if (this.pollingInterval !== null) {
            window.clearInterval(this.pollingInterval);
            this.pollingInterval = null;
          }
          this.attachToAwareness(aw);
        }
      }, 3000);
      return;
    }

    this.attachToAwareness(awareness);
  }

  private attachToAwareness(awareness: AwarenessLike): void {
    this.awareness = awareness;
    this.initialized = true;

    this.handler = (_data: AwarenessChangeData, _origin: unknown) => {
      this.notifyCallback();
    };

    awareness.on("change", this.handler);
    this.notifyCallback();
  }

  private detachFromAwareness(): void {
    if (this.handler && this.awareness) {
      try {
        this.awareness.off("change", this.handler);
      } catch {
        // Awareness may have been destroyed
      }
    }
    this.handler = null;
  }

  private notifyCallback(): void {
    if (this.callback && this.awareness) {
      const peers = getRemotePeers(this.awareness);
      this.callback(peers, this.awareness);
    }
  }

  get isReady(): boolean {
    return this.initialized;
  }

  get currentAwareness(): AwarenessLike | null {
    return this.awareness;
  }
}

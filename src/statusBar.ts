import { type RemotePeer } from "./yaosApi";
import { type YaosExtensionSettings } from "./settings";

function createEl(tag: string, cls?: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

export class PresenceStatusBar {
  private statusBarEl: HTMLElement;
  private settings: YaosExtensionSettings;
  private tooltipEl: HTMLElement | null = null;
  private onBadgeClick?: () => void;

  constructor(statusBarEl: HTMLElement, settings: YaosExtensionSettings, onBadgeClick?: () => void) {
    this.statusBarEl = statusBarEl;
    this.settings = settings;
    this.onBadgeClick = onBadgeClick;
    this.statusBarEl.classList.add("yaos-extension-statusbar");
  }

  update(peers: RemotePeer[], isConnected: boolean, _localDeviceName: string, unreadCount?: number): void {
    this.statusBarEl.textContent = "";

    if (!isConnected && peers.length === 0) {
      this.renderDisconnected();
      this.renderBadge(unreadCount);
      return;
    }

    const dot = createEl("span", "yaos-extension-dot connected");
    dot.setAttribute("aria-label", isConnected ? "Sync connected" : "Sync disconnected");
    this.statusBarEl.appendChild(dot);

    if (peers.length === 0 && isConnected) {
      this.statusBarEl.appendChild(createEl("span", undefined, "1 device online"));
      this.renderBadge(unreadCount);
      return;
    }

    if (peers.length === 1) {
      this.statusBarEl.appendChild(createEl("span", undefined, `You + ${peers[0]!.name}`));
    } else {
      this.statusBarEl.appendChild(createEl("span", undefined, `You + ${peers.length} collaborators`));
    }

    if (this.settings.showPeerDotsInStatusBar) {
      const peersContainer = createEl("span", "yaos-extension-peers");
      for (const peer of peers) {
        const peerDot = createEl("span", "yaos-extension-peer-dot");
        peerDot.style.backgroundColor = peer.color;
        peerDot.setAttribute("aria-label", peer.name);
        peerDot.addEventListener("mouseenter", (evt) => {
          this.showTooltip(evt, peer.name, peer.color, peer.hasCursor);
        });
        peerDot.addEventListener("mouseleave", () => {
          this.hideTooltip();
        });
        peersContainer.appendChild(peerDot);
      }
      this.statusBarEl.appendChild(peersContainer);
    }

    this.renderBadge(unreadCount);
  }

  private renderDisconnected(): void {
    const dot = createEl("span", "yaos-extension-dot disconnected");
    dot.setAttribute("aria-label", "Sync disconnected");
    this.statusBarEl.appendChild(dot);
    this.statusBarEl.appendChild(createEl("span", undefined, "Not synced"));
  }

  private renderBadge(unreadCount?: number): void {
    if (unreadCount && unreadCount > 0) {
      const badge = createEl("span", "yaos-extension-notification-badge", String(unreadCount));
      badge.setAttribute("aria-label", `${unreadCount} unread notifications`);
      if (this.onBadgeClick) {
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onBadgeClick!();
        });
      }
      this.statusBarEl.appendChild(badge);
    }
  }

  private showTooltip(evt: MouseEvent, name: string, color: string, hasCursor: boolean): void {
    this.hideTooltip();
    this.tooltipEl = createEl("div", "yaos-extension-tooltip");
    const dot = createEl("span", "yaos-extension-peer-dot");
    dot.style.backgroundColor = color;
    this.tooltipEl.appendChild(dot);
    this.tooltipEl.appendChild(createEl("span", undefined, ` ${name}`));
    if (hasCursor) {
      const editSpan = createEl("span", undefined, " \u270E");
      editSpan.style.opacity = "0.6";
      this.tooltipEl.appendChild(editSpan);
    }
    this.tooltipEl.style.left = `${evt.clientX + 10}px`;
    this.tooltipEl.style.top = `${evt.clientY - 30}px`;
    document.body.appendChild(this.tooltipEl);
  }

  private hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
  }

  destroy(): void {
    this.hideTooltip();
    this.statusBarEl.textContent = "";
  }
}

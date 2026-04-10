import type { RemotePeer } from "../yaosApi";

export class MentionSuggest {
  private textarea: HTMLTextAreaElement;
  private getPeers: () => RemotePeer[];
  private dropdown: HTMLElement | null = null;
  private activeIndex = 0;
  private filteredPeers: RemotePeer[] = [];

  constructor(textarea: HTMLTextAreaElement, getPeers: () => RemotePeer[]) {
    this.textarea = textarea;
    this.getPeers = getPeers;
    this.textarea.addEventListener("input", this.onInput);
    this.textarea.addEventListener("keydown", this.onKeydown);
  }

  private findMentionQuery(): { start: number; query: string } | null {
    const text = this.textarea.value;
    const cursor = this.textarea.selectionStart;

    const atPos = text.lastIndexOf("@", cursor - 1);
    if (atPos === -1) return null;

    if (atPos > 0 && !/\s/.test(text[atPos - 1]!)) return null;

    const query = text.slice(atPos + 1, cursor);
    if (query.includes(" ")) return null;

    return { start: atPos, query };
  }

  private onInput = () => {
    const query = this.findMentionQuery();
    if (query === null) {
      this.closeDropdown();
      return;
    }

    const peers = this.getPeers();
    this.filteredPeers = peers.filter((p) =>
      p.name.toLowerCase().startsWith(query.query.toLowerCase()),
    );

    if (this.filteredPeers.length === 0) {
      this.closeDropdown();
      return;
    }

    this.activeIndex = 0;
    this.showDropdown();
  };

  private showDropdown() {
    this.closeDropdown();
    this.dropdown = document.createElement("div");
    this.dropdown.className = "yaos-extension-mention-dropdown";

    this.filteredPeers.forEach((peer, i) => {
      const item = document.createElement("div");
      item.className =
        "yaos-extension-mention-item" +
        (i === this.activeIndex ? " active" : "");

      const dot = document.createElement("span");
      dot.className = "yaos-extension-mention-color-dot";
      dot.style.backgroundColor = peer.color;
      item.appendChild(dot);

      const nameSpan = document.createElement("span");
      nameSpan.textContent = peer.name;
      item.appendChild(nameSpan);

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.selectPeer(peer);
      });

      this.dropdown!.appendChild(item);
    });

    const rect = this.textarea.getBoundingClientRect();
    this.dropdown.style.position = "fixed";
    this.dropdown.style.left = `${rect.left}px`;
    this.dropdown.style.top = `${rect.bottom}px`;

    document.body.appendChild(this.dropdown);
  }

  private closeDropdown() {
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
    }
  }

  private selectPeer(peer: RemotePeer) {
    const query = this.findMentionQuery();
    if (!query) return;

    const before = this.textarea.value.slice(0, query.start);
    const after = this.textarea.value.slice(this.textarea.selectionStart);
    this.textarea.value = before + `@${peer.name} ` + after;

    const newPos = query.start + peer.name.length + 2;
    this.textarea.selectionStart = newPos;
    this.textarea.selectionEnd = newPos;

    this.closeDropdown();
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (!this.dropdown) return;

    if (e.key === "Escape") {
      e.preventDefault();
      this.closeDropdown();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.activeIndex =
        (this.activeIndex + 1) % this.filteredPeers.length;
      this.updateHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex =
        (this.activeIndex - 1 + this.filteredPeers.length) %
        this.filteredPeers.length;
      this.updateHighlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const peer = this.filteredPeers[this.activeIndex];
      if (peer) this.selectPeer(peer);
    }
  };

  private updateHighlight() {
    if (!this.dropdown) return;
    const items = this.dropdown.querySelectorAll(".yaos-extension-mention-item");
    items.forEach((item, i) => {
      item.classList.toggle("active", i === this.activeIndex);
    });
  }

  destroy() {
    this.closeDropdown();
    this.textarea.removeEventListener("input", this.onInput);
    this.textarea.removeEventListener("keydown", this.onKeydown);
  }
}

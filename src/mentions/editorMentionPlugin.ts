import {
  ViewPlugin,
  ViewUpdate,
  keymap,
} from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { KnownDevice } from "../yaosApi";
import { log } from "../logger";

interface MentionQuery {
  from: number;
  text: string;
}

function findMentionQuery(
  doc: string,
  cursor: number,
): MentionQuery | null {
  const atPos = doc.lastIndexOf("@", cursor - 1);
  if (atPos === -1) return null;

  if (atPos > 0 && !/\s/.test(doc[atPos - 1]!)) return null;

  const text = doc.slice(atPos + 1, cursor);
  if (text.includes(" ")) return null;

  return { from: atPos, text };
}

export class EditorMentionPlugin {
  view: EditorView;
  getPeers: () => KnownDevice[];
  onMention: ((peerName: string) => void) | undefined;
  query: MentionQuery | null = null;
  filteredPeers: KnownDevice[] = [];
  activeIndex = 0;
  dropdown: HTMLElement | null = null;

  constructor(view: EditorView, getPeers: () => KnownDevice[], onMention?: (peerName: string) => void) {
    this.view = view;
    this.getPeers = getPeers;
    this.onMention = onMention;
  }

  update(update: ViewUpdate) {
    if (!update.docChanged && !update.selectionSet) return;

    const pos = update.state.selection.main.head;
    const doc = update.state.doc.toString();
    const query = findMentionQuery(doc, pos);

    if (!query) {
      this.closeDropdown();
      this.query = null;
      return;
    }

    this.query = query;

    const peers = this.getPeers();
    log("editorMention: getPeers returned", peers.length, "peers");

    this.filteredPeers = peers.filter((p) =>
      p.name.toLowerCase().startsWith(query.text.toLowerCase()),
    );

    log(
      "editorMention: query=%s filtered to %d peers",
      JSON.stringify(query.text),
      this.filteredPeers.length,
    );

    if (this.filteredPeers.length === 0) {
      this.closeDropdown();
      return;
    }

    this.activeIndex = 0;
    this.openDropdown();
  }

  openDropdown() {
    this.closeDropdown();
    this.dropdown = document.createElement("div");
    this.dropdown.className = "yaos-extension-mention-dropdown";

    this.filteredPeers.forEach((peer, i) => {
      const item = document.createElement("div");
      item.className =
        "yaos-extension-mention-item" +
        (i === this.activeIndex ? " active" : "") +
        (!peer.online ? " yaos-extension-mention-offline" : "");

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

    this.dropdown.style.position = "fixed";
    document.body.appendChild(this.dropdown);

    this.positionDropdown();
  }

  positionDropdown() {
    if (!this.dropdown || !this.query) return;
    this.view.requestMeasure({
      read: () => {
        if (!this.query || !this.dropdown) return null;
        return this.view.coordsAtPos(this.query.from);
      },
      write: (coords) => {
        if (!coords || !this.dropdown) return;
        this.dropdown.style.left = `${coords.left}px`;
        this.dropdown.style.top = `${coords.bottom}px`;
      },
    });
  }

  closeDropdown() {
    if (this.dropdown) {
      this.dropdown.remove();
      this.dropdown = null;
    }
  }

  selectPeer(peer: KnownDevice) {
    if (!this.query) return;

    const from = this.query.from;
    const to = this.view.state.selection.main.head;
    this.view.dispatch({
      changes: { from, to, insert: `@${peer.name} ` },
    });

    log("editorMention: selected peer %s", peer.name);

    this.onMention?.(peer.name);

    this.closeDropdown();
  }

  moveActive(direction: 1 | -1) {
    if (!this.dropdown || this.filteredPeers.length === 0) return false;

    this.activeIndex =
      (this.activeIndex + direction + this.filteredPeers.length) %
      this.filteredPeers.length;
    this.updateHighlight();
    return true;
  }

  confirmSelection(): boolean {
    if (!this.dropdown || this.filteredPeers.length === 0) return false;

    const peer = this.filteredPeers[this.activeIndex];
    if (peer) this.selectPeer(peer);
    return true;
  }

  cancel(): boolean {
    if (!this.dropdown) return false;
    this.closeDropdown();
    return true;
  }

  updateHighlight() {
    if (!this.dropdown) return;
    const items = this.dropdown.querySelectorAll(
      ".yaos-extension-mention-item",
    );
    items.forEach((item, i) => {
      item.classList.toggle("active", i === this.activeIndex);
    });
  }

  destroy() {
    this.closeDropdown();
  }
}

export function editorMentionExtension(
  getPeers: () => KnownDevice[],
  onMention?: (peerName: string) => void,
) {
  const plugin = ViewPlugin.fromClass(
    class extends EditorMentionPlugin {
      constructor(view: EditorView) {
        super(view, getPeers, onMention);
      }
    },
    {
      eventHandlers: {
        mousedown(event: MouseEvent) {
          const target = event.target as HTMLElement;
          if (
            target.closest(".yaos-extension-mention-dropdown") &&
            this.dropdown
          ) {
            return true;
          }
          return false;
        },
      },
    },
  );

  return [
    plugin,
    keymap.of([
      {
        key: "ArrowDown",
        run: (view) => {
          const mention = view.plugin(plugin)!;
          return mention.moveActive(1);
        },
      },
      {
        key: "ArrowUp",
        run: (view) => {
          const mention = view.plugin(plugin)!;
          return mention.moveActive(-1);
        },
      },
      {
        key: "Enter",
        run: (view) => {
          const mention = view.plugin(plugin)!;
          return mention.confirmSelection();
        },
      },
      {
        key: "Escape",
        run: (view) => {
          const mention = view.plugin(plugin)!;
          return mention.cancel();
        },
      },
    ]),
  ];
}

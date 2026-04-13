export class Component {
  load(): void {}
  unload(): void {}
}

export function setIcon(el: HTMLElement, iconName: string): void {
  el.dataset.icon = iconName;
}

export class MarkdownRenderer {
  static render(_app: any, markdown: string, el: HTMLElement, _sourcePath: string, _component: Component): Promise<void> {
    el.textContent = markdown;
    return Promise.resolve();
  }
}

export class ItemView {
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  constructor(leaf: any) {
    this.containerEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.containerEl.appendChild(this.contentEl);
  }
  getViewType(): string { return ""; }
  getDisplayText(): string { return ""; }
  getIcon(): string { return ""; }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
}

declare global {
  interface HTMLElement {
    empty(): HTMLElement;
    addClass(cls: string): HTMLElement;
    createDiv(opts?: { cls?: string; text?: string }): HTMLDivElement;
    createSpan(opts?: { cls?: string; text?: string }): HTMLSpanElement;
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, opts?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLElementTagNameMap[K];
  }
}

HTMLElement.prototype.empty = function(this: HTMLElement) {
  this.innerHTML = "";
  return this;
};

HTMLElement.prototype.addClass = function(this: HTMLElement, cls: string) {
  this.classList.add(cls);
  return this;
};

HTMLElement.prototype.createDiv = function(this: HTMLElement, opts?: { cls?: string; text?: string }) {
  const div = document.createElement("div");
  if (opts?.cls) div.className = opts.cls;
  if (opts?.text) div.textContent = opts.text;
  this.appendChild(div);
  return div;
};

HTMLElement.prototype.createSpan = function(this: HTMLElement, opts?: { cls?: string; text?: string }) {
  const span = document.createElement("span");
  if (opts?.cls) span.className = opts.cls;
  if (opts?.text) span.textContent = opts.text;
  this.appendChild(span);
  return span;
};

HTMLElement.prototype.createEl = function(this: HTMLElement, tag: any, opts?: { cls?: string; text?: string; attr?: Record<string, string> }) {
  const el = document.createElement(tag);
  if (opts?.cls) el.className = opts.cls;
  if (opts?.text) el.textContent = opts.text;
  if (opts?.attr) {
    for (const [k, v] of Object.entries(opts.attr)) {
      el.setAttribute(k, v);
    }
  }
  this.appendChild(el);
  return el;
};

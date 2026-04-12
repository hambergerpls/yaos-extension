import { App, Component, TFile } from "obsidian";

export interface MockOwner {
  app: App;
  file: TFile | null;
  getFile(): TFile | null;
  getMode(): string;
  path: string;
  onInternalDataChange(): void;
  onMarkdownFold(): void;
  save(): void;
  [key: string]: any;
}

export function createMockOwner(app: App, file?: TFile | null): MockOwner {
  const target: MockOwner = {
    app,
    file: file ?? null,
    getFile() {
      return this.file;
    },
    getMode() {
      return "source";
    },
    path: file?.path ?? "",
    editor: null,
    editMode: null,
    onInternalDataChange() {},
    onMarkdownFold() {},
    save() {},
  };

  return new Proxy(target, {
    get(obj, prop: string | symbol) {
      if (prop in obj) {
        return (obj as any)[prop];
      }
      if (typeof prop === "string") {
        console.debug(`[yaos-extension] MockOwner: accessing unknown property "${prop}"`);
      }
      return undefined;
    },
  }) as MockOwner;
}
import { App } from "obsidian";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { getEditorComponentClass } from "./editorDiscovery";
import { createMockOwner } from "./commentEditorOwner";

const embeddedEditorTheme = EditorView.theme({
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--caret-color)",
  },
  ".cm-content": {
    caretColor: "var(--caret-color)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
});

export interface EmbeddedEditorOptions {
  placeholder?: string;
  onSubmit?: (text: string) => void;
  extraExtensions?: Extension[];
  app?: App;
  useObsidianEditor?: boolean;
}

export interface EmbeddedEditorHandle {
  view: EditorView;
  getText(): string;
  setText(text: string): void;
  clear(): void;
  focus(): void;
  destroy(): void;
}

function createObsidianEditor(
  app: App,
  parent: HTMLElement,
  options: EmbeddedEditorOptions,
): EmbeddedEditorHandle | null {
  const AZClass = getEditorComponentClass(app);
  if (!AZClass) return null;

  const mockOwner = createMockOwner(app);

  const container = parent.createDiv({ cls: "yaos-extension-obsidian-editor-container" });

  let editorComponent: any;
  try {
    editorComponent = new AZClass(app, container, mockOwner);
    editorComponent.sourceMode = true;
  } catch (e) {
    console.warn("[yaos-extension] Failed to create Obsidian editor:", e);
    container.remove();
    return null;
  }

  try {
    editorComponent.load();
  } catch (e) {
    console.warn("[yaos-extension] Failed to load Obsidian editor component:", e);
    try {
      editorComponent.unload();
    } catch {}
    container.remove();
    return null;
  }

  try {
    editorComponent.set("", true);
  } catch (e) {
    console.warn("[yaos-extension] Failed to initialize Obsidian editor content:", e);
    try {
      editorComponent.unload();
    } catch {}
    container.remove();
    return null;
  }

  const cm: EditorView = editorComponent.cm;
  if (!cm) {
    console.warn("[yaos-extension] Obsidian editor component has no cm property");
    try {
      editorComponent.unload();
    } catch {}
    container.remove();
    return null;
  }

  const cleanupFns: (() => void)[] = [];

  if (options.onSubmit) {
    const onSubmit = options.onSubmit;
    const enterListener = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const text = cm.state.doc.toString().trim();
        if (text) {
          e.preventDefault();
          e.stopPropagation();
          onSubmit(text);
        }
      }
    };
    cm.contentDOM.addEventListener("keydown", enterListener, true);
    cleanupFns.push(() => cm.contentDOM.removeEventListener("keydown", enterListener, true));
  }

  // Note: extraExtensions (e.g. @mention) are NOT injected here for the Obsidian
  // editor path. The Obsidian editor's getDynamicExtensions() already includes
  // app.workspace.editorExtensions, which contains the editorMentionExtension
  // registered in main.ts via registerEditorExtension(). The bare CM6 fallback
  // path handles extraExtensions in its initial EditorState.create() call.

  return {
    view: cm,
    getText(): string {
      return cm.state.doc.toString();
    },
    setText(text: string): void {
      try {
        editorComponent.set(text, true);
      } catch {
        cm.dispatch({
          changes: { from: 0, to: cm.state.doc.length, insert: text },
          selection: { anchor: text.length },
        });
      }
    },
    clear(): void {
      try {
        editorComponent.set("", true);
      } catch {
        cm.dispatch({
          changes: { from: 0, to: cm.state.doc.length, insert: "" },
        });
      }
    },
    focus(): void {
      try {
        editorComponent.focus();
      } catch {
        cm.focus();
      }
    },
    destroy(): void {
      for (const fn of cleanupFns) {
        try { fn(); } catch {}
      }
      try {
        editorComponent.unload();
      } catch {}
      container.remove();
    },
  };
}

function createBareCm6Editor(
  parent: HTMLElement,
  options: EmbeddedEditorOptions,
): EmbeddedEditorHandle {
  const { placeholder, onSubmit, extraExtensions = [] } = options;

  const enterKeymap = keymap.of([
    {
      key: "Enter",
      run: (view: EditorView): boolean => {
        if (onSubmit) {
          const text = view.state.doc.toString().trim();
          if (text) {
            onSubmit(text);
            return true;
          }
        }
        return false;
      },
    },
  ]);

  const state = EditorState.create({
    doc: "",
    extensions: [
      embeddedEditorTheme,
      EditorView.lineWrapping,
      ...extraExtensions,
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      enterKeymap,
    ],
  });

  const view = new EditorView({
    state,
    parent,
  });

  return {
    view,
    getText(): string {
      return view.state.doc.toString();
    },
    setText(text: string): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      });
    },
    clear(): void {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "" },
      });
    },
    focus(): void {
      view.focus();
    },
    destroy(): void {
      view.destroy();
    },
  };
}

export function createEmbeddedEditor(
  parent: HTMLElement,
  options: EmbeddedEditorOptions = {},
): EmbeddedEditorHandle {
  const { app, useObsidianEditor = true } = options;

  if (useObsidianEditor && app) {
    const obsidianEditor = createObsidianEditor(app, parent, options);
    if (obsidianEditor) {
      return obsidianEditor;
    }
  }

  return createBareCm6Editor(parent, options);
}
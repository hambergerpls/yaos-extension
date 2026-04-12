import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";

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
}

export interface EmbeddedEditorHandle {
  view: EditorView;
  getText(): string;
  setText(text: string): void;
  clear(): void;
  focus(): void;
  destroy(): void;
}

export function createEmbeddedEditor(
  parent: HTMLElement,
  options: EmbeddedEditorOptions = {},
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

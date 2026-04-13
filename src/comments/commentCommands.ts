import { Plugin, Editor } from "obsidian";
import type { CommentStore } from "./commentStore";

export interface DeviceInfo {
  name: string;
  color: string;
}

export interface SelectionInfo {
  rangeText: string;
  rangeOffset: number;
  rangeContext: string;
  rangeLength: number;
}

export function registerCommentCommands(
  plugin: Plugin,
  commentStore: CommentStore,
  getDeviceInfo: () => DeviceInfo,
  onCommentAdded?: () => void,
  onPendingSelection?: (selection: SelectionInfo) => void,
): void {
  plugin.addCommand({
    id: "add-comment",
    name: "Add comment",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "m" }],
    editorCallback: (editor: Editor) => {
      if (!editor.somethingSelected()) return;
      handleAddComment(editor, onCommentAdded, onPendingSelection);
    },
  });

  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor) => {
      if (!editor.somethingSelected()) return;
      menu.addItem((item) => {
        item
          .setTitle("Add comment")
          .setIcon("message-square")
          .setSection("yaos-extension")
          .onClick(() => {
            handleAddComment(editor, onCommentAdded, onPendingSelection);
          });
      });
    }),
  );
}

function handleAddComment(
  editor: Editor,
  onCommentAdded?: () => void,
  onPendingSelection?: (selection: SelectionInfo) => void,
): void {
  const info = getSelectionInfo(editor);
  if (!info) return;

  onPendingSelection?.(info);
  onCommentAdded?.();
}

export function getSelectionInfo(editor: Editor): SelectionInfo | null {
  if (!editor.somethingSelected()) return null;

  const selection = editor.getSelection();
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const offset = editor.posToOffset(from);
  const endOffset = editor.posToOffset(to);
  const fullContent = editor.getValue();
  const contextRadius = 50;
  const contextStart = Math.max(0, offset - contextRadius);
  const contextEnd = Math.min(fullContent.length, endOffset + contextRadius);

  return {
    rangeText: selection,
    rangeOffset: offset,
    rangeContext: fullContent.slice(contextStart, contextEnd),
    rangeLength: endOffset - offset,
  };
}

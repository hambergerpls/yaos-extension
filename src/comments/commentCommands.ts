import { Plugin, Editor } from "obsidian";
import { COMMENTS_VIEW_TYPE, CommentView } from "./commentView";
import type { CommentStore } from "./commentStore";

export interface DeviceInfo {
  name: string;
  color: string;
}

export function registerCommentCommands(
  plugin: Plugin,
  commentStore: CommentStore,
  getDeviceInfo: () => DeviceInfo,
  onCommentAdded?: () => void,
): void {
  plugin.addCommand({
    id: "add-comment",
    name: "Add comment",
    hotkeys: [{ modifiers: ["Mod", "Shift"], key: "m" }],
    editorCallback: (editor: Editor) => {
      if (!editor.somethingSelected()) return;
      handleAddComment(plugin, editor, getDeviceInfo, commentStore, onCommentAdded);
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
            handleAddComment(plugin, editor, getDeviceInfo, commentStore, onCommentAdded);
          });
      });
    }),
  );
}

function handleAddComment(
  plugin: Plugin,
  editor: Editor,
  getDeviceInfo: () => DeviceInfo,
  commentStore: CommentStore,
  onCommentAdded?: () => void,
): void {
  const info = getSelectionInfo(editor);
  if (!info) return;

  const existingLeaves = plugin.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
  if (existingLeaves.length === 0) {
    const rightLeaf = plugin.app.workspace.getRightLeaf(false);
    if (rightLeaf) {
      rightLeaf.setViewState({ type: COMMENTS_VIEW_TYPE, active: true });
    }
  } else {
    plugin.app.workspace.revealLeaf(existingLeaves[0]!);
  }

  setTimeout(() => {
    const leaves = plugin.app.workspace.getLeavesOfType(COMMENTS_VIEW_TYPE);
    if (leaves.length > 0) {
      const view = leaves[0]!.view as CommentView;
      view.setPendingSelection(info);
    }
  }, 100);

  onCommentAdded?.();
}

export function getSelectionInfo(editor: Editor): {
  rangeText: string;
  rangeOffset: number;
  rangeContext: string;
  rangeLength: number;
} | null {
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

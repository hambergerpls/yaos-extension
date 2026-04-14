# Plan: Allow users to edit their own comments and replies

## Design decisions

- Only the author can edit their own comments/replies (same ownership model as delete)
- Editing is inline: the comment body is replaced with an editor pre-filled with the current text
- An "(edited)" indicator is shown next to the timestamp on edited content
- New `@mentions` added during an edit generate notifications when saved
- Follows the existing append-only JSONL pattern with a new `EditEntry` type (same approach as `ResolveEntry` and `Deletion`)

## File changes

### 1. `src/comments/types.ts` - Add EditEntry type

- Add a new `EditEntry` interface:
  ```ts
  export interface EditEntry {
    type: "edit";
    targetId: string;   // comment or reply ID
    newText: string;
    editedBy: string;
    editedAt: number;
    mentions: string[];
  }
  ```
- Add optional `editedAt?: number` to both `Comment` and `Reply` interfaces (populated during thread assembly when edits exist)
- Add `EditEntry` to the `CommentEntry` union type

### 2. `src/comments/commentStore.ts` - Persistence layer

- Add `editEntry(filePath, targetId, newText, deviceName)` method that appends an `EditEntry` line to the JSONL file
- Update `getThreadsForFile()` to process edit entries:
  - Build an `editMap: Map<string, { newText, editedAt, mentions }>` (latest by timestamp wins, same pattern as `resolveMap`)
  - After assembling threads, apply edits to comments and replies by overwriting `.text`, `.mentions`, and setting `.editedAt`

### 3. `src/comments/commentView.ts` - Edit UI

- Add `onEditComment?: (commentId: string, newText: string) => void` and `onEditReply?: (replyId: string, newText: string) => void` callbacks
- **Comment cards** (`renderThreadCard`):
  - Add "Edit" button next to "Delete" (only when `comment.author === localDeviceName`)
  - Show "(edited)" indicator next to timestamp when `comment.editedAt` exists
  - On "Edit" click: enter edit mode -- replace body with embedded editor pre-filled with current text, show Save/Cancel buttons, hide other actions
  - On Save: call `onEditComment(commentId, newText)`, exit edit mode
  - On Cancel: restore original display
- **Replies** (`renderReplies`):
  - Add "Edit" button next to "Delete" for own replies
  - Show "(edited)" indicator when `reply.editedAt` exists
  - Same inline edit flow, calling `onEditReply(replyId, newText)` on save

### 4. `src/main.ts` - Handler wiring

- Add `handleEditComment(commentId: string, newText: string)` method:
  - Verify ownership (author matches local device name)
  - Call `commentStore.editEntry(filePath, commentId, newText, deviceName)`
  - Extract new mentions, diff against original mentions
  - Generate notifications for newly added mentions only
  - Refresh comment view
- Add `handleEditReply(replyId: string, newText: string)` method:
  - Same pattern as above, adapted for replies (need to find the reply in threads to check ownership)
  - Generate notifications for newly added mentions
- Wire both callbacks into the `CommentView` constructor alongside existing callbacks

### 5. `src/styles.css` - Edit button and edit mode styles

- `.yaos-extension-edit-btn` -- styled like the delete button (but neutral hover instead of red)
- `.yaos-extension-comment-edit-mode` -- container for the inline editor + save/cancel buttons during editing
- `.yaos-extension-edited-indicator` -- small muted text "(edited)" next to timestamps
- `.yaos-extension-edit-save-btn` / `.yaos-extension-edit-cancel-btn` -- action buttons in edit mode

### 6. Tests

- **`commentStore.test.ts`**: Add a new `describe("edit entries")` block:
  - Applies an edit to a comment's text
  - Applies an edit to a reply's text
  - Latest edit by timestamp wins when multiple edits exist
  - Edited comment still shows correct `editedAt` value
  - Edit + delete interaction (deleted entry ignores edits)
  - `editEntry` method appends correct JSON line
- **`commentView.test.ts`**: Add a new `describe("edit comment/reply button")` block:
  - Renders edit button for own comments, not for others'
  - Renders edit button for own replies, not for others'
  - Calls `onEditComment` / `onEditReply` with correct arguments

## Files not changed

- `commentCommands.ts` -- no new commands needed (edit is triggered from the sidebar UI, not a keyboard shortcut)
- `commentDecorations.ts` -- highlights are based on range data which doesn't change during text edits
- `notificationHelpers.ts` -- existing `createMentionNotifications` function can be reused for edit notifications
- `embeddedEditor.ts` -- reuses existing `createEmbeddedEditor` for the edit input

## Implementation order

1. Types (`types.ts`)
2. Store (`commentStore.ts` + tests)
3. View (`commentView.ts` + tests)
4. Main wiring (`main.ts`)
5. Styles (`styles.css`)

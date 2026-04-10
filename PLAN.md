# Implementation Plan: Comments, Mentions, Threads & Notifications

## Design Decisions

| Decision | Choice |
|----------|--------|
| Comment storage | Hidden vault folder `.yaos-extension/comments/` as per-file JSONL |
| Comment UI | Sidebar `ItemView` + CodeMirror 6 inline highlights |
| Notification persistence | Synced via vault JSONL, read status local per-device |
| Comment triggers | Context menu + command palette + keyboard shortcut |
| YAOS sync scope | Syncs everything including dotfiles |

## Data Model

### Storage layout

```
.yaos-extension/
  comments/
    notes--my-note.md.jsonl        # comments for notes/my-note.md
    projects--readme.md.jsonl      # comments for projects/readme.md
  notifications.jsonl              # all notifications for all devices
```

Path encoding: vault-relative file path with `/` replaced by `--`.

JSONL format (one JSON object per line) chosen because Yjs merges text at the
character level. Two devices adding comments simultaneously produce two new
lines, which CRDT text merge handles cleanly. Deletes are soft-deletes (a
`"delete"` entry) rather than line removal, avoiding CRDT conflicts from
removing content.

### Types (`src/comments/types.ts`)

```typescript
interface Comment {
  type: "comment";
  id: string;                // crypto.randomUUID()
  text: string;              // comment body, may contain @mentions
  author: string;            // device name
  authorColor: string;       // awareness color
  createdAt: number;         // epoch ms
  rangeText: string;         // exact selected text
  rangeContext: string;      // ~50 chars before + after for fuzzy matching
  rangeOffset: number;       // character offset hint
  rangeLength: number;       // selection length
  resolved: boolean;
  mentions: string[];        // device names mentioned
}

interface Reply {
  type: "reply";
  id: string;
  commentId: string;         // parent comment ID
  text: string;
  author: string;
  authorColor: string;
  createdAt: number;
  mentions: string[];
}

interface ResolveEntry {
  type: "resolve";
  commentId: string;
  resolved: boolean;
  by: string;
  at: number;
}

interface Deletion {
  type: "delete";
  targetId: string;          // comment or reply ID
  deletedBy: string;
  deletedAt: number;
}

interface Notification {
  type: "notification";
  id: string;
  kind: "mention" | "reply" | "new_comment";
  commentId: string;
  replyId?: string;
  fileId: string;            // vault-relative path
  fromDevice: string;
  targetDevice: string;
  createdAt: number;
  preview: string;           // snippet of comment text
}
```

## Module Structure

New files follow the existing architecture: `yaosApi.ts` remains the only YAOS
accessor, siblings never import each other, `main.ts` wires everything.

```
src/
  main.ts                         # extend: register views, commands, CM extension
  settings.ts                     # extend: 2 new booleans
  yaosApi.ts                      # no changes
  presenceTracker.ts              # no changes
  statusBar.ts                    # extend: notification badge count

  comments/
    types.ts                      # Comment, Reply, Deletion, Notification interfaces
    commentStore.ts               # CRUD operations on JSONL files
    commentDecorations.ts         # CM6 ViewPlugin for inline highlights
    commentView.ts                # Obsidian ItemView (sidebar panel)
    commentCommands.ts            # Command registration + context menu
    mentionSuggest.ts             # @mention autocomplete in comment input

  notifications/
    notificationStore.ts          # Read/write notifications.jsonl + local read state
    notificationView.ts           # Obsidian ItemView (notification panel)

  styles.css                      # extend: comment + notification styles
```

Import rules (extending existing constraints):

| Module | Imports from |
|--------|-------------|
| `comments/types` | nothing |
| `comments/commentStore` | `comments/types`, Obsidian `Vault` |
| `comments/commentDecorations` | `comments/types`, CodeMirror |
| `comments/commentView` | `comments/types`, Obsidian view APIs |
| `comments/commentCommands` | nothing (receives dependencies via function args) |
| `comments/mentionSuggest` | `yaosApi` types only |
| `notifications/notificationStore` | `comments/types`, Obsidian `Plugin` |
| `notifications/notificationView` | `comments/types`, Obsidian view APIs |
| `main.ts` | all of the above (wiring) |

---

## Phase 1: Comment Data Layer

Goal: Read/write comments to JSONL vault files.

### 1.1 Create `src/comments/types.ts`

- [ ] Define `Comment`, `Reply`, `ResolveEntry`, `Deletion` interfaces
- [ ] Define `CommentEntry` union type: `Comment | Reply | ResolveEntry | Deletion`
- [ ] Define `CommentThread` type: `{ comment: Comment; replies: Reply[] }`
- [ ] Define `Notification` interface
- [ ] Export all types

### 1.2 Create `src/comments/commentStore.ts`

- [ ] `CommentStore` class, constructed with Obsidian `Vault` reference
- [ ] `filePathToJsonlPath(filePath: string): string` -- encode vault path
      to `.yaos-extension/comments/` path (replace `/` with `--`)
- [ ] `ensureFolder(): Promise<void>` -- create `.yaos-extension/comments/`
      if it does not exist
- [ ] `getThreadsForFile(filePath: string): Promise<CommentThread[]>` --
      read JSONL, parse each line tolerantly (skip malformed lines), apply
      soft-deletes, apply resolve entries, group replies under parent
      comments, sort by `rangeOffset`
- [ ] `addComment(filePath: string, comment: Comment): Promise<void>` --
      append JSON line to the file's JSONL
- [ ] `addReply(filePath: string, reply: Reply): Promise<void>` -- append
      JSON line
- [ ] `deleteEntry(filePath: string, targetId: string, deviceName: string): Promise<void>`
      -- append a `Deletion` line
- [ ] `resolveComment(filePath: string, commentId: string, resolved: boolean, deviceName: string): Promise<void>`
      -- append a `ResolveEntry` line
- [ ] `extractMentions(text: string): string[]` -- parse `@DeviceName`
      patterns from comment/reply text

Internal notes:
- JSONL parsing must be tolerant: CRDT merges can corrupt line boundaries.
  Skip lines that fail `JSON.parse()`.
- Soft-delete: when a `Deletion` entry is found, filter out any `Comment`
  or `Reply` with matching `targetId`. If a `Comment` is deleted, also
  discard its orphaned replies.
- `ResolveEntry` overrides the `resolved` field on the parent comment.
  Last-writer-wins by `at` timestamp.

### 1.3 Create `src/comments/commentStore.test.ts`

- [ ] Test JSONL round-trip (write comment, read back thread)
- [ ] Test adding reply links to parent comment
- [ ] Test soft-delete filters out target and orphan replies
- [ ] Test resolve entry updates comment's resolved state
- [ ] Test malformed line tolerance (corrupt line skipped, valid lines parsed)
- [ ] Test path encoding (`notes/sub/file.md` -> `.yaos-extension/comments/notes--sub--file.md.jsonl`)
- [ ] Test `extractMentions` parses `@Name` patterns correctly

---

## Phase 2: Comment UI -- Add & View Comments (TODO item 4)

Goal: Users can select text, add a comment, see highlighted ranges, and view
comments in a sidebar.

### 2.1 Extend `src/settings.ts`

- [ ] Add `showComments: boolean` to `YaosExtensionSettings` (default `true`)
- [ ] Add `showNotifications: boolean` (default `true`)
- [ ] Update `DEFAULT_SETTINGS`

### 2.2 Create `src/comments/commentView.ts` -- Sidebar panel

- [ ] Extend Obsidian `ItemView`
- [ ] View type: `"yaos-extension-comments"`, display text: `"Comments"`,
      icon: `"message-square"`
- [ ] Listen to `workspace.on('active-leaf-change')` to track the active file
- [ ] `refresh(filePath: string): Promise<void>` -- called by `main.ts`
      when comments change; re-reads threads from `CommentStore` and re-renders
- [ ] Render states:
  - Empty: "No comments on this file"
  - Has comments: list of thread cards
- [ ] Each thread card shows:
  - Quoted `rangeText` in a styled blockquote
  - Author name + color dot + relative timestamp
  - Comment body text (with `@mentions` bolded)
  - Reply count badge (e.g. "3 replies")
  - Resolve / Reopen button
- [ ] Clicking a thread card expands it:
  - Shows all replies chronologically
  - Each reply: author + color dot + timestamp + body
  - Reply input: textarea + "Reply" button
- [ ] Comment input at top of sidebar: textarea + "Comment" button,
      pre-filled with quoted text when triggered from editor
- [ ] Resolved threads: collapsed by default, grayed out, grouped at bottom

### 2.3 Create `src/comments/commentDecorations.ts` -- Editor highlights

- [ ] CM6 `ViewPlugin` implementation
- [ ] Receives comment data via a `Facet<CommentThread[]>`
- [ ] `findRangeInDocument(doc, rangeText, rangeContext, rangeOffset): {from, to} | null`
  - Search for `rangeText` near `rangeOffset` in the document
  - Use `rangeContext` to disambiguate when the same text appears multiple times
  - Return null if not found (comment shows in sidebar but no highlight)
- [ ] Create `Decoration.mark({ class: "yaos-extension-comment-highlight" })`
      for each located range
- [ ] Differentiate resolved comments: `"yaos-extension-comment-highlight-resolved"`
- [ ] Click handler: `mousedown` on highlighted range -> open sidebar, scroll
      to the relevant thread
- [ ] Update decorations when facet value changes or document changes

### 2.4 Create `src/comments/commentCommands.ts`

- [ ] Export `registerCommentCommands(plugin, commentStore, getDeviceInfo)`
- [ ] Register command:
  ```
  id: "add-comment"
  name: "Add comment"
  hotkeys: [{ modifiers: ["Mod", "Shift"], key: "m" }]
  editorCallback: (editor, view) => { ... }
  ```
- [ ] Register editor context menu:
  ```
  workspace.on('editor-menu', (menu, editor, info) => {
    if (editor.somethingSelected()) {
      menu.addItem(item => item.setTitle("Add comment").setIcon("message-square")...)
    }
  })
  ```
- [ ] Callback logic:
  1. Get selection text, range offset, surrounding context (~50 chars each side)
  2. Open comment sidebar if not already open
  3. Focus the comment input with the quoted text pre-filled

### 2.5 Extend `src/main.ts`

- [ ] Import and create `CommentStore` in `onload()`
- [ ] Register `"yaos-extension-comments"` view via `registerView()`
- [ ] Register CM6 comment decorations extension via `registerEditorExtension()`
- [ ] Call `registerCommentCommands(this, commentStore, getDeviceInfo)`
- [ ] Register vault event: `this.registerEvent(this.app.vault.on('modify', file => { ... }))`
  - Filter for `.yaos-extension/comments/` paths
  - Refresh sidebar + update CM6 facet
- [ ] `onunload()`: detach comment views, clean up

### 2.6 Extend `src/styles.css`

- [ ] `.yaos-extension-comment-highlight` -- semi-transparent amber/yellow
      background for commented text ranges
- [ ] `.yaos-extension-comment-highlight-resolved` -- same but reduced opacity
- [ ] `.yaos-extension-comment-highlight:hover` -- slightly stronger background
- [ ] `.yaos-extension-comment-view` -- sidebar container
- [ ] `.yaos-extension-comment-thread` -- thread card with border, padding
- [ ] `.yaos-extension-comment-thread.resolved` -- grayed out
- [ ] `.yaos-extension-comment-quote` -- blockquote style for rangeText
- [ ] `.yaos-extension-comment-author` -- author name + dot inline
- [ ] `.yaos-extension-comment-body` -- comment text
- [ ] `.yaos-extension-comment-input` -- textarea + button layout
- [ ] `.yaos-extension-comment-replies` -- reply list container
- [ ] Use Obsidian CSS variables throughout

---

## Phase 3: Comment Threads (TODO item 5)

Goal: Reply to comments, resolve/reopen threads.

### 3.1 Extend `commentStore.ts`

- [ ] Verify `addReply()` and `resolveComment()` from Phase 1 work correctly
      with the sidebar
- [ ] Handle resolve state: when building threads from JSONL, apply all
      `ResolveEntry` records (last-by-timestamp wins)

### 3.2 Extend `commentView.ts` -- Thread interaction

- [ ] Expand/collapse thread on click (animated)
- [ ] Show all replies chronologically within expanded thread
- [ ] Reply input at bottom of expanded thread
- [ ] @mention autocomplete in reply textarea (wired in Phase 4)
- [ ] "Resolve" / "Reopen" toggle button on thread header
- [ ] Resolved threads: collapsed by default, grouped at bottom under
      a "Resolved" divider, shown with reduced opacity
- [ ] Delete own comments/replies (author matches local device name)

### 3.3 Extend `commentDecorations.ts`

- [ ] Resolved comment highlights use `.yaos-extension-comment-highlight-resolved`
      class (reduced opacity, dashed underline or similar visual distinction)

---

## Phase 4: Mentions (TODO item 3)

Goal: @mention connected devices in comments and notify them.

### 4.1 Create `src/comments/mentionSuggest.ts`

- [ ] `MentionSuggest` class that attaches to a textarea element
- [ ] Constructor receives a `getPeers(): RemotePeer[]` callback
- [ ] On `@` keystroke in textarea:
  - Query connected peers from the callback
  - Filter by text typed after `@`
  - Show dropdown below cursor position with device names + color dots
  - Keyboard navigation (arrow keys + enter)
  - On select: insert `@DeviceName` into textarea, close dropdown
- [ ] Export mention parsing: `extractMentions(text: string): string[]`
  - Regex: `/@([\w][\w\s]*?)(?=\s|$|@|[.,!?;:])/g`
  - Return array of matched device names

### 4.2 Extend `commentView.ts` -- Wire mention suggest

- [ ] Attach `MentionSuggest` to comment and reply textareas
- [ ] Pass `getPeers` callback from `main.ts` (reads from awareness via
      `presenceTracker.currentAwareness` + `getRemotePeers()`)
- [ ] Render `@mentions` in comment/reply body text as bold + colored

### 4.3 Extend `main.ts` -- Notification generation

- [ ] When `commentStore.addComment()` or `addReply()` is called with
      mentions:
  - For each mentioned device name, create a `Notification` with
    `kind: "mention"`
  - Write to `notificationStore`
- [ ] When `addReply()` is called on a comment authored by a different device:
  - Create a `Notification` with `kind: "reply"` targeting the comment author
  - Write to `notificationStore`

### 4.4 Create `src/comments/mentionSuggest.test.ts`

- [ ] Test `extractMentions` parses single mention
- [ ] Test `extractMentions` parses multiple mentions
- [ ] Test `extractMentions` handles edge cases (no mentions, `@` at end,
      punctuation after name)

---

## Phase 5: Notifications (TODO item 6)

Goal: View past notifications, mark as read, navigate to source.

### 5.1 Create `src/notifications/notificationStore.ts`

- [ ] `NotificationStore` class, constructed with `Vault` + local data
      load/save callbacks
- [ ] `addNotification(notification: Notification): Promise<void>` -- append
      to `.yaos-extension/notifications.jsonl`
- [ ] `getAllNotifications(): Promise<Notification[]>` -- read and parse JSONL
- [ ] `getNotificationsForDevice(deviceName: string): Promise<Notification[]>`
      -- filter by `targetDevice`
- [ ] `getUnreadCount(deviceName: string): Promise<number>` -- count
      notifications not in local read set
- [ ] `markAsRead(notificationId: string): Promise<void>` -- add to local
      read set, persist via plugin `saveData()`
- [ ] `markAllAsRead(deviceName: string): Promise<void>` -- add all current
      notification IDs for this device to local read set
- [ ] `isRead(notificationId: string): boolean` -- check local read set
- [ ] Local read state: `{ readNotificationIds: string[] }` stored in plugin
      data (not synced, per-device)

### 5.2 Create `src/notifications/notificationView.ts`

- [ ] Extend Obsidian `ItemView`
- [ ] View type: `"yaos-extension-notifications"`, display text:
      `"Notifications"`, icon: `"bell"`
- [ ] Header: title + unread count badge + "Mark all as read" button
- [ ] List of notifications sorted by `createdAt` descending
- [ ] Each notification card:
  - Type icon: speech bubble (`message-square`) for comment, `at-sign`
    for mention, `reply` for reply
  - "From: {deviceName}" with color dot
  - Preview text snippet (truncated to ~80 chars)
  - File name (clickable)
  - Relative timestamp ("2m ago", "1h ago", "yesterday")
  - Read/unread indicator (dot or bold text)
- [ ] Click handler:
  1. Open the source file (`workspace.openLinkText`)
  2. Open the comment sidebar
  3. Scroll to the relevant thread
  4. Mark the notification as read
  5. Refresh the notification view

### 5.3 Extend `src/statusBar.ts` -- Notification badge

- [ ] Accept optional `unreadCount: number` parameter in `update()` method
- [ ] When `unreadCount > 0`: render a small badge span after the existing
      status bar content with the count
- [ ] Style: `.yaos-extension-notification-badge` -- accent-colored circle
      with white text
- [ ] Click handler on badge: open notification view

### 5.4 Extend `src/main.ts` -- Wire notifications

- [ ] Create `NotificationStore` instance in `onload()`
- [ ] Register `"yaos-extension-notifications"` view via `registerView()`
- [ ] Wire notification generation from `commentStore` operations:
  - After `addComment()` with mentions -> create mention notifications
  - After `addReply()` with mentions -> create mention notifications
  - After `addReply()` to another device's comment -> create reply notification
- [ ] Watch `.yaos-extension/notifications.jsonl` for changes:
  - Refresh notification view
  - Update status bar badge count
- [ ] Add command: `{ id: "open-notifications", name: "Open notifications" }`
- [ ] Pass `unreadCount` to `statusBar.update()` calls
- [ ] `onunload()`: clean up notification view

### 5.5 Extend `src/styles.css` -- Notification styles

- [ ] `.yaos-extension-notification-badge` -- small accent-colored circle,
      positioned inline in status bar
- [ ] `.yaos-extension-notification-view` -- notification panel container
- [ ] `.yaos-extension-notification-card` -- card with left border color
- [ ] `.yaos-extension-notification-card.unread` -- bold text, accent dot
- [ ] `.yaos-extension-notification-card.read` -- muted text
- [ ] `.yaos-extension-notification-empty` -- empty state message

### 5.6 Create `src/notifications/notificationStore.test.ts`

- [ ] Test notification write/read round-trip
- [ ] Test filtering by device name
- [ ] Test read status tracking (mark as read, check isRead)
- [ ] Test unread count calculation
- [ ] Test mark all as read

---

## Phase 6: Polish & Testing

### 6.1 Additional tests

- [ ] `commentDecorations.test.ts` -- test `findRangeInDocument()` logic:
  exact match, fuzzy match with context, no match returns null, multiple
  occurrences disambiguated by context
- [ ] Manual integration test: add comment -> highlight appears -> reply ->
      notification generated -> notification links back to comment

### 6.2 Theme & mobile

- [ ] Verify all new CSS uses Obsidian CSS variables (no hardcoded colors)
- [ ] Test in light and dark themes
- [ ] Test sidebar views on mobile (responsive layout)

### 6.3 Settings tab

- [ ] Add `showComments` toggle: enables/disables comment highlights + sidebar
      command
- [ ] Add `showNotifications` toggle: enables/disables notification badge +
      notification panel command
- [ ] Immediate visual feedback when toggling (same pattern as existing
      `showPeerDotsInStatusBar` toggle)

### 6.4 Cleanup & docs

- [ ] Verify all event listeners use `this.register*` helpers
- [ ] Verify `onunload()` cleans up all views, CM extensions, DOM elements
- [ ] Update `src/AGENTS.md` architecture docs with new modules and data flow

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| CRDT merge corrupts JSONL line boundaries | Tolerant parser skips malformed lines; soft-deletes instead of line removal |
| Comment positions drift after text edits | Text snippet + context matching instead of absolute offsets; degrade gracefully (show in sidebar even if highlight cannot be placed) |
| `.yaos-extension/` folder confuses users | Obsidian hides dotfiles in explorer by default; note in plugin description |
| Notification file grows unbounded | Future: periodic cleanup of read notifications older than N days |
| Performance with many comments | Lazy-load comments per active file, not globally; debounce vault change events |

## Future Improvements

- **Yjs relative positions**: Use `Y.RelativePosition` via YAOS's Y.Doc for
  CRDT-aware position tracking that survives concurrent edits. Requires
  extending `yaosApi.ts` to expose the Y.Doc.
- **Notification pruning**: Automatic cleanup of old read notifications.
- **Rich mention targets**: Mention by role or group, not just device name.
- **Comment export**: Export comment threads as markdown.

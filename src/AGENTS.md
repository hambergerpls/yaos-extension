# YAOS Extension -- Architecture

This plugin adds presence indicators (cursor name labels, status bar), inline
comments, @mentions, and notifications on top of the YAOS sync plugin.

## Module dependency graph

```
main.ts  (orchestrator, plugin lifecycle, settings tab)
  |
  +-- settings.ts              (data-only: interface + defaults)
  +-- yaosApi.ts               (adapter: typed access to YAOS internals)
  +-- presenceTracker.ts       (event layer: subscribes to awareness changes)
  +-- statusBar.ts             (view: pure DOM rendering + notification badge)
  |
  +-- comments/
  |     +-- types.ts           (Comment, Reply, CommentThread)
  |     +-- commentStore.ts    (CRUD operations on document YAML frontmatter)
  |     +-- commentRenderer.ts (Shared rendering: Notion-style threads, avatars, editors)
  |     +-- inlineCommentPanel.ts (DOM injection: thin wrapper around CommentRenderer)
  |     +-- commentView.ts     (Obsidian ItemView: sidebar wrapper around CommentRenderer)
  |     +-- commentCommands.ts (Command registration + context menu)
  |     +-- commentDecorations.ts (CM6 ViewPlugin for inline highlights)
  |     +-- embeddedEditor.ts  (Editor factory: full Obsidian editor with bare CM6 fallback)
  |     +-- editorDiscovery.ts (Runtime discovery of Obsidian's internal editor class)
  |     +-- commentEditorOwner.ts (Proxy-based mock owner for standalone editor instances)
  |
  +-- mentions/
  |     +-- editorMentionPlugin.ts (CM6 ViewPlugin + keymap for @mention in editor + sidebar)
  |
  +-- notifications/
  |     +-- notificationStore.ts  (Read/write notifications.jsonl + local read state)
  |     +-- notificationView.ts   (Obsidian ItemView: notification panel)
  |     +-- notificationHelpers.ts (Pure functions: createMentionNotifications, createReplyNotification)
  |
  +-- editHistory/
  |     +-- types.ts              (EditHistoryData, FileHistoryEntry, VersionSnapshot)
  |     +-- editHistoryCompress.ts (Pure: fflate deflate-raw + base64 encode/decode for bases)
  |     +-- editHistoryDiff.ts    (Pure: diff-match-patch line-hunks + reconstructVersion + computeDiffSummary)
  |     +-- editHistoryStore.ts   (Read/write .yaos-extension/edit-history.json)
  |     +-- pendingEditsDb.ts     (IndexedDB crash-safe staging for in-flight edits)
  |     +-- editHistoryCapture.ts (Subscribes to Y.Map observeDeep + debounce/maxWait + batches into store)
  |     +-- editHistoryView.ts    (Obsidian ItemView: sidebar with date groups + session grouping)
  |
  +-- utils/
        +-- debounce.ts           (Trailing-edge debouncer for main.ts refresh coalescing)

styles.css               (CSS overrides for cursor labels + status bar + comments + notifications + edit history)
```

Direct import relationships:

| Module             | Imports from                        |
|--------------------|-------------------------------------|
| `main.ts`          | settings, yaosApi, presenceTracker, statusBar, comments/*, mentions/*, notifications/*, comments/editorDiscovery, utils/debounce |
| `presenceTracker`  | yaosApi                             |
| `statusBar`        | yaosApi (types only), settings (types only) |
| `yaosApi`          | obsidian (`App` only)               |
| `settings`         | nothing                             |
| `comments/types`   | nothing                             |
| `comments/commentStore` | comments/types, obsidian (`App`), ../logger |
| `comments/commentRenderer` | comments/commentStore, comments/embeddedEditor, mentions/editorMentionPlugin, yaosApi (types), obsidian (MarkdownRenderer, Component) |
| `comments/inlineCommentPanel` | comments/commentRenderer |
| `comments/commentView` | comments/commentRenderer, obsidian (`ItemView`, `App`) |
| `comments/commentCommands` | obsidian APIs |
| `comments/commentDecorations` | comments/types |
| `comments/editorDiscovery` | obsidian (`App` only) |
| `comments/commentEditorOwner` | obsidian (`App`, `Component`, `TFile`) |
| `comments/embeddedEditor` | comments/editorDiscovery, comments/commentEditorOwner, obsidian (`App`), @codemirror/view, @codemirror/state |
| `mentions/editorMentionPlugin` | yaosApi (types only), @codemirror/view, @codemirror/state |
| `notifications/notificationStore` | comments/types, obsidian (`Vault`) |
| `notifications/notificationView` | comments/types, notifications/notificationStore, obsidian view APIs |
| `notifications/notificationHelpers` | comments/types |
| `editHistory/types` | nothing |
| `editHistory/editHistoryCompress` | fflate |
| `editHistory/editHistoryDiff` | editHistory/types, editHistory/editHistoryCompress, diff-match-patch |
| `editHistory/pendingEditsDb` | nothing |
| `editHistory/editHistoryStore` | editHistory/types, editHistory/editHistoryCompress, editHistory/editHistoryDiff, obsidian (`Vault`), ../logger |
| `editHistory/editHistoryCapture` | editHistory/editHistoryStore, editHistory/editHistoryDiff, editHistory/editHistoryCompress, editHistory/types, editHistory/pendingEditsDb, ../logger |
| `editHistory/editHistoryView` | editHistory/editHistoryStore, editHistory/editHistoryDiff, editHistory/editHistoryCompress, editHistory/types, obsidian (`ItemView`) |
| `utils/debounce` | nothing |

Siblings never import each other. `main.ts` is the only module that wires everything
together.

## Startup sequence

1. `main.onload()` loads persisted settings via `loadData()`.
2. Applies/removes the `yaos-extension-names` CSS class on `document.body`.
   This class, combined with YAOS's own `.vault-crdt-show-cursors` class,
   activates the cursor name label CSS overrides in `styles.css`.
3. Creates a status bar element via `this.addStatusBarItem()` and wraps it in
   a `PresenceStatusBar` instance. Hides the element if settings say so.
4. Creates `CommentStore` and `NotificationStore`. The notification store is
   initialized with local read state from plugin data. CommentStore uses
   `app.fileManager.processFrontMatter` and `app.metadataCache` for YAML
   frontmatter read/write — no folder setup needed.
5. If `showComments` is enabled:
    - Creates an `InlineCommentPanel` instance
    - Registers the `"yaos-extension-comments"` view (sidebar)
    - Registers the "Toggle comment sidebar" command
    - Registers comment commands (Mod+Shift+M, context menu)
    - Watches the active file for vault modify events to refresh comments
    - Watches `active-leaf-change` to attach/refresh the inline panel
6. If `showNotifications` is enabled:
   - Registers the `"yaos-extension-notifications"` view
   - Registers the "Open notifications" command
   - Watches `.yaos-extension/notifications.jsonl` for changes
7. Checks `isYaosAvailable(app)`. If YAOS is missing, renders "Not synced" and
   shows a `Notice`. Otherwise creates a `PresenceTracker` and calls `start()`.
8. Registers the settings tab (`YaosExtensionSettingTab`).

## Runtime data flow

### Presence (existing)

```
YAOS plugin (Yjs awareness)
  |
  | awareness.on("change", handler)
  v
PresenceTracker
  |
  | calls PresenceChangeCallback(peers, awareness)
  v
main.ts :: onPresenceChange(peers)
  |
  | queries isYaosConnected(app), getLocalDeviceName(app)
  | queries notificationStore.getUnreadCount(localName)
  | calls statusBar.update(peers, isConnected, localName, unreadCount)
  v
PresenceStatusBar
  |
  | pure DOM render into statusBarEl
  v
Status bar UI (with optional notification badge)
```

### Comments

```
Editor (user selects text + Mod+Shift+M or context menu)
  |
  v
commentCommands :: getSelectionInfo(editor)
  |
  v
main.ts :: setPendingSelection + attachInlinePanel + refreshCommentView
  |
  v
InlineCommentPanel (injected in editor .cm-scroller, CM6 editor with selection quoted)
  |                     |
  | delegates to        | also refreshes
  v                     v
CommentRenderer     CommentView (right sidebar ItemView)
  |
  | user types comment, clicks "Comment" or presses Enter
  v
main.ts :: handleAddComment(text)
  |
  | extracts mentions via CommentStore.extractMentions(text)
  | writes comment to frontmatter via commentStore.addComment()
  | generates mention notifications via notificationHelpers
  | refreshes both inline panel and sidebar
  v
CommentRenderer :: refresh(container, filePath)
  |
  | reads threads from commentStore.getThreadsForFile()
  | renders thread cards with expand/collapse, reply, resolve, delete
  | editorMentionExtension provides @autocomplete in embedded CM6 editors
```

### Notifications

```
commentStore.addComment() / addReply()
  |
  v
main.ts :: generateNotificationsForComment/Reply()
  |
  | createMentionNotifications() / createReplyNotification()
  | writes to notificationStore.addNotification()
  v
.yaos-extension/notifications.jsonl (synced via YAOS)
  |
  | vault.on("modify") event
  v
main.ts :: refreshNotifications()
  |
  | updates notification view
  | updates status bar badge count
  v
NotificationView (sidebar panel with notification cards)
  |
  | click on notification -> markAsRead + openFileAndComment
  v
Editor opens file + inline panel attaches and shows thread
```

## Shutdown sequence

1. `main.onunload()` calls `inlinePanel.detach()` -- removes inline panel DOM,
   destroys embedded CM6 editors.
2. Calls `tracker.stop()` -- detaches the awareness listener,
   clears any polling interval, nulls the callback.
3. Calls `statusBar.destroy()` -- removes tooltip DOM, clears the status bar element.
4. Removes the `yaos-extension-names` class from `document.body`.
5. Removes any lingering `.yaos-extension-tooltip` elements from the DOM.
6. Removes any lingering `.yaos-extension-mention-dropdown` elements from the DOM.

## Module details

### yaosApi.ts -- YAOS adapter

All access to YAOS internals is isolated here. No other module touches YAOS directly.

The access chain uses `any`-casts at each step because YAOS does not export a
public API:

```
(app as any).plugins.getPlugin("yaos")
  -> plugin.vaultSync
    -> vaultSync.provider
      -> provider.awareness   (Yjs awareness protocol object)
      -> provider.wsconnected (WebSocket connection boolean)
  -> plugin.settings.deviceName
```

Every function returns `null` or `false` on failure. Guard clauses with early
returns handle each nullable step. Callers never need to worry about exceptions.

Exported functions:
- `isYaosAvailable(app)` -- checks if the YAOS plugin is loaded
- `isYaosConnected(app)` -- checks WebSocket connection state
- `getAwareness(app)` -- returns the typed `AwarenessLike` or null
- `getRemotePeers(awareness)` -- iterates awareness states, excludes local client,
  returns `RemotePeer[]` with name/color/cursor info
- `getLocalDeviceName(app)` -- reads the device name from YAOS settings

Exported types: `AwarenessLike`, `AwarenessChangeData`, `AwarenessUser`, `RemotePeer`.

### presenceTracker.ts -- Event subscription with retry

`PresenceTracker` handles the case where YAOS or its awareness may not be ready
when this plugin loads. It uses a two-phase polling strategy:

1. **Phase 1**: YAOS plugin not found. Poll `isYaosAvailable()` every 2 seconds.
2. **Phase 2**: YAOS found but awareness not initialized. Poll `getAwareness()`
   every 3 seconds.
3. **Connected**: Subscribes to `awareness.on("change", handler)`. No more polling.

Once connected, every awareness change triggers `notifyCallback()`, which calls
`getRemotePeers()` and passes the result to the registered callback.

Cleanup: `stop()` removes the awareness listener (wrapped in try/catch because the
awareness object may already be destroyed), clears polling, and nulls all state.

Public API:
- `start(callback)` -- begins connection attempt
- `stop()` -- full teardown
- `isReady` (getter) -- whether awareness is connected
- `currentAwareness` (getter) -- the live awareness object, used by settings tab
  to trigger immediate re-renders

### statusBar.ts -- Status bar rendering + notification badge

`PresenceStatusBar` receives data through `update(peers, isConnected, localName, unreadCount?)`
and renders DOM into the Obsidian status bar element it was given at construction.

Rendering states:
- **Disconnected, no peers**: gray dot + "Not synced"
- **Connected, no peers**: green dot + "1 device online"
- **Connected, 1 peer**: green dot + "You + {name}"
- **Connected, 2+ peers**: green dot + "You + {n} collaborators"

If `settings.showPeerDotsInStatusBar` is true, colored dots are appended for each
peer. Hovering a dot shows a tooltip (fixed-position div on `document.body`) with
the peer's name, color, and an edit icon if they have an active cursor.

If `unreadCount > 0`, a notification badge is appended with the count. Clicking
the badge calls the `onBadgeClick` callback (opens the notification view).

Constructor: `new PresenceStatusBar(el, settings, onBadgeClick?)`

### comments/types.ts -- Shared type definitions

Exports: `Comment`, `Reply`, `CommentThread`. Pure data, no logic.

### comments/commentStore.ts -- YAML frontmatter persistence

Reads/writes a `yaos-comments` map in each document's YAML frontmatter.
Comment IDs are `String(Date.now())` timestamps used as YAML map keys.
Insertion order in the YAML map determines display order (not sorted by offset).
Hard deletes remove the key from the map. Resolves flip the boolean directly.
Edits overwrite `text`/`mentions` and set `editedAt`. No audit trail.

Uses `app.fileManager.processFrontMatter(file, fn)` for atomic writes and
`app.metadataCache.getFileCache(file)?.frontmatter` for reads.

Key methods:
- `getThreadsForFile(filePath)` -- reads frontmatter, builds CommentThread[]
- `addComment(filePath, comment)` -- writes comment to frontmatter
- `addReply(filePath, reply)` -- writes reply to comment's replies sub-map
- `deleteEntry(filePath, targetId)` -- hard deletes comment or reply from map
- `resolveComment(filePath, commentId, resolved)` -- flips resolved boolean
- `editEntry(filePath, targetId, newText)` -- overwrites text, mentions, editedAt
- `extractMentions(text)` -- static, parses `@Name` patterns

Constructor: `new CommentStore(app: App)`.

### comments/commentRenderer.ts -- Shared Notion-style rendering

Extracted rendering logic shared by both `InlineCommentPanel` and `CommentView`.
Owns all rendering state and DOM construction.

Public API:
- `refresh(container, filePath)` -- loads threads and renders into container
- `loadThreads(filePath)` -- loads threads without rendering (for header count)
- `render(container)` -- renders current threads into container
- `setPendingSelection(selection)` -- queues selection text for next render
- `getThreadCount()` -- returns loaded thread count
- `getThreads()` -- returns loaded threads
- `destroy()` -- cleans up CM6 editors and render components

Contains all rendering methods: `renderAll`, `renderThreads`, `renderThreadCard`,
`renderCommentItem`, `renderReplyItems`, `renderReplyInput`, `renderInput`,
`renderCommentBody`, `renderMentionsIntoFallback`, `formatRelativeTime`.

Manages: `editors`, `replyEditors`, `renderComponents`, `collapsedReplies`,
`editingCommentId`/`editingReplyId`, `draftText`, `pendingSelection`,
`currentFilePath`, `renderGeneration`.

Serializes concurrent `refresh()` calls via `renderGeneration` — the
counter is bumped at the start of `refresh()` *before* awaiting
`store.getThreadsForFile()`, so stale refreshes are dropped before they
mutate `this.threads` or touch the DOM. The counter is also re-bumped
inside `renderAll` to gate async `MarkdownRenderer.render` completions.

Constructor: `new CommentRenderer(store, app, callbacks?)`.

### comments/inlineCommentPanel.ts -- Inline panel in editor (thin wrapper)

DOM-injected panel that appears inline in the editor's `.cm-scroller` (source mode
only), inserted before `.cm-contentContainer` inside `.cm-sizer`. Delegates all
rendering to `CommentRenderer`.

Retains only:
- `attach(scroller)` / `detach()` — DOM injection lifecycle
- `expanded` state + collapsible "Comments (N)" header toggle
- Own `contentEl` shown/hidden based on expansion state

Public API:
- `attach(scroller)` -- injects panel DOM before `.cm-contentContainer`
- `detach()` -- removes panel DOM and cleans up editors
- `refresh(filePath)` -- loads threads and re-renders
- `setPendingSelection(selection)` -- queues selection text for next render

### comments/commentView.ts -- Sidebar panel (thin wrapper)

Obsidian `ItemView` with view type `"yaos-extension-comments"`. Delegates all
rendering to `CommentRenderer`. Appears in the right sidebar.

Public API:
- `getViewType()` → `"yaos-extension-comments"`
- `getDisplayText()` → `"Comments"`
- `getIcon()` → `"message-square"`
- `onOpen()` -- registers internal link click handler
- `onClose()` -- destroys renderer
- `refresh(filePath)` -- loads threads and renders into contentEl
- `setPendingSelection(selection)` -- queues selection text
- `getThreads()` -- returns loaded threads

Constructor: `new CommentView(leaf, store, app, callbacks?)`.

### comments/embeddedEditor.ts -- Editor factory (Obsidian + fallback)

Creates editor instances for the inline comment panel. The primary path uses
Obsidian's internal editor component (discovered at runtime via
`editorDiscovery.ts`) with a mock owner (`commentEditorOwner.ts`), giving full
markdown syntax highlighting, formatting hotkeys, and workspace-level plugin
extensions (including @mentions). Falls back to a bare CM6 `EditorView` when
discovery fails (e.g. no MarkdownView is open).

Returns an `EmbeddedEditorHandle` with `getText`, `setText`, `clear`, `focus`,
and `destroy` methods. Enter-to-submit uses a DOM keydown listener (Obsidian
path) or CM6 keymap (fallback path).

Constructor: `createEmbeddedEditor(parent, options)`.

### comments/editorDiscovery.ts -- Runtime discovery of internal editor class

Discovers Obsidian's internal scroll-aware editor component class (`aZ` in
minified code) by walking the prototype chain of a live `MarkdownView`'s
`editMode` property. Uses feature detection (checks for `buildLocalExtensions`,
`getDynamicExtensions`, `set`, `clear`, etc.) rather than position-based chain
walking. Caches the result as a module-level singleton; call
`resetEditorDiscovery()` on plugin unload to clear the cache.

Exports: `getEditorComponentClass(app)`, `resetEditorDiscovery()`.

### comments/commentEditorOwner.ts -- Mock owner for standalone editors

Creates a Proxy-based mock object that satisfies the `owner` parameter required
by Obsidian's internal editor constructor. Provides `app`, `file: null`,
`getFile()`, `getMode() → "source"`, and stubs for save/fold callbacks. Unknown
property access returns `undefined` and logs a warning for debugging.

### comments/commentCommands.ts -- Command registration

Exports `registerCommentCommands(plugin, store, getDeviceInfo, refreshCallback)` and
`getSelectionInfo(editor)`. Registers Mod+Shift+M command and editor context menu
item. Both open the comment sidebar and pre-fill the selection.

### comments/commentDecorations.ts -- Editor highlights

Exports `findRangeInDocument(doc, rangeText, rangeContext, rangeOffset)` -- pure
function that locates commented text ranges using text matching and context
disambiguation. Returns `{from, to} | null`.

### notifications/notificationStore.ts -- Notification persistence

`NotificationStore` manages `.yaos-extension/notifications.jsonl` (synced) and
local read state (per-device, persisted via plugin `loadData/saveData`).

Key methods:
- `init()` -- loads local read state
- `addNotification(notification)` -- append JSON line
- `getNotificationsForDevice(deviceName)` -- filter by targetDevice
- `getUnreadCount(deviceName)` -- count unread for device
- `markAsRead(id)` / `markAllAsRead(deviceName)` -- update local read set
- `isRead(id)` -- check local read set

Constructor: `new NotificationStore(vault, loadData, saveData)`.

### notifications/notificationView.ts -- Notification panel

Obsidian `ItemView` with view type `"yaos-extension-notifications"`. Renders
notification cards sorted by `createdAt` descending, with unread indicators,
kind icons, from-device info, preview text, and file name. Click marks as read
and navigates to the source file + comment thread. Uses a `refreshGeneration`
counter to drop stale concurrent refreshes before they mutate
`this.notifications` or touch the DOM.

Constructor: `new NotificationView(leaf, store, deviceName, onOpenFile)`.

### notifications/notificationHelpers.ts -- Pure notification generators

Pure functions with no side effects:
- `createMentionNotifications(opts)` -- returns `Notification[]` for each mention
- `createReplyNotification(opts)` -- returns `Notification | null` (null if
  replier is the comment author)

### editHistory/types.ts -- Shared type definitions

Exports `EditHistoryData`, `FileHistoryEntry`, `VersionSnapshot`, `LineHunk`.
Pure data, no logic. A `VersionSnapshot` has either `content` (base version)
or `hunks` (line-oriented delta). `EditHistoryData.version` is `3`;
version-1 files (char-level `diff` tuples) and version-2 files (line-hunks
with plaintext bases) are silently wiped on load — see
`editHistoryStore.load`.

`LineHunk = { s: number; d: number; a: string[] }` encodes one change region
relative to the reconstructed previous version. `s` is the 0-indexed starting
line, `d` is the number of old lines deleted, `a` is the list of new lines
inserted at that position. Old line text is *not* stored — derive it by
reconstructing the previous version and slicing `[s, s+d)`.

`content` may be stored either as plain UTF-8 (no `contentEnc`) or as
deflate-raw + base64 (`contentEnc: "dfb64"`). Encoding is chosen by
`editHistoryCompress.encodeContent` — see that module.

### editHistory/editHistoryCompress.ts -- Base content compression

Pure helpers for encoding / decoding `VersionSnapshot.content`:

- `encodeContent(raw)` → `{ content, contentEnc? }`. Returns raw plaintext
  when `raw.length < 512` OR when deflate-raw + base64 does not shrink the
  payload. Otherwise returns `{ content: <b64>, contentEnc: "dfb64" }`.
- `decodeContent(content, contentEnc)` → raw string. Inverse of
  `encodeContent`. Throws on unknown `contentEnc`. An `undefined`
  `contentEnc` is a no-op (raw plaintext).

The chunked base64 helpers (`u8ToB64`, `b64ToU8`) walk 0x8000-byte slices
to avoid call-stack overflow on large inputs.

Uses `fflate`'s sync `deflateSync` / `inflateSync` (raw DEFLATE per
RFC 1951, no wrapper — fflate's `deflateSync` is the raw variant; the
zlib-wrapped form is `zlibSync`). Sync is a deliberate choice — works
identically on desktop and mobile WebViews with no Promise plumbing.

Dependencies: `fflate`.

### editHistory/editHistoryDiff.ts -- Diff + reconstruction

Pure functions built on `diff-match-patch` line-mode:

- `computeLineHunks(old, new)` -- returns `LineHunk[]`. Splits both inputs
  on `\n` (so `"a\n"` → `["a", ""]` and `""` → `[]`), hashes each unique
  line to a single Unicode char, runs `dmp.diff_main` on the hashed
  strings, then walks the resulting tuples to emit one hunk per contiguous
  `-1`/`+1` run. The hand-rolled hasher is deliberate: `dmp`'s built-in
  `diff_linesToChars_` keeps `\n` attached to each line and collapses
  trailing-newline differences (`"a"` vs `"a\n"`) into a single token,
  which breaks roundtrip semantics.
- `applyLineHunks(base, hunks)` -- returns new content. Splits `base` on
  `\n` (empty `""` is treated as 0 lines, not 1), walks `hunks` in
  ascending `s`, splicing each in turn, then rejoins with `\n`.
- `reconstructVersion(entry, versionIndex)` -- walks the delta chain from
  `entry.baseIndex` applying `applyLineHunks` for each step. The base's
  `content` is passed through `decodeContent(base.content, base.contentEnc)`
  first so dfb64-encoded bases are transparently inflated. Returns `null`
  on a missing or content-less link.
- `computeDiffSummary(hunks)` -- returns `{ added, removed }` computed as
  `Σ h.a.length` and `Σ h.d` respectively (line-counted, not
  character-counted).

Two rendering helpers drive the hunk-style sidebar view:
`buildHunks(lines, context)` groups a `DiffLine[]` into alternating
`{ kind: "hunk"; lines }` and `{ kind: "skip"; count }` items by extending a
`context`-wide window around each change line (overlapping windows merge).
`DEFAULT_CONTEXT_LINES = 3` matches GitHub's default. The `DiffLine[]` itself
is synthesized inside `editHistoryView` by walking `prevLines` + `LineHunk[]`;
this module no longer owns a character-level diff op type.

### editHistory/editHistoryStore.ts -- JSON persistence

`EditHistoryStore` manages `.yaos-extension/edit-history.json` (synced via
YAOS). Maintains an in-memory copy; flushes to disk after each mutation
via `saveData()` queue.

Key methods:
- `load()` / `save()` -- disk I/O
- `getEntry(fileId)` -- returns `FileHistoryEntry | undefined`
- `transaction<T>(fn)` -- atomic read-compute-write primitive
- `addVersion(fileId, path, snap)` -- single version
- `addVersions(batch)` -- batched writes for flush/recovery paths
- `prune()` / `pruneEntry(fileId)` -- retention cleanup

All mutating methods (`addVersion`, `addVersions`, `prune`, `pruneEntry`)
are serialized through an internal `writeQueue: Promise<void>` so
concurrent mutations can't interleave their load-modify-save cycles.
The `transaction<T>(fn)` primitive exposes this atomicity to callers
that need read-compute-write — `EditHistoryCapture` uses it to compute
diffs and dedup decisions against an up-to-date entry snapshot. Reads
(`getEntry`, `load`) remain unqueued because `adapter.write` is atomic
at the filesystem level.

`load()` silently wipes persisted data whose `version` is not `3` — both
legacy v1 (char-level diff tuples) and v2 (line-hunks with plaintext bases)
are dropped. `prune` re-encodes any synthesized rebase base through
`encodeContent` before writing, so compressed bases stay compressed across
retention rollover.

Constructor: `new EditHistoryStore(vault, filePath)`.

### editHistory/pendingEditsDb.ts -- IndexedDB crash-safe staging

Crash-safe buffer for in-flight edits that haven't yet been promoted to
the synced JSON. Written on every keystroke; cleared after promotion.
Orphans (e.g. from a browser crash mid-debounce) are recovered on next
plugin load via `recoverOrphans()`.

Key methods: `open()`, `put(edit)`, `get(fileId)`, `getAll()`,
`remove(fileId)`, `clear()`, `close()`.

Constructor: `new PendingEditsDb(dbName)`.

### editHistory/editHistoryCapture.ts -- Capture orchestrator

Subscribes to `vaultSync.idToText.observeDeep(...)` and funnels every
observed Y.Map / Y.Text change through a two-timer debounce-with-maxWait
pattern, then promotes staged edits from IndexedDB into the JSON store.

Per file, keeps a `FileTimer { idle, max, firstScheduledAt }`:

- **idle** (`settings.debounceMs`, default 5s): reset on every edit. Fires
  when the user pauses typing.
- **max** (`settings.maxWaitMs`, currently hardcoded 60s in `main.ts`): set
  once at the start of a burst and never reset. Guarantees a snapshot even
  during continuous editing when idle would be starved.

Whichever timer fires first calls `fireCapture()`, which cancels the other,
deletes the map entry, and promotes the pending IDB edit into the store.

Other responsibilities:
- Enforces `maxPerFilePerDay` quota
- Rebases to a full-content snapshot every `rebaseInterval` versions
- Skips captures when content matches last version
- `flush()` and `stop()` both drain timers and promote any pending edits
- `recoverOrphans()` promotes stale IDB entries on plugin load

`captureSnapshot` and `batchCapture` both go through
`EditHistoryStore.transaction` so the entry lookup, diff/rebase
decision, and version append happen atomically against all other
store mutations. `promoteFromDb` removes the IDB entry only after a
successful capture; failures are warn-logged and keep the pending
entry in IDB for `recoverOrphans` to retry on the next plugin load.

Constructor: `new EditHistoryCapture(store, getDeviceName, settings, maxSizeBytes, pendingDb)`.

### editHistory/editHistoryView.ts -- Sidebar panel

Obsidian `ItemView` with view type `"yaos-extension-edit-history"`.
Renders a file's version timeline grouped first by calendar date and
then by **session**.

A session is a run of consecutive versions (newest-first walk) where:
- device is the same
- adjacent timestamps are within 5 minutes

Sessions with a single version render as a flat entry (no chrome).
Multi-version sessions render a collapsible header showing device,
time range, edit count, and aggregate added/removed line counts;
individual versions with their Restore buttons are revealed on
expand. Expanded-state persists across `refresh()` calls via the
instance field `expandedSessions: Set<string>` keyed by
`${device}-${startTs}`. Midnight-spanning sessions are filed under
the **newest** version's calendar date so they stay grouped.
**Concurrent `refresh()` calls are deduplicated via a
`refreshGeneration` counter** — the stale refresh no-ops after its
awaited `store.getEntry()` resolves, so only the latest call ever
mutates the DOM.

Each version entry renders an always-visible GitHub-style hunk diff
below its summary line. Both stored deltas (`version.hunks`) and
mid-chain rebase bases (`content`-only versions at `versionIndex > 0` that
synthesize hunks via `computeLineHunks(reconstructVersion(entry,
versionIndex - 1), version.content)`) flow through one private helper,
`renderLineHunks`. That helper splits `prevContent` on `\n`, walks the
`LineHunk[]` emitting `{kind:"retain"}` rows from gaps between hunks,
`{kind:"del"}` rows from the `[s, s+d)` slice of `prevLines`, and
`{kind:"add"}` rows from `h.a`; feeds the resulting `DiffLine[]` through
`buildHunks(_, 3)` for GitHub-style context windowing; and renders one
`.diff-hunk` container per hunk, one `.diff-line` per row with a
`.diff-gutter` (` ` / `+` / `-`) and `.diff-line-text`. Each row is
additionally classed `.diff-retain-line` / `.diff-add-line` /
`.diff-del-line` for background tint. Runs of unchanged lines outside
the 3-line context window collapse into a `.diff-hunk-skip` marker
(`… N unchanged lines`). The initial snapshot (`versionIndex === 0`)
still renders as a single insert-styled `.diff-add` span truncated to
20 lines with a `… (N more lines)` marker — it does NOT use the hunk
rendering. The displayed text is piped through
`decodeContent(version.content, version.contentEnc)` first so
dfb64-encoded bases render as decompressed plaintext. Mid-chain rebase
bases are likewise decoded before the `computeLineHunks` synthesis. If
reconstruction returns null for a mid-chain base, a `.diff-unavailable`
fallback label renders instead.

Constructor: `new EditHistoryView(leaf, store, onRestore)`.

### utils/debounce.ts -- Trailing-edge debouncer

Small stateful helper used by `main.ts` to coalesce burst refresh
calls from workspace/vault listeners. `createDebouncer(ms)` returns
a function that schedules a task after `ms` ms of quiescence, replacing
any previously-scheduled task. Returns a promise that resolves when
the scheduled task completes, so `await refreshXxx()` still has
deterministic semantics. Used at 50 ms for `refreshCommentView`,
`refreshEditHistoryView`, and `refreshNotifications`.

Dependencies: none.

### settings.ts -- Configuration data

Exports the `YaosExtensionSettings` interface and `DEFAULT_SETTINGS`.
Pure data, no logic.

Toggle fields: `showCursorNames`, `showStatusBar`, `showPeerDotsInStatusBar`,
`showComments`, `showNotifications`, `showEditHistory`.

Edit history tuning: `editHistoryRetentionDays` (default 30),
`editHistoryMaxPerFilePerDay` (default 50), `editHistoryDebounceMs`
(default 5000 — idle before capture), `editHistoryRebaseInterval`
(default 10 — deltas between base snapshots). The maxWait companion
(60s) is hardcoded in `main.ts` and not user-configurable.

### styles.css -- CSS layer

Four independent concerns:

1. **Cursor name labels**: Overrides YAOS's `display: none !important` on
   `.cm-ySelectionInfo` using a higher-specificity selector
   `.vault-crdt-show-cursors.yaos-extension-names .cm-ySelectionInfo`. Labels
   are hidden by default (`opacity: 0`) and fade in on hover of the parent
   `.cm-ySelectionCaret`. This is entirely CSS-driven -- no JS rendering needed.

2. **Status bar + notification badge**: Styles for `.yaos-extension-statusbar`,
   connection dots, peer dots, floating tooltip, and notification badge. Uses
   Obsidian CSS variables for theme compatibility.

 3. **Comment panel (Notion-style)**: Shared styles for both inline and sidebar
    views — 24px circular avatars with initials, vertical thread lines, hover-only
    action toolbars (SVG icon buttons), "Show N replies" collapse buttons, thread
    wrapper hover backgrounds, quote blocks, reply input, expand/collapse animations,
    edit mode, and @mention highlighting. Sidebar has its own padding via
    `.yaos-extension-comment-view`.

 4. **Notification panel + mention dropdown**: Styles for notification cards,
   unread indicators, kind icons, the mention autocomplete dropdown with
   peer color dots.

## Settings tab wiring

The settings tab (`YaosExtensionSettingTab`) lives in `main.ts` alongside the
plugin class. It has direct access to the plugin instance and can:

- Toggle the body CSS class via `plugin.applyCursorNames()` (cursor names)
- Show/hide the status bar element via `plugin.statusBarEl.style.display`
- Trigger an immediate status bar re-render by reading `plugin.tracker.currentAwareness`,
  calling `getRemotePeers()` and `plugin.statusBar.update()` directly
- Toggle `showComments` / `showNotifications` (requires plugin reload)

This means the settings tab bypasses the normal tracker -> callback -> statusBar
flow for immediate visual feedback when toggling peer dots.

## Key architectural constraints

- **All YAOS access goes through `yaosApi.ts`**. If YAOS changes its internals,
  only this file needs updating.
- **`statusBar` is a pure view**. It never queries external state; it renders
  what it receives.
- **`presenceTracker` is the only event subscriber**. There is exactly one
  awareness change listener in the entire plugin.
- **Composition, not inheritance**. `main.ts` owns `tracker`, `statusBar`,
  `commentStore`, `notificationStore`, and `inlinePanel` as nullable fields. All are
  created/destroyed in the plugin lifecycle.
- **Callback-based wiring**. The tracker takes a plain callback function, not an
  event emitter or observable. `main.ts` passes closures that bridge outputs
  to the appropriate views and stores.
- **Views never import each other**. `InlineCommentPanel`, `CommentView`, and
  `NotificationView` are siblings. All communication goes through `main.ts`.
  Both `InlineCommentPanel` and `CommentView` delegate to `CommentRenderer`.
- **Comment/notification stores are siblings**. They never import each other.
  `main.ts` coordinates notification generation after comment operations.
- **Store writes are serialized.** `EditHistoryStore` exposes
  `transaction<T>(fn)` for callers that need atomic read-compute-write.
  Direct callers of `addVersion`/`addVersions` get serialization for
  free via the internal write queue.

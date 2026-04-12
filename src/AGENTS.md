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
  |     +-- types.ts           (Comment, Reply, ResolveEntry, Deletion, Notification)
  |     +-- commentStore.ts    (CRUD operations on JSONL files)
  |     +-- commentView.ts     (Obsidian ItemView: sidebar panel)
  |     +-- commentCommands.ts (Command registration + context menu)
  |     +-- commentDecorations.ts (CM6 ViewPlugin for inline highlights)
  |     +-- embeddedEditor.ts  (CM6 editor factory for sidebar inputs)
  |
  +-- mentions/
  |     +-- editorMentionPlugin.ts (CM6 ViewPlugin + keymap for @mention in editor + sidebar)
  |
  +-- notifications/
        +-- notificationStore.ts  (Read/write notifications.jsonl + local read state)
        +-- notificationView.ts   (Obsidian ItemView: notification panel)
        +-- notificationHelpers.ts (Pure functions: createMentionNotifications, createReplyNotification)

styles.css               (CSS overrides for cursor labels + status bar + comments + notifications)
```

Direct import relationships:

| Module             | Imports from                        |
|--------------------|-------------------------------------|
| `main.ts`          | settings, yaosApi, presenceTracker, statusBar, comments/*, mentions/*, notifications/* |
| `presenceTracker`  | yaosApi                             |
| `statusBar`        | yaosApi (types only), settings (types only) |
| `yaosApi`          | obsidian (`App` only)               |
| `settings`         | nothing                             |
| `comments/types`   | nothing                             |
| `comments/commentStore` | comments/types, obsidian (`Vault`) |
| `comments/commentView` | comments/commentStore, comments/embeddedEditor, mentions/editorMentionPlugin, yaosApi (types), obsidian view APIs |
| `comments/commentCommands` | obsidian APIs |
| `comments/commentDecorations` | comments/types |
| `comments/embeddedEditor` | @codemirror/view, @codemirror/state |
| `mentions/editorMentionPlugin` | yaosApi (types only), @codemirror/view, @codemirror/state |
| `notifications/notificationStore` | comments/types, obsidian (`Vault`) |
| `notifications/notificationView` | comments/types, notifications/notificationStore, obsidian view APIs |
| `notifications/notificationHelpers` | comments/types |

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
   initialized with local read state from plugin data.
5. If `showComments` is enabled:
   - Registers the `"yaos-extension-comments"` view
   - Registers comment commands (Mod+Shift+M, context menu)
   - Watches `.yaos-extension/comments/` for vault changes
   - Watches `active-leaf-change` to refresh the sidebar
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
CommentView (sidebar shows CM6 editor with selection quoted)
  |
  | user types comment, clicks "Comment" or presses Enter
  v
main.ts :: handleAddComment(text)
  |
  | extracts mentions via CommentStore.extractMentions(text)
  | writes comment to JSONL via commentStore.addComment()
  | generates mention notifications via notificationHelpers
  | refreshes sidebar
  v
CommentView :: refresh(filePath)
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
Editor opens file + CommentView scrolls to thread
```

## Shutdown sequence

1. `main.onunload()` calls `tracker.stop()` -- detaches the awareness listener,
   clears any polling interval, nulls the callback.
2. Calls `statusBar.destroy()` -- removes tooltip DOM, clears the status bar element.
3. Removes the `yaos-extension-names` class from `document.body`.
4. Removes any lingering `.yaos-extension-tooltip` elements from the DOM.
5. Removes any lingering `.yaos-extension-mention-dropdown` elements from the DOM.

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

Exports: `Comment`, `Reply`, `ResolveEntry`, `Deletion`, `Notification`,
`CommentEntry` (union), `CommentThread`. Pure data, no logic.

### comments/commentStore.ts -- JSONL persistence

CRUD operations on per-file JSONL in `.yaos-extension/comments/`. Path encoding
uses `%2F` for `/` in vault-relative paths. Soft-deletes via `Deletion` entries.
`ResolveEntry` overrides comment's resolved state (last-writer-wins by timestamp).

Key methods:
- `getThreadsForFile(filePath)` -- parses JSONL, applies deletes/resolves, groups replies
- `addComment/addReply` -- append JSON lines
- `deleteEntry` -- append soft-delete entry
- `resolveComment` -- append resolve entry
- `extractMentions(text)` -- static, parses `@Name` patterns

### comments/commentView.ts -- Sidebar panel

Obsidian `ItemView` with view type `"yaos-extension-comments"`. Renders thread
cards with expand/collapse animation, reply input, resolve/reopen, and delete
(own comments/replies only). Uses embedded CM6 editors (via `embeddedEditor.ts`)
for comment and reply input, with `editorMentionExtension` for @mention autocomplete.
Mention rendering uses DOM-safe `renderMentionsInto()` with `createTextNode`.

Constructor receives callbacks: `onAddComment`, `onAddReply`, `onResolve`,
`onDelete`, `onDeleteReply`, `getPeers`.

### comments/embeddedEditor.ts -- CM6 editor factory

Creates compact CM6 `EditorView` instances for use in the comment sidebar.
Returns an `EmbeddedEditorHandle` with `getText`, `setText`, `clear`, `focus`,
and `destroy` methods. Supports Enter-to-submit (Shift+Enter for newline),
placeholder text, and extra CM6 extensions (used for @mention support).

Constructor: `createEmbeddedEditor(parent, options)`.

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
and navigates to the source file + comment thread.

Constructor: `new NotificationView(leaf, store, deviceName, onOpenFile)`.

### notifications/notificationHelpers.ts -- Pure notification generators

Pure functions with no side effects:
- `createMentionNotifications(opts)` -- returns `Notification[]` for each mention
- `createReplyNotification(opts)` -- returns `Notification | null` (null if
  replier is the comment author)

### settings.ts -- Configuration data

Exports the `YaosExtensionSettings` interface (5 booleans) and `DEFAULT_SETTINGS`.
Pure data, no logic.

Fields: `showCursorNames`, `showStatusBar`, `showPeerDotsInStatusBar`,
`showComments`, `showNotifications`.

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

3. **Comment sidebar**: Styles for thread cards, author dots, quote blocks,
   reply input, expand/collapse animations, delete buttons, and @mention
   highlighting.

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
  `commentStore`, and `notificationStore` as nullable fields. All are
  created/destroyed in the plugin lifecycle.
- **Callback-based wiring**. The tracker takes a plain callback function, not an
  event emitter or observable. `main.ts` passes closures that bridge outputs
  to the appropriate views and stores.
- **Views never import each other**. `CommentView` and `NotificationView` are
  siblings. All communication goes through `main.ts`.
- **Comment/notification stores are siblings**. They never import each other.
  `main.ts` coordinates notification generation after comment operations.

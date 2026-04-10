# YAOS Extension -- Architecture

This plugin adds presence indicators (cursor name labels, status bar) on top of the
YAOS sync plugin. It has no commands -- it is entirely passive, driven by Yjs
awareness events and CSS overrides.

## Module dependency graph

```
main.ts  (orchestrator, plugin lifecycle, settings tab)
  |
  +-- settings.ts        (data-only: interface + defaults)
  +-- yaosApi.ts          (adapter: typed access to YAOS internals)
  +-- presenceTracker.ts  (event layer: subscribes to awareness changes)
  +-- statusBar.ts        (view: pure DOM rendering)

styles.css               (CSS overrides for cursor labels + status bar UI)
```

Direct import relationships:

| Module             | Imports from                        |
|--------------------|-------------------------------------|
| `main.ts`          | settings, yaosApi, presenceTracker, statusBar |
| `presenceTracker`  | yaosApi                             |
| `statusBar`        | yaosApi (types only), settings (types only) |
| `yaosApi`          | obsidian (`App` only)               |
| `settings`         | nothing                             |

`statusBar` and `presenceTracker` are siblings -- they never import each other.
`main.ts` is the only module that wires them together.

## Startup sequence

1. `main.onload()` loads persisted settings via `loadData()`.
2. Applies/removes the `yaos-extension-names` CSS class on `document.body`.
   This class, combined with YAOS's own `.vault-crdt-show-cursors` class,
   activates the cursor name label CSS overrides in `styles.css`.
3. Creates a status bar element via `this.addStatusBarItem()` and wraps it in
   a `PresenceStatusBar` instance. Hides the element if settings say so.
4. Checks `isYaosAvailable(app)`. If YAOS is missing, renders "Not synced" and
   shows a `Notice`. Otherwise creates a `PresenceTracker` and calls `start()`.
5. Registers the settings tab (`YaosExtensionSettingTab`).

## Runtime data flow

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
  | calls statusBar.update(peers, isConnected, localName)
  v
PresenceStatusBar
  |
  | pure DOM render into statusBarEl
  v
Status bar UI
```

The tracker fires the callback on every awareness change event. `main.ts`
bridges the tracker output to the status bar by querying connection state and
local device name from `yaosApi`, then passing everything to `statusBar.update()`.

The status bar is a pure renderer -- it receives data and produces DOM. It never
queries YAOS directly (it only imports types from `yaosApi` and `settings`).

## Shutdown sequence

1. `main.onunload()` calls `tracker.stop()` -- detaches the awareness listener,
   clears any polling interval, nulls the callback.
2. Calls `statusBar.destroy()` -- removes tooltip DOM, clears the status bar element.
3. Removes the `yaos-extension-names` class from `document.body`.
4. Removes any lingering `.yaos-extension-tooltip` elements from the DOM.

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

### statusBar.ts -- Status bar rendering

`PresenceStatusBar` receives data through `update(peers, isConnected, localName)`
and renders DOM into the Obsidian status bar element it was given at construction.

Rendering states:
- **Disconnected, no peers**: gray dot + "Not synced"
- **Connected, no peers**: green dot + "1 device online"
- **Connected, 1 peer**: green dot + "You + {name}"
- **Connected, 2+ peers**: green dot + "You + {n} collaborators"

If `settings.showPeerDotsInStatusBar` is true, colored dots are appended for each
peer. Hovering a dot shows a tooltip (fixed-position div on `document.body`) with
the peer's name, color, and an edit icon if they have an active cursor.

The settings object is passed by reference at construction -- the status bar reads
live values from it on each `update()` call without needing a setter.

### settings.ts -- Configuration data

Exports the `YaosExtensionSettings` interface (3 booleans) and `DEFAULT_SETTINGS`.
Pure data, no logic.

### styles.css -- CSS layer

Two independent concerns:

1. **Cursor name labels**: Overrides YAOS's `display: none !important` on
   `.cm-ySelectionInfo` using a higher-specificity selector
   `.vault-crdt-show-cursors.yaos-extension-names .cm-ySelectionInfo`. Labels
   are hidden by default (`opacity: 0`) and fade in on hover of the parent
   `.cm-ySelectionCaret`. This is entirely CSS-driven -- no JS rendering needed.

2. **Status bar**: Styles for `.yaos-extension-statusbar`, connection dots,
   peer dots, and the floating tooltip. Uses Obsidian CSS variables
   (`--text-muted`, `--background-secondary`, `--interactive-success`, etc.)
   for theme compatibility.

## Settings tab wiring

The settings tab (`YaosExtensionSettingTab`) lives in `main.ts` alongside the
plugin class. It has direct access to the plugin instance and can:

- Toggle the body CSS class via `plugin.applyCursorNames()` (cursor names)
- Show/hide the status bar element via `plugin.statusBarEl.style.display`
- Trigger an immediate status bar re-render by reading `plugin.tracker.currentAwareness`,
  calling `getRemotePeers()` and `plugin.statusBar.update()` directly

This means the settings tab bypasses the normal tracker -> callback -> statusBar
flow for immediate visual feedback when toggling peer dots.

## Key architectural constraints

- **All YAOS access goes through `yaosApi.ts`**. If YAOS changes its internals,
  only this file needs updating.
- **`statusBar` is a pure view**. It never queries external state; it renders
  what it receives.
- **`presenceTracker` is the only event subscriber**. There is exactly one
  awareness change listener in the entire plugin.
- **Composition, not inheritance**. `main.ts` owns `tracker` and `statusBar` as
  nullable fields. Both are created/destroyed in the plugin lifecycle.
- **Callback-based wiring**. The tracker takes a plain callback function, not an
  event emitter or observable. `main.ts` passes a closure that bridges tracker
  output to the status bar.
- **No commands**. The plugin registers zero commands. It is purely passive:
  awareness events drive the status bar, and a CSS class toggle drives cursor labels.

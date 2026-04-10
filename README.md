# YAOS Extension

An [Obsidian](https://obsidian.md) plugin that extends [YAOS](https://github.com/nergal-perm/obsidian-yaos) (Yet Another Obsidian Sync) with collaborative presence features — without forking YAOS.

## Features

### Collaborator names on cursors

YAOS uses [y-codemirror.next](https://github.com/yjs/y-codemirror.next) which renders name labels (`.cm-ySelectionInfo`) next to each remote cursor, but YAOS hides them with CSS. This plugin overrides that to show the collaborator's device name when you hover over their cursor caret.

- Names appear on hover to avoid the "looks like inserted text" problem
- Name label inherits the peer's awareness color
- Togglable via **Settings > YAOS Extension > Show collaborator names on cursors**

### Presence indicator (who's online)

A status bar item shows the current sync state and connected collaborators:

- Green dot when sync is connected, dimmed dot when disconnected
- Peer count: "You + Alice" or "You + 3 collaborators"
- Colored dots for each peer (using their awareness color)
- Hover over a dot to see the collaborator's device name
- Falls back to "Not synced" when YAOS is unavailable
- Togglable via **Settings > YAOS Extension > Show presence in status bar**

## Installation

### With BRAT (recommended)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from Community plugins
2. Open **Settings > BRAT > Add Beta plugin**
3. Enter `hambergerpls/yaos-extension`
4. Select **Add Plugin**
5. Enable "YAOS Extension" in **Settings > Community plugins**

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](https://github.com/hambergerpls/yaos-extension/releases)
2. Create a folder `<vault>/.obsidian/plugins/yaos-extension/`
3. Copy the three files into that folder
4. Reload Obsidian and enable "YAOS Extension" in **Settings > Community plugins**

## Requirements

- [YAOS](https://github.com/nergal-perm/obsidian-yaos) plugin installed and enabled
- Obsidian 1.5.0 or later

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Show collaborator names on cursors | On | Display device names on hover over remote cursors |
| Show presence in status bar | On | Show connected collaborators in the status bar |
| Show peer color dots in status bar | On | Show colored dots for each peer in the status bar |

## TODO

### Features
- [ ] Mention other devices (like Notion @-mentions)
- [ ] Add comments as a device (like Notion comments)
- [ ] Threaded comment discussions (like Notion)
- [ ] Notification history — check past notifications


## How it works

The plugin accesses YAOS internals at runtime via `app.plugins.getPlugin("yaos")` to reach the Yjs [Awareness](https://docs.yjs.dev/api/about-awareness) instance. It subscribes to awareness `change` events to track peer joins, leaves, and updates.

Since YAOS has no public API, this relies on traversing private fields (`vaultSync > provider > awareness`). If YAOS updates break this access path, the plugin degrades gracefully to showing "Not synced" rather than crashing.

```
main.ts ──> presenceTracker.ts ──> yaosApi.ts ──> YAOS plugin (runtime)
   │                │
   ▼                ▼
statusBar.ts    styles.css (CSS class override)
```

## Development

```bash
npm install
npm run dev     # watch mode
npm run build   # production build
npm test        # run tests (48 tests)
```

## License

[0-BSD](LICENSE)

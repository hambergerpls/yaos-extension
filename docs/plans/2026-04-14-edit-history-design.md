# Edit History by Device — Design Document

**Date**: 2026-04-14
**Status**: Draft

## Overview

A Notion-style edit history sidebar panel that shows a timeline of file edits with device attribution, diff summaries, and version restore capability. Built as part of the `yaos-extension` Obsidian community plugin.

## Context

- YAOS provides real-time CRDT sync (Yjs) across devices with a stable file ID system
- `FileMeta.device` already tracks which device last modified each file
- The existing `yaos-extension` plugin accesses YAOS internals via `(app as any).plugins.getPlugin("yaos").vaultSync`
- YAOS syncs all vault files including `.yaos-extension/` directory contents

## Data Model

**Storage**: `.yaos-extension/edit-history.json` (synced via YAOS vault sync)

```json
{
  "version": 1,
  "entries": {
    "<yaos-file-id>": {
      "path": "notes/project-plan.md",
      "baseIndex": 0,
      "versions": [
        {
          "ts": 1713123500000,
          "device": "Alice-Laptop",
          "content": "# Full content of first snapshot..."
        },
        {
          "ts": 1713123800000,
          "device": "Bob-Phone",
          "diff": [[1, "added text\n"], [-3, ""]]
        }
      ]
    }
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | number | Schema version (currently 1) |
| `entries` | object | Map of YAOS file ID → history entry |
| `entry.path` | string | Current file path (updated on rename) |
| `entry.baseIndex` | number | Index of last full-content base version |
| `version.ts` | number | Unix timestamp (ms) |
| `version.device` | string | Device name from YAOS settings |
| `version.content` | string? | Full content (base versions only) |
| `version.diff` | array? | fast-diff ops `[[op, text], ...]` (delta versions) |

### Design decisions

- **Keyed by YAOS file ID**: Stable across renames. Path stored for display only.
- **Delta chain**: Base version stores full content. Subsequent versions store `fast-diff` deltas against previous version.
- **Periodic re-basing**: Every 10 versions, insert a new full-content base to bound reconstruction cost.
- **Cleanup**: Prune versions older than configurable retention (default: 30 days). Also prune entries for deleted files.
- **Diff format**: `fast-diff` (Myers diff) — op `-1` = delete, `1` = insert, `0` = equal.

## Snapshot Capture

### Trigger

Subscribe to `ydoc.on("afterTransaction")` via YAOS internals.

### Access chain (new additions to `yaosApi.ts`)

```
app.plugins.getPlugin("yaos")
  -> plugin.vaultSync.ydoc              // Y.Doc for transaction observation
  -> plugin.vaultSync.provider          // to distinguish local vs remote origin
  -> plugin.vaultSync.idToText          // Y.Map<Y.Text> to detect file changes
  -> plugin.vaultSync.meta              // Y.Map<FileMeta> for path/device lookup
  -> plugin.vaultSync.getFileId(path)   // stable ID for current path
```

### Capture flow

1. Subscribe to `ydoc.on("afterTransaction", handler)`
2. For each transaction, check changed keys on `idToText` map via `Y.YMapEvent.keys`
3. For each changed file ID, read current content from `idToText.get(fileId).toJSON()`
4. **Debounce**: Wait 30 seconds of inactivity per file before capturing (reset timer on each edit)
5. On capture: reconstruct last snapshot content, compute fast-diff, append delta entry
6. Read device name from `getLocalDeviceName(app)` (existing yaosApi function)
7. Write updated `edit-history.json`

### Throttling

- Minimum interval between snapshots for the same file: configurable (default: 30s idle or 2 min max)
- Maximum snapshots per file per day: configurable (default: 50)
- Skip if content hash matches previous snapshot (no-op edit)

### File rename handling

Subscribe to `vaultSync.meta` observe events. When a file ID's `path` field changes, update `entry.path` in the history store.

## Sidebar UI

### View registration

New `ItemView` with view type `"yaos-extension-edit-history"`, icon `"history"`, display name `"Edit History"`.

### Layout

```
┌──────────────────────────────────────┐
│ 🕐 Edit History                      │
│ ──────────────────────────────────── │
│ 📄 notes/project-plan.md            │ ← Current file path
│ ──────────────────────────────────── │
│                                      │
│  Today                               │ ← Date group header
│  ┌──────────────────────────────┐   │
│  │ 🔵 Alice-Laptop  2:35 PM    │   │ ← Version entry
│  │   +12 -3 lines               │   │ ← Diff summary
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │ 🟢 Bob-Phone     1:22 PM    │   │
│  │   +5 lines                   │   │
│  └──────────────────────────────┘   │
│                                      │
│  Yesterday                           │
│  ┌──────────────────────────────┐   │
│  │ 🔵 Alice-Laptop  4:10 PM    │   │
│  │   +45 -12 lines              │   │
│  └──────────────────────────────┘   │
│                                      │
│  ────────────────────────────────────│
│  [View version] [Restore]           │ ← Action buttons
└──────────────────────────────────────┘
```

### Interactions

- **Follows active editor**: Automatically switches to show history for the current file
- **Click version**: Expand to show diff view (unified diff with additions in green, deletions in red)
- **"Restore this version"**: Replaces current file content with selected version's content
- **Device avatars**: Colored circles with initials, reusing existing `KnownDevice` colors from awareness

### Diff view

When a version is selected, show the reconstructed content alongside the current content with highlighted changes. Reconstruction applies the delta chain from `baseIndex` through the selected version.

## Module Architecture

### New files

```
src/
  editHistory/
    types.ts                 // EditHistoryEntry, VersionSnapshot, EditHistoryData
    editHistoryStore.ts      // Read/write .yaos-extension/edit-history.json
    editHistoryCapture.ts    // CRDT transaction observer + debounced capture
    editHistoryView.ts       // ItemView sidebar panel + diff rendering
    editHistoryDiff.ts       // Delta chain reconstruction + diff computation
```

### Dependency graph

| Module | Imports from |
|--------|-------------|
| `types` | nothing |
| `editHistoryDiff` | `fast-diff`, `./types` |
| `editHistoryStore` | obsidian (`Vault`), `../logger`, `./types` |
| `editHistoryCapture` | `../yaosApi`, `./editHistoryStore`, `./editHistoryDiff`, `./types` |
| `editHistoryView` | `./editHistoryStore`, `./editHistoryDiff`, `../yaosApi` (types), obsidian, `./types` |

### Wiring in main.ts

- `onload()`: Create `EditHistoryStore` and `EditHistoryCapture`
- Register `editHistoryView` as sidebar ItemView
- Register command: "Open edit history"
- Watch `active-leaf-change` to update sidebar when switching files
- `onunload()`: Stop capture observer, clean up

### YAOS API extensions (in `yaosApi.ts`)

| Function | Returns | Purpose |
|----------|---------|---------|
| `getYDoc(app)` | `Y.Doc \| null` | Access to the CRDT document |
| `getVaultSync(app)` | `VaultSyncLike \| null` | Access to vault sync internals |
| `getFileId(app, path)` | `string \| undefined` | Get stable file ID for path |
| `getFilePath(app, fileId)` | `string \| undefined` | Get current path for file ID |

### New dependency

Add `fast-diff` to `package.json`. Already a transitive dependency via YAOS.

## Settings

New fields added to `YaosExtensionSettings`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `showEditHistory` | boolean | `true` | Enable/disable the edit history feature |
| `editHistoryRetentionDays` | number | `30` | Days to keep snapshots |
| `editHistoryMaxPerFilePerDay` | number | `50` | Max snapshots per file per day |
| `editHistoryDebounceMs` | number | `30000` | Idle time before capturing (ms) |
| `editHistoryRebaseInterval` | number | `10` | Versions between full-content bases |

## Error handling

- **YAOS not available**: Disable capture, show "Not synced" message in sidebar
- **IndexedDB not available**: Not relevant (history is file-based)
- **File too large for history**: Skip capture if file exceeds 1MB (configurable)
- **Corrupt delta chain**: Fall back to creating a new base snapshot
- **Concurrent writes**: Use read-modify-write with error recovery. Entries are append-only to minimize conflict.

## Limitations

- **Device attribution is best-effort**: Uses the device name from YAOS settings. If a user changes their device name, old entries retain the old name.
- **No offline merge conflict resolution**: If two devices write to `edit-history.json` simultaneously, YAOS's CRDT handles the file-level merge but may create conflicts in the JSON content. Mitigation: write entries as append-only (new entries at end of array).
- **Memory**: The delta chain JSON file could grow large for frequently edited files. The rebase interval and retention period bound this.
- **No binary file history**: Only markdown files are tracked.

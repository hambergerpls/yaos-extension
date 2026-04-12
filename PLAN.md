# Full Obsidian Editor Integration Plan

## Goal

Replace the bare CM6 editor in the comment sidebar with Obsidian's internal
full markdown editor (source mode), and replace plain-text comment display
with rendered markdown via `MarkdownRenderer.render`.

## Architecture

### Prototype chain (from runtime dump)

```
editMode (j6)  →  aZ  →  oZ  →  Component
         ↑           ↑         ↑
     Level 0    Level 1    Level 2
```

- `oZ(app, containerEl, owner)` — creates CM6 EditorView, bare editor
- `aZ(app, containerEl, owner)` — adds sizer, scroll, HyperMD markdown language
- `j6(markdownView)` — adds save/fold/properties (we skip this layer)

### Constructor signatures (confirmed via runtime dump)

```js
// oZ (Level 2) — base editor component
function t(t, n, i)  // (app, containerEl, owner)
// Sets: this.app, this.owner, this.containerEl
// Creates: this.editorEl, this.cm (EditorView), this.editor (iZ wrapper)

// aZ (Level 1) — scroll-aware editor with markdown
function t(t, n, i)  // (app, containerEl, owner)
// Calls super(app, containerEl, owner)
// Creates: this.sizerEl, restructures DOM (contentDOM into cm-contentContainer)

// j6 (Level 0) — MarkdownView's editMode
function t(t)  // (markdownView)
// Calls super(t.app, t.contentEl, t)
// Sets: this.view, this.type = "source"
```

### Owner interface (what the editor accesses)

The owner is the MarkdownView. Key properties/methods accessed:

- `app` — App instance (for vault.getConfig, workspace)
- `file` — TFile (null is acceptable — disables link resolution)
- `getFile()` — returns TFile | null
- `getMode()` — returns "source" | "preview"
- `path` — string (used for link resolution)
- `onInternalDataChange()` — callback (j6 only, not aZ)
- `onMarkdownFold()` — callback (j6 only, not aZ)
- Focus handler: `app.workspace.activeEditor = owner`
- Save-related: handled at j6 level, not aZ/oZ

### Level 0 methods (j6 — MarkdownView's editMode)
show, set, clear, destroy, getSelection, beforeUnload, getEphemeralState,
setState, handleScroll, setHighlight, highlightSearchMatches, getFoldInfo,
getDynamicExtensions, onUpdate, onResize, updateBottomPadding,
updateReadableLineLength, onConfigChanged

### Level 1 methods (aZ — scroll-aware editor)
onScroll, handleScroll, show, hide, focus, getScroll, applyScroll, showSearch,
buildLocalExtensions, onConfigChanged, getDynamicExtensions, setCssClass,
onCssChange, onViewClick, onUpdate

### Level 2 methods (oZ — base editor component)
onload, file, path, get, set, saveHistory, reinit, reparent, clear, destroy,
updateEvent, buildLocalExtensions, tryPasteUrl, getLocalExtensions,
getDynamicExtensions, onConfigChanged, updateOptions, resetSyntaxHighlighting,
getFoldInfo, applyFoldInfo, toggleFoldFrontmatter, getClickableTokenHref,
triggerClickableToken, updateLinkPopup, toggleSource, onUpdate, onEditorClick,
onEditorLinkMouseover, onEditorDragStart, onContextMenu, onMenu, onResize,
activeCM, editTableCell, destroyTableCell

## Implementation Phases

### Phase 1: Editor Discovery Module

File: `src/comments/editorDiscovery.ts`

- Wait for a `MarkdownView` to appear (may not exist at plugin load)
- Walk `editMode` prototype chain to find `aZ` constructor
- Feature detection: verify prototype has `buildLocalExtensions`,
  `getDynamicExtensions`, `show`, `hide`, `focus`
- Cache as singleton
- Export `getEditorComponentClass(app): Constructor | null`
- If no MarkdownView open, register one-shot `workspace.on("layout-change")`
  listener to retry

### Phase 2: Mock Owner Adapter

File: `src/comments/commentEditorOwner.ts`

Create a Proxy-based mock that satisfies `aZ`/`oZ`'s owner interface:

```typescript
function createMockOwner(app: App, file?: TFile | null): object
```

- Returns real `app` reference
- `file` = null (disables link resolution)
- `getFile()` → null
- `getMode()` → "source"
- `path` → ""
- Proxy `get` trap: returns safe defaults for unexpected property access
- Override focus handler: do NOT set `app.workspace.activeEditor`
- Log unexpected access in dev mode

### Phase 3: Replace Embedded Editor

Modify: `src/comments/embeddedEditor.ts`

New function `createObsidianEditor(app, parent, options)` alongside existing
`createEmbeddedEditor`:

1. Call `getEditorComponentClass(app)` to get `aZ` constructor
2. If found:
   - Create container div inside `parent`
   - Instantiate `aZ(app, container, mockOwner)`
   - Call `component.load()` (Component lifecycle)
   - Call `component.set("", true)` to initialize empty
   - Source mode (`sourceMode = true`) — skip live preview
   - Wire Enter-to-submit via `component.cm`
   - Inject @mention extension
   - Return `EmbeddedEditorHandle`:
     - `getText()` → `component.cm.state.doc.toString()`
     - `setText(t)` → `component.set(t, true)`
     - `clear()` → `component.clear()`
     - `focus()` → `component.focus()`
     - `destroy()` → `component.unload()`
3. If not found: fall back to current bare CM6 `createEmbeddedEditor()`

Update `commentView.ts`: Change `renderInput()` and `renderReplies()` to call
`createObsidianEditor` when available.

### Phase 4: Markdown Rendering for Comment Display

Modify: `src/comments/commentView.ts`

Replace `renderMentionsInto(container, text)` with
`renderCommentBody(container, text)`:

```typescript
async renderCommentBody(container: HTMLElement, text: string): Promise<void> {
  const component = new Component();
  this.addChild(component);
  await MarkdownRenderer.render(
    this.app,
    text,
    container,
    "",
    component
  );
}
```

This gives us:
- Rendered markdown (bold, italic, links, code blocks, callouts)
- @mentions preserved as bold text or styled via CSS
- Proper Component lifecycle management

### Phase 5: CSS Adjustments

Modify: `src/styles.css`

The `aZ` constructor creates:

```
containerEl
  └── editorEl.markdown-source-view.cm-s-obsidian.mod-cm6
        └── cm.scrollDOM
              └── sizerEl.cm-sizer
                    └── contentContainer.cm-contentContainer
                          ├── gutters
                          └── contentDOM
```

CSS rules needed:
- Constrain height (max-height with overflow, ~120px for input, expandable)
- Hide irrelevant elements (line numbers, fold gutters)
- Remove full-page padding/margins
- Scope under `.yaos-extension-comment-input .markdown-source-view`
- Style rendered markdown comment bodies under `.yaos-extension-comment-body`

### Phase 6: Cleanup & Verification

- Remove `dump-editor-internals` debug command from `main.ts`
- Test: markdown formatting in input, Ctrl+B/I/K hotkeys
- Test: rendered markdown in existing comments
- Test: @mention autocomplete still works
- Test: fallback to bare CM6 when no MarkdownView available
- Test: plugin reload doesn't leak DOM/listeners
- Run existing tests to verify no regressions

## Risks & Mitigations

| Risk | Mitigation |
|------|-------------|
| `aZ` constructor accesses unexpected owner properties | Proxy mock returns safe defaults; log warnings in dev |
| Focus handler sets `activeEditor` to mock | Override DOM focus handler in local extensions |
| Obsidian update changes prototype chain depth | Feature detection (check for `buildLocalExtensions`), not position-based |
| Live preview extensions error without real file | Start in source mode (`sourceMode = true`), skip live preview |
| `getDynamicExtensions` reads vault config | This is fine — reads from real `app.vault` |
| Performance: full editor heavier than bare CM6 | Lazy creation; limit concurrent editors; reuse when possible |

## Mode Decision

**Source mode only** (no live preview) for initial implementation.
- Syntax highlighting ✓
- Formatting hotkeys ✓
- @mentions ✓
- Link/tag autocomplete ✓
- Live preview — deferred to future work
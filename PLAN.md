# Plan: Re-add Comment Sidebar with Shared Renderer

## Goal

Re-add the comment sidebar panel (Obsidian `ItemView`) alongside the existing inline editor panel. Both views share Notion-style rendering via an extracted `CommentRenderer` class. A "Toggle comment sidebar" command opens/closes the sidebar.

## Design decisions

| Aspect | Decision |
|--------|----------|
| Sidebar vs inline | Both exist together — sidebar is an Obsidian right-panel ItemView, inline panel stays in-editor |
| Layout style | Notion-style (avatars, thread lines, hover toolbars, smart collapse) — shared via `CommentRenderer` |
| Add comment command | Keep current behavior (TODO: future floating anchored UI) |
| Toggle command | Yes — "Toggle comment sidebar" command added |
| Code sharing | Shared `CommentRenderer` class used by both views |

## Architecture

```
CommentRenderer  (shared rendering + state logic)
  ^         ^
  |         |
InlineCommentPanel    CommentView (ItemView)
(in-editor panel)     (right sidebar)
```

### CommentRenderer — shared rendering logic

Extracted from `InlineCommentPanel`. Owns all rendering state and DOM construction.

Public API:
```typescript
class CommentRenderer {
  constructor(store, app, callbacks)
  async refresh(container: HTMLElement, filePath: string): Promise<void>
  setPendingSelection(selection): void
  getThreadCount(): number
  destroy(): void
}
```

Contains:
- All rendering methods: `renderThreads()`, `renderThreadCard()`, `renderCommentItem()`, `renderReplyItems()`, `renderReplyInput()`, `renderInput()`, `renderCommentBody()`, `renderMentionsIntoFallback()`
- All state: `threads`, `collapsedReplies`, `editingCommentId`/`editingReplyId`, `editors`/`replyEditors`, `renderComponents`, `renderGeneration`, `draftText`, `pendingSelection`, `currentFilePath`
- Editor lifecycle: `destroyEditors()`, `destroyReplyEditors()`, `destroyRenderComponents()`
- Helper: `formatRelativeTime()`

### InlineCommentPanel — in-editor panel (refactored)

Shrinks to ~60-80 lines. Keeps:
- `attach(scroller)` / `detach()` — DOM injection lifecycle
- `expanded` state + header toggle
- Owns `panelEl`, `contentEl`, `scrollerEl`
- Delegates to `renderer.refresh(contentEl, filePath)` when expanded
- Calls `renderer.destroy()` on detach

### CommentView — sidebar ItemView (new)

```typescript
export const COMMENTS_VIEW_TYPE = "yaos-extension-comments";

export class CommentView extends ItemView {
  private renderer: CommentRenderer;

  getViewType()        → "yaos-extension-comments"
  getDisplayText()     → "Comments"
  getIcon()            → "message-square"

  onOpen()             → register link click handler, initial render
  onClose()            → renderer.destroy()
  refresh(filePath)    → renderer.refresh(contentEl, filePath)
  setPendingSelection(s) → renderer.setPendingSelection(s)
  getThreads()         → renderer.getThreads()
}
```

## HTML structure (shared by both views)

```
[container]                                    ← contentEl (sidebar) or .yaos-extension-inline-comment-content (inline)
  .yaos-extension-comment-input                ← top-level comment input (CM6 editor)
  .yaos-extension-comment-thread               ← each thread
    .yaos-extension-thread-wrapper
      .yaos-extension-comment-item             ← original comment
        .yaos-extension-comment-item-row       ← avatar + name + timestamp
        .yaos-extension-thread-line
        .yaos-extension-comment-item-body
          .yaos-extension-comment-quote
          .yaos-extension-comment-body
        .yaos-extension-comment-actions        ← hover toolbar
      .yaos-extension-show-replies             ← "Show N replies" (only if > 3)
      .yaos-extension-comment-replies          ← reply items
      .yaos-extension-reply-input              ← always-visible reply editor
  .yaos-extension-comment-resolved-divider
  [resolved threads, same structure]
```

Inline panel wraps this in:
```
.yaos-extension-inline-comment-panel
  .yaos-extension-inline-comment-header        ← collapsible header
  .yaos-extension-inline-comment-content       ← collapse wrapper
    [shared structure above]
```

Sidebar wraps it in:
```
.yaos-extension-comment-view                   ← sidebar padding
  [shared structure above]
```

## Implementation tasks

### 1. Extract `CommentRenderer` from `InlineCommentPanel`

**New file**: `src/comments/commentRenderer.ts`

Move all rendering logic out of `InlineCommentPanel`:
- `renderThreads()`, `renderThreadCard()`, `renderCommentItem()`, `renderReplyItems()`, `renderReplyInput()`, `renderInput()`, `renderCommentBody()`, `renderMentionsIntoFallback()`, `formatRelativeTime()`
- All state: `threads`, `collapsedReplies`, `editingCommentId`/`editingReplyId`, `editors`/`replyEditors`, `renderComponents`, `renderGeneration`, `draftText`, `pendingSelection`, `currentFilePath`
- Editor lifecycle management (`destroyEditors()`, `destroyReplyEditors()`, etc.)

### 2. Create `CommentRenderer` tests

**New file**: `src/comments/commentRenderer.test.ts`

All rendering tests move here from `inlineCommentPanel.test.ts`:
- Avatar rendering (initials, color)
- Comment item row (author, timestamp, edited indicator)
- Thread line
- Comment body and quote
- Hover action toolbar (resolve, edit, delete, ownership checks)
- Show replies button (collapse/expand, >3 threshold)
- Reply input (always visible, outside collapsible container)
- Resolved threads (class, reopen button, divider)
- CM6 editor integration
- Draft preservation (same file vs different file)
- Pending selection

### 3. Refactor `InlineCommentPanel` to delegate to `CommentRenderer`

Shrink `InlineCommentPanel` to ~60-80 lines. Keeps:
- `attach(scroller)` / `detach()` — DOM injection lifecycle
- `expanded` state + header toggle
- Owns `panelEl`, `contentEl`, `scrollerEl`
- Calls `renderer.refresh(contentEl, filePath)` when expanded
- Calls `renderer.destroy()` on detach

**Update** `inlineCommentPanel.test.ts` to only test inline-specific behavior: attach/detach, collapsible header, delegation.

### 4. Create `CommentView` sidebar

**New file**: `src/comments/commentView.ts`

- Extends `ItemView` with view type `"yaos-extension-comments"`
- Internal `CommentRenderer` instance
- `onOpen()` registers internal link click handler, initial render
- `onClose()` destroys renderer
- `refresh(filePath)` delegates to renderer
- `setPendingSelection()` delegates to renderer
- `getThreads()` returns current threads

**New file**: `src/comments/commentView.test.ts` — tests for:
- ItemView lifecycle (open/close)
- refresh renders threads into contentEl
- Internal link click handler
- setPendingSelection delegation
- getThreads returns loaded threads
- Editor cleanup on close

### 5. Wire sidebar in `main.ts`

Changes:
- Import `CommentView`, `COMMENTS_VIEW_TYPE`
- Add `registerView(COMMENTS_VIEW_TYPE, leaf => new CommentView(...))`
- Add command: `{ id: "toggle-comment-sidebar", name: "Toggle comment sidebar" }` — opens/reveals or closes the sidebar
- Update `refreshCommentView()` to refresh **both** inline panel and sidebar
- Update `openFileAndComment()` to open sidebar when navigating from a notification
- Update `onunload()` cleanup (sidebar views are cleaned up by Obsidian, but keep inline panel detach)
- Update settings description text

### 6. CSS updates

Add sidebar container style (Notion-style classes are already shared):
```css
.yaos-extension-comment-view {
  padding: 12px;
  font-size: var(--font-ui-small, 13px);
}
```

### 7. Update docs

Update `AGENTS.md` to reflect the three-module comment architecture.

## File change summary

| File | Action |
|------|--------|
| `src/comments/commentRenderer.ts` | **New** — shared rendering logic extracted from InlineCommentPanel |
| `src/comments/commentRenderer.test.ts` | **New** — all rendering tests (~40 tests) |
| `src/comments/commentView.ts` | **New** — sidebar ItemView using CommentRenderer |
| `src/comments/commentView.test.ts` | **New** — sidebar-specific tests |
| `src/comments/inlineCommentPanel.ts` | **Refactor** — shrink to ~60-80 lines, delegate to CommentRenderer |
| `src/comments/inlineCommentPanel.test.ts` | **Refactor** — keep only attach/detach/header tests |
| `src/main.ts` | **Update** — add sidebar registration, toggle command, dual refresh |
| `src/styles.css` | **Update** — add `.yaos-extension-comment-view` |
| `src/AGENTS.md` | **Update** — architecture docs |
| `PLAN.md` | **Update** — this plan |

## Execution order

1. Write `CommentRenderer` + tests (TDD) — extract from InlineCommentPanel
2. Refactor `InlineCommentPanel` to use it + update inline tests
3. Create `CommentView` + tests (TDD)
4. Wire in `main.ts`
5. CSS updates
6. Verify: `npx vitest run` + `npm run build`
7. Update `AGENTS.md`

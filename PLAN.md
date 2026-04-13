# Plan: Restructure Comment HTML to Follow Notion's Layout

## Summary of design decisions

| Aspect | Decision |
|--------|----------|
| Avatars | 24px circles with author color bg + first initial |
| Thread line | Yes — 1.5px vertical gray line connecting comments |
| Action buttons | Hover-only toolbar with icon buttons (resolve checkmark, edit pencil, delete trash) |
| Reply collapse | "Show N replies" button between original comment and replies |
| Header | Always visible "Comments" header, content collapses |
| Quote | Show selected text above comment body |
| Actions layout | All as separate icon buttons in hover toolbar (no dropdown) |
| Reply input | Keep CM6 embedded editor |

## New HTML structure

```
.yaos-extension-inline-comment-panel
  .yaos-extension-inline-comment-header      ← always visible "Comments" row
  .yaos-extension-inline-comment-content     ← collapsible
    .yaos-extension-comment-input            ← top-level comment input (CM6 editor)
    .yaos-extension-comment-thread           ← each thread
      .yaos-extension-thread-wrapper         ← border-radius: 8px container
        .yaos-extension-comment-item         ← original comment
          .yaos-extension-comment-item-row   ← avatar + name + timestamp
            .yaos-extension-avatar           ← 24px circle with initial
            .yaos-extension-author-name
            .yaos-extension-timestamp
            .yaos-extension-edited-indicator (if edited)
          .yaos-extension-thread-line        ← 1.5px vertical line (absolute)
          .yaos-extension-comment-item-body  ← padded-left past avatar
            .yaos-extension-comment-quote    ← selected text
            .yaos-extension-comment-body     ← rendered markdown
          .yaos-extension-comment-actions    ← hover toolbar (absolute, top-right)
            resolve-btn (checkmark icon)
            edit-btn (pencil icon)           ← only if own comment
            delete-btn (trash icon)          ← only if own comment
        .yaos-extension-show-replies         ← "Show N replies" button
        .yaos-extension-comment-replies      ← expanded replies
          .yaos-extension-comment-item       ← each reply (same structure)
            .yaos-extension-comment-item-row
            .yaos-extension-comment-item-body
            .yaos-extension-comment-actions
          .yaos-extension-reply-input        ← CM6 editor at bottom
    .yaos-extension-comment-resolved-divider
    [resolved threads, same structure]
```

## Implementation tasks

### 1. Update `inlineCommentPanel.ts` — DOM structure changes

**`render()`** — Keep always-visible header, collapsible content. Header click still toggles content. No structural change needed.

**`renderThreadCard()`** — Complete rewrite:
- Create `.yaos-extension-thread-wrapper` with `border-radius: 8px`
- Create `.yaos-extension-comment-item` for original comment:
  - Row with 24px avatar circle (bg = authorColor, text = first initial), author name, timestamp
  - Thread line (absolute positioned 1.5px line)
  - Body area padded left past avatar
  - Quote block above body
  - Hover toolbar with icon buttons (resolve, edit, delete)
- No longer wrap everything in a clickable header — replies expand via "Show N replies" button

**`renderReplies()`** — Render each reply as `.yaos-extension-comment-item` with same structure (avatar, name, timestamp, body, hover actions). Thread line continues through replies.

**Add `renderShowRepliesButton()`** — New method that renders "Show N replies" between original comment and expanded replies. Clicking it toggles reply visibility.

**Add `createAvatar(author, color)`** — Helper to create a 24px circle div with author's first initial.

**Add `createActionBar(actions)`** — Helper to create the hover toolbar with icon buttons.

**Avatar helper**: Create a 24px div with `border-radius: 50%`, `background-color: authorColor`, centered white text with first character of author name.

**Action icons**: Use simple SVG icons inline (checkmark for resolve, pencil for edit, trash for delete). No external icon dependency.

### 2. Update `styles.css` — New class styles

**Replace** all existing `.yaos-extension-comment-*` styles with new Notion-inspired styles:

- `.yaos-extension-inline-comment-panel` — keep padding
- `.yaos-extension-inline-comment-header` — keep but remove border-bottom, add subtle bottom separator
- `.yaos-extension-inline-comment-content` — keep collapse animation
- `.yaos-extension-comment-thread` — remove border/card style, use spacing only
- `.yaos-extension-thread-wrapper` — `border-radius: 8px`, hover bg change, transition
- `.yaos-extension-comment-item` — `position: relative`, padding
- `.yaos-extension-comment-item-row` — `display: flex`, `align-items: center`, `gap: 6px`
- `.yaos-extension-avatar` — `24px × 24px`, `border-radius: 50%`, centered initial, `font-size: 12px`, `color: white`
- `.yaos-extension-thread-line` — `position: absolute`, `width: 1.5px`, `background: var(--background-modifier-border)`, full height
- `.yaos-extension-comment-item-body` — `padding-left: 32px` (past avatar)
- `.yaos-extension-comment-actions` — `position: absolute`, `top: -4px`, `right: 0`, `opacity: 0`, `transition: opacity 150ms`, `background: var(--background-primary)`, `box-shadow`, `border-radius: 6px`, flex row
- `.yaos-extension-comment-item:hover .yaos-extension-comment-actions` — `opacity: 1`
- `.yaos-extension-show-replies` — styled as clickable text button, left-padded past avatar
- Update `.yaos-extension-comment-quote` — subtle styling above body
- Remove old button styles (`.yaos-extension-resolve-btn`, `.yaos-extension-delete-btn`, `.yaos-extension-edit-btn`) — replace with icon button styles
- New icon button styles: small square buttons with SVG icons, hover bg

### 3. Update tests — `inlineCommentPanel.test.ts`

Tests that need updating (CSS class / DOM structure changes):
- "delete comment button" — now a hover toolbar icon, test for `.yaos-extension-delete-btn` still but structure changes
- "delete reply button" — same
- "resolve button" — same
- "edit comment button" — same
- "CM6 editor integration" — structure changes but still tests for `.cm-editor`
- "edited indicator" — class stays the same, position in DOM changes

The core behavior doesn't change — same callbacks, same conditions. Only the DOM queries and structure change. All existing tests should be updated to match new CSS class names and DOM nesting.

### 4. Update `AGENTS.md` — Architecture docs

Update the module description for `inlineCommentPanel.ts` to reflect Notion-style layout (avatars, thread lines, hover toolbars, "Show N replies").

## File change summary

| File | Changes |
|------|---------|
| `src/comments/inlineCommentPanel.ts` | Major rewrite of `renderThreadCard`, `renderReplies`, add `createAvatar`, `createActionBar`, `renderShowRepliesButton`, update `renderInput` to include avatar |
| `src/styles.css` | Replace all comment panel CSS with new Notion-style classes |
| `src/comments/inlineCommentPanel.test.ts` | Update DOM queries to match new structure |
| `src/AGENTS.md` | Update inlineCommentPanel description |

## Execution order

1. Write new CSS styles first (so they exist when tests run)
2. Rewrite `renderThreadCard` / `renderReplies` / add helpers in `inlineCommentPanel.ts`
3. Update tests to match new DOM structure
4. Run `npx vitest run` + `npm run build` to verify
5. Update `AGENTS.md`

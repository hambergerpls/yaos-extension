# Frontmatter Comment Storage Implementation Plan

**Goal:** Move comment storage from `.yaos-extension/comments/` JSONL files to YAML frontmatter in each document, using timestamps as map keys and preserving insertion order for display.

**Architecture:** `CommentStore` is rewritten to read/write a `yaos-comments` map in the document's YAML frontmatter instead of appending to JSONL files. Comment IDs change from UUIDs to `Date.now()` timestamps. The append-only event log (delete/resolve/edit entries) is replaced with direct state mutation: delete removes the key, resolve flips the boolean, edit overwrites the text. No audit trail. `rangeOffset` is kept but display relies on `rangeText`/`rangeContext` fuzzy matching (already implemented in `commentDecorations.ts`). Notifications stay in `.yaos-extension/notifications.jsonl`.

**Tech Stack:** Obsidian API (`app.fileManager.processFrontMatter`, `app.metadataCache`, `app.vault`), TypeScript, Vitest.

---

## Key Design Decisions

| Aspect | Decision |
|--------|----------|
| ID format | `String(Date.now())` as YAML map key |
| Sorting | By insertion order in YAML map (not by key value) |
| Delete | Hard delete — remove key from map |
| Edit | Overwrite `text`, `mentions`, set `editedAt` directly |
| Resolve | Flip `resolved` boolean directly |
| Audit trail | None — current state only |
| Notifications | Stay in `.yaos-extension/notifications.jsonl` |
| rangeOffset | Kept for fallback, but display uses fuzzy text matching |
| Migration | None — old JSONL data is abandoned |
| Nested replies | Replies stored as a `replies` sub-map on each comment |

## Frontmatter Format

```yaml
---
yaos-comments:
  "1713123456000":
    text: "This needs a cite"
    author: Alice
    authorColor: "#f00"
    createdAt: 1713123456000
    rangeText: "selected text"
    rangeContext: "some context before selected text and after"
    rangeOffset: 20
    rangeLength: 13
    resolved: false
    mentions: []
    replies:
      "1713123500000":
        text: "Agreed"
        author: Bob
        authorColor: "#00f"
        createdAt: 1713123500000
        mentions: []
---
```

YAML map keys are strings. Obsidian's YAML parser preserves insertion order. Replies are a sub-map under each comment's `replies` key.

## Types Change

Remove from `types.ts`: `Deletion`, `ResolveEntry`, `EditEntry`, `CommentEntry` union, and `type` discriminator field from `Comment` and `Reply`.

Keep: `Comment`, `Reply`, `CommentThread`.

---

## File Change Summary

| File | Action |
|------|--------|
| `src/comments/types.ts` | Modify — remove event log types, remove `type` discriminators |
| `src/comments/commentStore.ts` | Rewrite — read/write frontmatter instead of JSONL |
| `src/comments/commentStore.test.ts` | Rewrite — test frontmatter operations |
| `src/main.ts` | Modify — change ID generation, constructor, event listener |
| `src/AGENTS.md` | Update — reflect new storage architecture |

Files that do NOT change: `commentRenderer.ts`, `commentView.ts`, `inlineCommentPanel.ts`, `commentCommands.ts`, `commentDecorations.ts`, `embeddedEditor.ts`, `notifications/*`.

---

## Task 1: Update types

**Files:**
- Modify: `src/comments/types.ts`

**Step 1: Update types.ts**

```typescript
export interface Comment {
  id: string;
  text: string;
  author: string;
  authorColor: string;
  createdAt: number;
  rangeText: string;
  rangeContext: string;
  rangeOffset: number;
  rangeLength: number;
  resolved: boolean;
  mentions: string[];
  editedAt?: number;
}

export interface Reply {
  id: string;
  commentId: string;
  text: string;
  author: string;
  authorColor: string;
  createdAt: number;
  mentions: string[];
  editedAt?: number;
}

export interface CommentThread {
  comment: Comment;
  replies: Reply[];
}
```

**Step 2: Commit**

```bash
git add src/comments/types.ts
git commit -m "refactor: remove event log types from comments"
```

---

## Task 2: Rewrite CommentStore for frontmatter

**Files:**
- Rewrite: `src/comments/commentStore.ts`
- Rewrite: `src/comments/commentStore.test.ts`

### Constructor change

Current: `new CommentStore(vault: Vault)`
New: `new CommentStore(app: App)`

Needs `app` for `app.fileManager.processFrontMatter` and `app.vault.getFileByPath`.

### Public API change

```typescript
class CommentStore {
  constructor(app: App)
  async getThreadsForFile(filePath: string): Promise<CommentThread[]>
  async addComment(filePath: string, comment: Comment): Promise<void>
  async addReply(filePath: string, reply: Reply): Promise<void>
  async deleteEntry(filePath: string, targetId: string): Promise<void>
  async resolveComment(filePath: string, commentId: string, resolved: boolean): Promise<void>
  async editEntry(filePath: string, targetId: string, newText: string): Promise<void>
  static extractMentions(text: string): string[]
}
```

Removed: `filePathToJsonlPath()`, `ensureFolder()`.

### Reading — getThreadsForFile

```typescript
async getThreadsForFile(filePath: string): Promise<CommentThread[]> {
  const file = this.app.vault.getFileByPath(filePath);
  if (!file) return [];

  const cache = this.app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  if (!fm || !fm["yaos-comments"]) return [];

  const commentsMap = fm["yaos-comments"] as Record<string, any>;
  const threads: CommentThread[] = [];

  for (const [id, data] of Object.entries(commentsMap)) {
    const comment: Comment = {
      id,
      text: data.text ?? "",
      author: data.author ?? "",
      authorColor: data.authorColor ?? "#30bced",
      createdAt: data.createdAt ?? 0,
      rangeText: data.rangeText ?? "",
      rangeContext: data.rangeContext ?? "",
      rangeOffset: data.rangeOffset ?? 0,
      rangeLength: data.rangeLength ?? 0,
      resolved: data.resolved ?? false,
      mentions: data.mentions ?? [],
      editedAt: data.editedAt,
    };

    const replies: Reply[] = [];
    const repliesMap = data.replies as Record<string, any> | undefined;
    if (repliesMap) {
      for (const [replyId, replyData] of Object.entries(repliesMap)) {
        replies.push({
          id: replyId,
          commentId: id,
          text: replyData.text ?? "",
          author: replyData.author ?? "",
          authorColor: replyData.authorColor ?? "#30bced",
          createdAt: replyData.createdAt ?? 0,
          mentions: replyData.mentions ?? [],
          editedAt: replyData.editedAt,
        });
      }
    }

    threads.push({ comment, replies });
  }

  return threads;
}
```

### Writing — addComment

```typescript
async addComment(filePath: string, comment: Comment): Promise<void> {
  const file = this.app.vault.getFileByPath(filePath);
  if (!file) return;

  await this.app.fileManager.processFrontMatter(file, (fm) => {
    if (!fm["yaos-comments"]) fm["yaos-comments"] = {};
    fm["yaos-comments"][comment.id] = {
      text: comment.text,
      author: comment.author,
      authorColor: comment.authorColor,
      createdAt: comment.createdAt,
      rangeText: comment.rangeText,
      rangeContext: comment.rangeContext,
      rangeOffset: comment.rangeOffset,
      rangeLength: comment.rangeLength,
      resolved: comment.resolved,
      mentions: comment.mentions,
      replies: {},
    };
  });
}
```

### Writing — addReply

```typescript
async addReply(filePath: string, reply: Reply): Promise<void> {
  const file = this.app.vault.getFileByPath(filePath);
  if (!file) return;

  await this.app.fileManager.processFrontMatter(file, (fm) => {
    const comments = fm["yaos-comments"];
    if (!comments || !comments[reply.commentId]) return;
    if (!comments[reply.commentId].replies) comments[reply.commentId].replies = {};
    comments[reply.commentId].replies[reply.id] = {
      text: reply.text,
      author: reply.author,
      authorColor: reply.authorColor,
      createdAt: reply.createdAt,
      mentions: reply.mentions,
    };
  });
}
```

### Writing — deleteEntry

```typescript
async deleteEntry(filePath: string, targetId: string): Promise<void> {
  const file = this.app.vault.getFileByPath(filePath);
  if (!file) return;

  await this.app.fileManager.processFrontMatter(file, (fm) => {
    const comments = fm["yaos-comments"];
    if (!comments) return;

    if (comments[targetId]) {
      delete comments[targetId];
      return;
    }

    for (const commentData of Object.values(comments) as any[]) {
      if (commentData.replies && commentData.replies[targetId]) {
        delete commentData.replies[targetId];
        return;
      }
    }
  });
}
```

### Writing — resolveComment

```typescript
async resolveComment(filePath: string, commentId: string, resolved: boolean): Promise<void> {
  const file = this.app.vault.getFileByPath(filePath);
  if (!file) return;

  await this.app.fileManager.processFrontMatter(file, (fm) => {
    const comments = fm["yaos-comments"];
    if (!comments || !comments[commentId]) return;
    comments[commentId].resolved = resolved;
  });
}
```

### Writing — editEntry

```typescript
async editEntry(filePath: string, targetId: string, newText: string): Promise<void> {
  const file = this.app.vault.getFileByPath(filePath);
  if (!file) return;

  const mentions = CommentStore.extractMentions(newText);

  await this.app.fileManager.processFrontMatter(file, (fm) => {
    const comments = fm["yaos-comments"];
    if (!comments) return;

    if (comments[targetId]) {
      comments[targetId].text = newText;
      comments[targetId].mentions = mentions;
      comments[targetId].editedAt = Date.now();
      return;
    }

    for (const commentData of Object.values(comments) as any[]) {
      if (commentData.replies && commentData.replies[targetId]) {
        commentData.replies[targetId].text = newText;
        commentData.replies[targetId].mentions = mentions;
        commentData.replies[targetId].editedAt = Date.now();
        return;
      }
    }
  });
}
```

### Testing — mock app

```typescript
function makeApp(frontmatterByPath: Record<string, Record<string, any>> = {}) {
  const fmStore: Record<string, Record<string, any>> = {};

  for (const [path, fm] of Object.entries(frontmatterByPath)) {
    fmStore[path] = JSON.parse(JSON.stringify(fm));
  }

  return {
    vault: {
      getFileByPath: vi.fn((path: string) =>
        path in fmStore ? { path } : null
      ),
    },
    metadataCache: {
      getFileCache: vi.fn((file: any) => {
        const fm = fmStore[file.path];
        return fm ? { frontmatter: JSON.parse(JSON.stringify(fm)) } : null;
      }),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (file: any, fn: (fm: any) => void) => {
        if (!fmStore[file.path]) fmStore[file.path] = {};
        fn(fmStore[file.path]);
      }),
    },
  } as any;
}
```

### Test cases

**getThreadsForFile:**
1. Returns empty array when file doesn't exist
2. Returns empty array when file has no frontmatter
3. Returns empty array when file has no `yaos-comments` key
4. Returns a single comment as a thread with no replies
5. Groups replies under their parent comment
6. Preserves insertion order (does NOT sort by rangeOffset)
7. Returns multiple threads in insertion order

**addComment:**
1. Creates `yaos-comments` map if it doesn't exist
2. Adds a comment entry keyed by timestamp ID
3. Initializes empty `replies` sub-map
4. Works when file has no existing frontmatter (processFrontMatter creates it)

**addReply:**
1. Adds a reply to the correct comment's `replies` map
2. Creates `replies` sub-map if it doesn't exist
3. No-ops if comment doesn't exist

**deleteEntry:**
1. Removes a top-level comment (and its replies)
2. Removes a reply from the correct comment's replies map
3. No-ops if target doesn't exist

**resolveComment:**
1. Sets `resolved: true` on a comment
2. Sets `resolved: false` on a comment (reopen)
3. No-ops if comment doesn't exist

**editEntry:**
1. Updates `text`, `mentions`, and sets `editedAt` on a comment
2. Updates `text`, `mentions`, and sets `editedAt` on a reply
3. Extracts mentions from new text
4. No-ops if target doesn't exist

**extractMentions:** Keep existing tests (unchanged).

### Steps

**Step 1: Write all failing tests**

Rewrite `commentStore.test.ts` with new mock and test cases. Update `makeComment` and `makeReply` helpers to remove `type` field.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/comments/commentStore.test.ts`
Expected: All new tests fail.

**Step 3: Implement CommentStore**

Rewrite `commentStore.ts` with frontmatter implementation. Import `App` from `obsidian` instead of `Vault`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/comments/commentStore.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/comments/commentStore.ts src/comments/commentStore.test.ts
git commit -m "feat: rewrite CommentStore to use document frontmatter"
```

---

## Task 3: Update main.ts

**Files:**
- Modify: `src/main.ts`

### Changes

**3a: ID generation** — `crypto.randomUUID()` → `String(Date.now())` in `handleAddComment` and `handleAddReply`.

**3b: Constructor** — `new CommentStore(this.app.vault)` → `new CommentStore(this.app)`. Remove `await this.commentStore.ensureFolder()`.

**3c: Remove `type` field** — Remove `type: "comment"` and `type: "reply"` from object literals in `handleAddComment` and `handleAddReply`.

**3d: Event listener** — Change vault modify listener from watching `.yaos-extension/comments/` to watching the active file:

```typescript
this.registerEvent(
  this.app.vault.on("modify", (file) => {
    const activePath = this.getActiveFilePath();
    if (activePath && file.path === activePath) {
      this.refreshCommentView();
    }
  }),
);
```

**3e: Simplify method signatures** — Remove `deviceName` parameter from calls to `deleteEntry`, `resolveComment`, `editEntry`.

### Steps

**Step 1: Make all changes to main.ts**

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: update main.ts for frontmatter comment storage"
```

---

## Task 4: Verify no other consumers of removed types

**Step 1: Search for removed type references**

Run: `grep -rn "Deletion\|ResolveEntry\|EditEntry\|CommentEntry" src/`
Expected: No results (all cleaned up).

**Step 2: Search for removed type field**

Run: `grep -rn 'type: "comment"\|type: "reply"' src/`
Expected: No results.

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 4: Commit if any changes needed**

---

## Task 5: Update docs and verify

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Update src/AGENTS.md**

Reflect new storage architecture in the module docs.

**Step 4: Commit**

```bash
git add src/AGENTS.md
git commit -m "docs: update architecture docs for frontmatter comment storage"
```

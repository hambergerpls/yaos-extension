# Document Mention Notifications

## Goal

When a user `@mentions` a device via the editor autocomplete dropdown, create a
notification for the mentioned device. Currently, mentions in the editor body are
plain text with no side effects — only mentions in **comments** trigger
notifications.

**Scope**: Mentions inserted via the autocomplete dropdown only. Manually typed
`@DeviceName` (no autocomplete) is out of scope — that would require a document
change diff listener, which is significantly more complex.

## Architecture constraint

All notification-related code (types, helpers, store, view) must live in
`src/notifications/`. The `Notification` type is moved out of
`src/comments/types.ts` into `src/notifications/types.ts`.

## Phases

### Phase 1: Move `Notification` type to `src/notifications/types.ts`

| # | File | Change |
|---|---|---|
| 1a | Create `src/notifications/types.ts` | New file with `Notification` interface. Add `"document_mention"` to `kind` union. Make `commentId` optional (`commentId?: string`). |
| 1b | `src/comments/types.ts` | Remove `Notification` interface |
| 1c | `src/notifications/notificationHelpers.ts` | Change import from `"../comments/types"` to `"./types"` |
| 1d | `src/notifications/notificationStore.ts` | Change import from `"../comments/types"` to `"./types"` |
| 1e | `src/notifications/notificationView.ts` | Change import from `"../comments/types"` to `"./types"` |
| 1f | `src/notifications/notificationView.test.ts` | Change import from `"../comments/types"` to `"./types"` |
| 1g | `src/notifications/notificationStore.test.ts` | Change import from `"../comments/types"` to `"./types"` |

### Phase 2: Add `createDocumentMentionNotification` helper

| # | File | Change |
|---|---|---|
| 2a | `src/notifications/notificationHelpers.ts` | Add `createDocumentMentionNotification(opts: { fileId, fromDevice, targetDevice, preview })` — returns a single `Notification` with `kind: "document_mention"`, no `commentId`. |
| 2b | `src/notifications/notificationHelpers.test.ts` | Tests for new function |

### Phase 3: Add `onMention` callback to editor mention plugin

| # | File | Change |
|---|---|---|
| 3a | `src/mentions/editorMentionPlugin.ts` | Add optional `onMention?: (peerName: string) => void` second parameter to `editorMentionExtension()`. Store on `EditorMentionPlugin`. Call `this.onMention(peer.name)` in `selectPeer()` after dispatching the text change. |
| 3b | `src/mentions/editorMentionPlugin.test.ts` | Test that `onMention` fires when a peer is selected (click and Enter). Test that it does NOT fire on cancel. |

### Phase 4: Wire callback in `main.ts`

| # | File | Change |
|---|---|---|
| 4a | `src/main.ts` | Import `createDocumentMentionNotification`. Pass `onMention` callback to `editorMentionExtension` that: (1) gets active file path, (2) gets local device name, (3) skips self-mentions, (4) creates notification, (5) writes via `notificationStore.addNotification`. |
| 4b | `src/main.ts` | Update `openFileAndComment` to handle missing `commentId` — just open the file, skip comment sidebar force-open. |

### Phase 5: Handle `document_mention` in notification view

| # | File | Change |
|---|---|---|
| 5a | `src/notifications/notificationView.ts` | Handle `document_mention` kind icon (`@` symbol). On click with no `commentId`, just open the file (don't force comment sidebar). |
| 5b | `src/notifications/notificationView.test.ts` | Tests for `document_mention` rendering and click behavior |

## Execution order

- Phases 1 and 2 are independent of phase 3.
- Phase 4 depends on phases 2 and 3.
- Phase 5 depends on phase 1.
- Build/test after each phase.

## New `Notification` type (in `src/notifications/types.ts`)

```ts
export interface Notification {
  type: "notification";
  id: string;
  kind: "mention" | "reply" | "new_comment" | "document_mention";
  commentId?: string;
  replyId?: string;
  fileId: string;
  fromDevice: string;
  targetDevice: string;
  createdAt: number;
  preview: string;
}
```

## New helper function signature

```ts
export function createDocumentMentionNotification(opts: {
  fileId: string;
  fromDevice: string;
  targetDevice: string;
  preview: string;
}): Notification
```

## Callback wiring in main.ts (pseudocode)

```ts
this.registerEditorExtension(
  editorMentionExtension(
    () => getAllKnownDevices(this.app, this.tracker?.currentAwareness ?? null, this.deviceRegistry),
    (peerName: string) => {
      const filePath = this.getActiveFilePath();
      if (!filePath) return;
      const localName = getLocalDeviceName(this.app);
      if (localName === peerName) return;
      const notification = createDocumentMentionNotification({
        fileId: filePath,
        fromDevice: localName,
        targetDevice: peerName,
        preview: `@${peerName}`,
      });
      this.notificationStore?.addNotification(notification);
    },
  ),
);
```

## Out of scope

- Notifications for manually typed `@mentions` (no autocomplete)
- Deduplication of notifications (consistent with existing comment mention behavior)

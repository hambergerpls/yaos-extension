import type { Notification } from "./types";
import { log } from "../logger";

export function createMentionNotifications(opts: {
  commentId: string;
  replyId?: string;
  fileId: string;
  fromDevice: string;
  mentions: string[];
  preview: string;
}): Notification[] {
  const result = opts.mentions.map((mention) => ({
    type: "notification" as const,
    id: crypto.randomUUID(),
    kind: "mention" as const,
    commentId: opts.commentId,
    replyId: opts.replyId,
    fileId: opts.fileId,
    fromDevice: opts.fromDevice,
    targetDevice: mention,
    createdAt: Date.now(),
    preview: opts.preview.slice(0, 80),
  }));
  log("createMentionNotifications: %d notifications for mentions=%o from=%s", result.length, opts.mentions, opts.fromDevice);
  return result;
}

export function createReplyNotification(opts: {
  commentId: string;
  replyId: string;
  fileId: string;
  fromDevice: string;
  commentAuthor: string;
  preview: string;
}): Notification | null {
  if (opts.fromDevice === opts.commentAuthor) {
    log("createReplyNotification: skipped (fromDevice=%s == commentAuthor=%s)", opts.fromDevice, opts.commentAuthor);
    return null;
  }
  const result = {
    type: "notification" as const,
    id: crypto.randomUUID(),
    kind: "reply" as const,
    commentId: opts.commentId,
    replyId: opts.replyId,
    fileId: opts.fileId,
    fromDevice: opts.fromDevice,
    targetDevice: opts.commentAuthor,
    createdAt: Date.now(),
    preview: opts.preview.slice(0, 80),
  };
  log("createReplyNotification: created reply notification from=%s to=%s", opts.fromDevice, opts.commentAuthor);
  return result;
}

export function createDocumentMentionNotification(opts: {
  fileId: string;
  fromDevice: string;
  targetDevice: string;
  preview: string;
}): Notification {
  const result = {
    type: "notification" as const,
    id: crypto.randomUUID(),
    kind: "document_mention" as const,
    fileId: opts.fileId,
    fromDevice: opts.fromDevice,
    targetDevice: opts.targetDevice,
    createdAt: Date.now(),
    preview: opts.preview.slice(0, 80),
  };
  log("createDocumentMentionNotification: from=%s to=%s in %s", opts.fromDevice, opts.targetDevice, opts.fileId);
  return result;
}

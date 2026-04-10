import type { Notification } from "../comments/types";

export function createMentionNotifications(opts: {
  commentId: string;
  replyId?: string;
  fileId: string;
  fromDevice: string;
  mentions: string[];
  preview: string;
}): Notification[] {
  return opts.mentions.map((mention) => ({
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
}

export function createReplyNotification(opts: {
  commentId: string;
  replyId: string;
  fileId: string;
  fromDevice: string;
  commentAuthor: string;
  preview: string;
}): Notification | null {
  if (opts.fromDevice === opts.commentAuthor) return null;
  return {
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
}

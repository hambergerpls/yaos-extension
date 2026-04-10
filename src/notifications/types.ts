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

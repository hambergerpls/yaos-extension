export interface Comment {
  type: "comment";
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
}

export interface Reply {
  type: "reply";
  id: string;
  commentId: string;
  text: string;
  author: string;
  authorColor: string;
  createdAt: number;
  mentions: string[];
}

export interface ResolveEntry {
  type: "resolve";
  commentId: string;
  resolved: boolean;
  by: string;
  at: number;
}

export interface Deletion {
  type: "delete";
  targetId: string;
  deletedBy: string;
  deletedAt: number;
}

export interface Notification {
  type: "notification";
  id: string;
  kind: "mention" | "reply" | "new_comment";
  commentId: string;
  replyId?: string;
  fileId: string;
  fromDevice: string;
  targetDevice: string;
  createdAt: number;
  preview: string;
}

export type CommentEntry = Comment | Reply | ResolveEntry | Deletion;

export interface CommentThread {
  comment: Comment;
  replies: Reply[];
}

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
  editedAt?: number;
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
  editedAt?: number;
}

export interface EditEntry {
  type: "edit";
  targetId: string;
  newText: string;
  editedBy: string;
  editedAt: number;
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

export type CommentEntry = Comment | Reply | ResolveEntry | Deletion | EditEntry;

export interface CommentThread {
  comment: Comment;
  replies: Reply[];
}

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

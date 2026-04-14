import { App } from "obsidian";
import type { Comment, Reply, CommentThread } from "./types";
import { log } from "../logger";

export class CommentStore {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

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

  async resolveComment(filePath: string, commentId: string, resolved: boolean): Promise<void> {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file) return;

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const comments = fm["yaos-comments"];
      if (!comments || !comments[commentId]) return;
      comments[commentId].resolved = resolved;
    });
  }

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

  static extractMentions(text: string): string[] {
    const regex = /@(\w+)/g;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[1]!);
    }
    log("commentStore.extractMentions: input=%s mentions=%o", JSON.stringify(text), matches);
    return matches;
  }
}

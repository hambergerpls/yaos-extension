import { Vault } from "obsidian";
import type { Comment, Reply, CommentEntry, CommentThread, Deletion, ResolveEntry, EditEntry } from "./types";
import { log } from "../logger";

const COMMENTS_FOLDER = ".yaos-extension/comments";

export class CommentStore {
  private vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  filePathToJsonlPath(filePath: string): string {
    const encoded = filePath.replace(/\//g, "%2F");
    return `${COMMENTS_FOLDER}/${encoded}.jsonl`;
  }

  async ensureFolder(): Promise<void> {
    const exists = await this.vault.adapter.exists(COMMENTS_FOLDER);
    if (!exists) {
      await this.vault.adapter.mkdir(COMMENTS_FOLDER);
    }
  }

  async getThreadsForFile(filePath: string): Promise<CommentThread[]> {
    const jsonlPath = this.filePathToJsonlPath(filePath);
    let raw: string;
    try {
      raw = await this.vault.adapter.read(jsonlPath);
    } catch {
      return [];
    }

    if (!raw || raw.trim() === "") {
      return [];
    }

    const entries: CommentEntry[] = [];
    const lines = raw.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        const parsed = JSON.parse(trimmed) as CommentEntry;
        entries.push(parsed);
      } catch {
        continue;
      }
    }

    const deletedIds = new Set<string>();
    const resolveMap = new Map<string, { resolved: boolean; at: number }>();
    const editMap = new Map<string, { newText: string; editedAt: number; mentions: string[] }>();
    const comments = new Map<string, Comment>();
    const replies = new Map<string, Reply[]>();

    for (const entry of entries) {
      switch (entry.type) {
        case "delete": {
          deletedIds.add((entry as Deletion).targetId);
          break;
        }
        case "resolve": {
          const re = entry as ResolveEntry;
          const existing = resolveMap.get(re.commentId);
          if (!existing || re.at > existing.at) {
            resolveMap.set(re.commentId, { resolved: re.resolved, at: re.at });
          }
          break;
        }
        case "edit": {
          const ee = entry as EditEntry;
          const existing = editMap.get(ee.targetId);
          if (!existing || ee.editedAt > existing.editedAt) {
            editMap.set(ee.targetId, { newText: ee.newText, editedAt: ee.editedAt, mentions: ee.mentions });
          }
          break;
        }
        case "comment": {
          if (!deletedIds.has((entry as Comment).id)) {
            comments.set((entry as Comment).id, entry as Comment);
          }
          break;
        }
        case "reply": {
          if (!deletedIds.has((entry as Reply).id)) {
            const r = entry as Reply;
            const existing = replies.get(r.commentId) ?? [];
            existing.push(r);
            replies.set(r.commentId, existing);
          }
          break;
        }
      }
    }

    const threads: CommentThread[] = [];

    for (const [id, comment] of comments) {
      if (deletedIds.has(id)) continue;

      const resolveState = resolveMap.get(id);
      if (resolveState) {
        comment.resolved = resolveState.resolved;
      }

      const commentEdit = editMap.get(id);
      if (commentEdit) {
        comment.text = commentEdit.newText;
        comment.mentions = commentEdit.mentions;
        comment.editedAt = commentEdit.editedAt;
      }

      const commentReplies = (replies.get(id) ?? []).filter(r => !deletedIds.has(r.id));
      for (const reply of commentReplies) {
        const replyEdit = editMap.get(reply.id);
        if (replyEdit) {
          reply.text = replyEdit.newText;
          reply.mentions = replyEdit.mentions;
          reply.editedAt = replyEdit.editedAt;
        }
      }
      commentReplies.sort((a, b) => a.createdAt - b.createdAt);

      threads.push({ comment, replies: commentReplies });
    }

    threads.sort((a, b) => a.comment.rangeOffset - b.comment.rangeOffset);

    return threads;
  }

  async addComment(filePath: string, comment: Comment): Promise<void> {
    await this.ensureFolder();
    const jsonlPath = this.filePathToJsonlPath(filePath);
    const line = JSON.stringify(comment) + "\n";
    await this.vault.adapter.append(jsonlPath, line);
  }

  async addReply(filePath: string, reply: Reply): Promise<void> {
    await this.ensureFolder();
    const jsonlPath = this.filePathToJsonlPath(filePath);
    const line = JSON.stringify(reply) + "\n";
    await this.vault.adapter.append(jsonlPath, line);
  }

  async deleteEntry(filePath: string, targetId: string, deviceName: string): Promise<void> {
    await this.ensureFolder();
    const jsonlPath = this.filePathToJsonlPath(filePath);
    const deletion: Deletion = {
      type: "delete",
      targetId,
      deletedBy: deviceName,
      deletedAt: Date.now(),
    };
    await this.vault.adapter.append(jsonlPath, JSON.stringify(deletion) + "\n");
  }

  async resolveComment(filePath: string, commentId: string, resolved: boolean, deviceName: string): Promise<void> {
    await this.ensureFolder();
    const jsonlPath = this.filePathToJsonlPath(filePath);
    const entry: ResolveEntry = {
      type: "resolve",
      commentId,
      resolved,
      by: deviceName,
      at: Date.now(),
    };
    await this.vault.adapter.append(jsonlPath, JSON.stringify(entry) + "\n");
  }

  async editEntry(filePath: string, targetId: string, newText: string, deviceName: string): Promise<void> {
    await this.ensureFolder();
    const jsonlPath = this.filePathToJsonlPath(filePath);
    const mentions = CommentStore.extractMentions(newText);
    const entry: EditEntry = {
      type: "edit",
      targetId,
      newText,
      editedBy: deviceName,
      editedAt: Date.now(),
      mentions,
    };
    await this.vault.adapter.append(jsonlPath, JSON.stringify(entry) + "\n");
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

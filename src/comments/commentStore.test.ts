import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentStore } from "./commentStore";
import type { Comment, Reply, Deletion, ResolveEntry, EditEntry } from "./types";

function makeVault(files: Record<string, string>) {
  return {
    adapter: {
      exists: vi.fn(async (path: string) => path in files),
      mkdir: vi.fn(async (path: string) => { files[path] = ""; }),
      read: vi.fn(async (path: string) => {
        if (!(path in files)) throw new Error("File not found");
        return files[path];
      }),
      write: vi.fn(async (path: string, data: string) => { files[path] = data; }),
      append: vi.fn(async (path: string, data: string) => {
        if (path in files) {
          files[path] += data;
        } else {
          files[path] = data;
        }
      }),
    },
  } as any;
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    type: "comment",
    id: "comment-1",
    text: "This looks good",
    author: "Alice",
    authorColor: "#f00",
    createdAt: 1000,
    rangeText: "selected text",
    rangeContext: "some context before selected text and after",
    rangeOffset: 20,
    rangeLength: 13,
    resolved: false,
    mentions: [],
    ...overrides,
  };
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    type: "reply",
    id: "reply-1",
    commentId: "comment-1",
    text: "I agree",
    author: "Bob",
    authorColor: "#0f0",
    createdAt: 2000,
    mentions: [],
    ...overrides,
  };
}

describe("CommentStore", () => {
  describe("filePathToJsonlPath", () => {
    it("encodes a simple file path", () => {
      const store = new CommentStore(makeVault({}));
      expect(store.filePathToJsonlPath("notes/my-note.md")).toBe(
        ".yaos-extension/comments/notes%2Fmy-note.md.jsonl"
      );
    });

    it("encodes a nested file path", () => {
      const store = new CommentStore(makeVault({}));
      expect(store.filePathToJsonlPath("projects/sub/readme.md")).toBe(
        ".yaos-extension/comments/projects%2Fsub%2Freadme.md.jsonl"
      );
    });

    it("encodes a root-level file", () => {
      const store = new CommentStore(makeVault({}));
      expect(store.filePathToJsonlPath("readme.md")).toBe(
        ".yaos-extension/comments/readme.md.jsonl"
      );
    });

    it("does not collide when filename contains dashes", () => {
      const store = new CommentStore(makeVault({}));
      expect(store.filePathToJsonlPath("foo--bar.md")).toBe(
        ".yaos-extension/comments/foo--bar.md.jsonl"
      );
      expect(store.filePathToJsonlPath("foo/bar.md")).toBe(
        ".yaos-extension/comments/foo%2Fbar.md.jsonl"
      );
      expect(store.filePathToJsonlPath("foo--bar.md")).not.toBe(
        store.filePathToJsonlPath("foo/bar.md")
      );
    });
  });

  describe("ensureFolder", () => {
    it("creates the comments folder if it does not exist", async () => {
      const vault = makeVault({});
      const store = new CommentStore(vault);
      await store.ensureFolder();
      expect(vault.adapter.mkdir).toHaveBeenCalledWith(".yaos-extension/comments");
    });

    it("does not create the folder if it already exists", async () => {
      const vault = makeVault({ ".yaos-extension/comments": "" });
      const store = new CommentStore(vault);
      await store.ensureFolder();
      expect(vault.adapter.mkdir).not.toHaveBeenCalled();
    });
  });

  describe("getThreadsForFile", () => {
    it("returns empty array when file has no comments", async () => {
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": "" });
      const store = new CommentStore(vault);
      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toEqual([]);
    });

    it("returns empty array when JSONL file does not exist", async () => {
      const vault = makeVault({});
      const store = new CommentStore(vault);
      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toEqual([]);
    });

    it("reads a single comment as a thread", async () => {
      const comment = makeComment();
      const jsonl = JSON.stringify(comment) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.comment).toEqual(comment);
      expect(threads[0]!.replies).toEqual([]);
    });

    it("groups replies under their parent comment", async () => {
      const comment = makeComment({ id: "c1" });
      const reply1 = makeReply({ id: "r1", commentId: "c1" });
      const reply2 = makeReply({ id: "r2", commentId: "c1", createdAt: 3000 });
      const jsonl = JSON.stringify(comment) + "\n" +
        JSON.stringify(reply1) + "\n" +
        JSON.stringify(reply2) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.replies).toHaveLength(2);
      expect(threads[0]!.replies[0]!.id).toBe("r1");
      expect(threads[0]!.replies[1]!.id).toBe("r2");
    });

    it("sorts threads by rangeOffset", async () => {
      const comment1 = makeComment({ id: "c1", rangeOffset: 50 });
      const comment2 = makeComment({ id: "c2", rangeOffset: 10 });
      const jsonl = JSON.stringify(comment1) + "\n" + JSON.stringify(comment2) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads[0]!.comment.id).toBe("c2");
      expect(threads[1]!.comment.id).toBe("c1");
    });

    it("skips malformed lines and parses valid ones", async () => {
      const comment = makeComment();
      const jsonl = "this is not json\n" +
        JSON.stringify(comment) + "\n" +
        "{ broken json \n" +
        "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.comment.id).toBe("comment-1");
    });
  });

  describe("soft-delete", () => {
    it("filters out a deleted comment", async () => {
      const comment = makeComment({ id: "c1" });
      const deletion: Deletion = {
        type: "delete", targetId: "c1", deletedBy: "Alice", deletedAt: 5000,
      };
      const jsonl = JSON.stringify(comment) + "\n" + JSON.stringify(deletion) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(0);
    });

    it("filters out a deleted reply and its orphan replies", async () => {
      const comment = makeComment({ id: "c1" });
      const reply1 = makeReply({ id: "r1", commentId: "c1" });
      const reply2 = makeReply({ id: "r2", commentId: "c1" });
      const deletion: Deletion = {
        type: "delete", targetId: "r1", deletedBy: "Bob", deletedAt: 5000,
      };
      const jsonl = JSON.stringify(comment) + "\n" +
        JSON.stringify(reply1) + "\n" +
        JSON.stringify(reply2) + "\n" +
        JSON.stringify(deletion) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.replies).toHaveLength(1);
      expect(threads[0]!.replies[0]!.id).toBe("r2");
    });

    it("removes all replies when the parent comment is deleted", async () => {
      const comment = makeComment({ id: "c1" });
      const reply = makeReply({ id: "r1", commentId: "c1" });
      const deletion: Deletion = {
        type: "delete", targetId: "c1", deletedBy: "Alice", deletedAt: 5000,
      };
      const jsonl = JSON.stringify(comment) + "\n" +
        JSON.stringify(reply) + "\n" +
        JSON.stringify(deletion) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(0);
    });
  });

  describe("resolve entries", () => {
    it("updates a comment's resolved state", async () => {
      const comment = makeComment({ id: "c1", resolved: false });
      const resolveEntry: ResolveEntry = {
        type: "resolve", commentId: "c1", resolved: true, by: "Alice", at: 5000,
      };
      const jsonl = JSON.stringify(comment) + "\n" + JSON.stringify(resolveEntry) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.comment.resolved).toBe(true);
    });

    it("last resolve entry by timestamp wins", async () => {
      const comment = makeComment({ id: "c1", resolved: false });
      const resolve1: ResolveEntry = {
        type: "resolve", commentId: "c1", resolved: true, by: "Alice", at: 5000,
      };
      const resolve2: ResolveEntry = {
        type: "resolve", commentId: "c1", resolved: false, by: "Bob", at: 6000,
      };
      const jsonl = JSON.stringify(comment) + "\n" +
        JSON.stringify(resolve1) + "\n" +
        JSON.stringify(resolve2) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads[0]!.comment.resolved).toBe(false);
    });
  });

  describe("addComment", () => {
    it("appends a comment line to the JSONL file", async () => {
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": "" });
      const store = new CommentStore(vault);
      const comment = makeComment();

      await store.addComment("notes/my-note.md", comment);

      const written = vault.adapter.append.mock.calls[0];
      expect(written[0]).toBe(".yaos-extension/comments/notes%2Fmy-note.md.jsonl");
      const parsed = JSON.parse(written[1]);
      expect(parsed.type).toBe("comment");
      expect(parsed.id).toBe("comment-1");
    });

    it("creates the folder if needed before writing", async () => {
      const vault = makeVault({});
      const store = new CommentStore(vault);
      const comment = makeComment();

      await store.addComment("notes/my-note.md", comment);

      expect(vault.adapter.mkdir).toHaveBeenCalledWith(".yaos-extension/comments");
      expect(vault.adapter.append).toHaveBeenCalled();
    });
  });

  describe("addReply", () => {
    it("appends a reply line to the JSONL file", async () => {
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": "" });
      const store = new CommentStore(vault);
      const reply = makeReply();

      await store.addReply("notes/my-note.md", reply);

      const written = vault.adapter.append.mock.calls[0];
      expect(written[0]).toBe(".yaos-extension/comments/notes%2Fmy-note.md.jsonl");
      const parsed = JSON.parse(written[1]);
      expect(parsed.type).toBe("reply");
      expect(parsed.commentId).toBe("comment-1");
    });
  });

  describe("deleteEntry", () => {
    it("appends a deletion line to the JSONL file", async () => {
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": "" });
      const store = new CommentStore(vault);

      await store.deleteEntry("notes/my-note.md", "comment-1", "Alice");

      const written = vault.adapter.append.mock.calls[0];
      const parsed = JSON.parse(written[1]);
      expect(parsed.type).toBe("delete");
      expect(parsed.targetId).toBe("comment-1");
      expect(parsed.deletedBy).toBe("Alice");
      expect(parsed.deletedAt).toBeTypeOf("number");
    });
  });

  describe("resolveComment", () => {
    it("appends a resolve entry to the JSONL file", async () => {
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": "" });
      const store = new CommentStore(vault);

      await store.resolveComment("notes/my-note.md", "comment-1", true, "Alice");

      const written = vault.adapter.append.mock.calls[0];
      const parsed = JSON.parse(written[1]);
      expect(parsed.type).toBe("resolve");
      expect(parsed.commentId).toBe("comment-1");
      expect(parsed.resolved).toBe(true);
      expect(parsed.by).toBe("Alice");
      expect(parsed.at).toBeTypeOf("number");
    });
  });

  describe("round-trip", () => {
    it("writes a comment then reads it back as a thread", async () => {
      const files: Record<string, string> = {};
      const vault = makeVault(files);
      const store = new CommentStore(vault);
      const comment = makeComment({ id: "c-rt-1" });

      await store.addComment("notes/my-note.md", comment);
      const threads = await store.getThreadsForFile("notes/my-note.md");

      expect(threads).toHaveLength(1);
      expect(threads[0]!.comment.id).toBe("c-rt-1");
      expect(threads[0]!.comment.text).toBe("This looks good");
      expect(threads[0]!.replies).toEqual([]);
    });

    it("writes a comment + reply and reads back a thread with replies", async () => {
      const files: Record<string, string> = {};
      const vault = makeVault(files);
      const store = new CommentStore(vault);
      const comment = makeComment({ id: "c-rt-2" });
      const reply = makeReply({ id: "r-rt-1", commentId: "c-rt-2", text: "Agreed!" });

      await store.addComment("notes/my-note.md", comment);
      await store.addReply("notes/my-note.md", reply);
      const threads = await store.getThreadsForFile("notes/my-note.md");

      expect(threads).toHaveLength(1);
      expect(threads[0]!.replies).toHaveLength(1);
      expect(threads[0]!.replies[0]!.text).toBe("Agreed!");
    });
  });

  describe("edit entries", () => {
    it("applies an edit to a comment's text", async () => {
      const comment = makeComment({ id: "c1", text: "original" });
      const edit: EditEntry = {
        type: "edit",
        targetId: "c1",
        newText: "edited text",
        editedBy: "Alice",
        editedAt: 5000,
        mentions: [],
      };
      const jsonl = JSON.stringify(comment) + "\n" + JSON.stringify(edit) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.comment.text).toBe("edited text");
      expect(threads[0]!.comment.editedAt).toBe(5000);
    });

    it("applies an edit to a reply's text", async () => {
      const comment = makeComment({ id: "c1" });
      const reply = makeReply({ id: "r1", commentId: "c1", text: "original reply" });
      const edit: EditEntry = {
        type: "edit",
        targetId: "r1",
        newText: "edited reply",
        editedBy: "Bob",
        editedAt: 6000,
        mentions: [],
      };
      const jsonl = JSON.stringify(comment) + "\n" +
        JSON.stringify(reply) + "\n" +
        JSON.stringify(edit) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.replies).toHaveLength(1);
      expect(threads[0]!.replies[0]!.text).toBe("edited reply");
      expect(threads[0]!.replies[0]!.editedAt).toBe(6000);
    });

    it("latest edit by timestamp wins when multiple edits exist", async () => {
      const comment = makeComment({ id: "c1", text: "original" });
      const edit1: EditEntry = {
        type: "edit",
        targetId: "c1",
        newText: "first edit",
        editedBy: "Alice",
        editedAt: 5000,
        mentions: [],
      };
      const edit2: EditEntry = {
        type: "edit",
        targetId: "c1",
        newText: "second edit",
        editedBy: "Alice",
        editedAt: 7000,
        mentions: [],
      };
      const jsonl = JSON.stringify(comment) + "\n" +
        JSON.stringify(edit1) + "\n" +
        JSON.stringify(edit2) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads[0]!.comment.text).toBe("second edit");
      expect(threads[0]!.comment.editedAt).toBe(7000);
    });

    it("updates mentions from an edit", async () => {
      const comment = makeComment({ id: "c1", text: "original", mentions: ["Bob"] });
      const edit: EditEntry = {
        type: "edit",
        targetId: "c1",
        newText: "@Charlie take a look",
        editedBy: "Alice",
        editedAt: 5000,
        mentions: ["Charlie"],
      };
      const jsonl = JSON.stringify(comment) + "\n" + JSON.stringify(edit) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads[0]!.comment.mentions).toEqual(["Charlie"]);
    });

    it("does not apply edit to a deleted comment", async () => {
      const comment = makeComment({ id: "c1", text: "original" });
      const deletion: Deletion = {
        type: "delete", targetId: "c1", deletedBy: "Alice", deletedAt: 4000,
      };
      const edit: EditEntry = {
        type: "edit",
        targetId: "c1",
        newText: "should not appear",
        editedBy: "Alice",
        editedAt: 5000,
        mentions: [],
      };
      const jsonl = JSON.stringify(comment) + "\n" +
        JSON.stringify(deletion) + "\n" +
        JSON.stringify(edit) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(0);
    });

    it("does not apply edit to a deleted reply", async () => {
      const comment = makeComment({ id: "c1" });
      const reply = makeReply({ id: "r1", commentId: "c1", text: "original reply" });
      const deletion: Deletion = {
        type: "delete", targetId: "r1", deletedBy: "Bob", deletedAt: 4000,
      };
      const edit: EditEntry = {
        type: "edit",
        targetId: "r1",
        newText: "should not appear",
        editedBy: "Bob",
        editedAt: 5000,
        mentions: [],
      };
      const jsonl = JSON.stringify(comment) + "\n" +
        JSON.stringify(reply) + "\n" +
        JSON.stringify(deletion) + "\n" +
        JSON.stringify(edit) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads[0]!.replies).toHaveLength(0);
    });

    it("preserves editedAt as undefined when no edit exists", async () => {
      const comment = makeComment({ id: "c1", text: "original" });
      const jsonl = JSON.stringify(comment) + "\n";
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": jsonl });
      const store = new CommentStore(vault);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads[0]!.comment.editedAt).toBeUndefined();
    });
  });

  describe("editEntry method", () => {
    it("appends an edit entry line to the JSONL file", async () => {
      const vault = makeVault({ ".yaos-extension/comments/notes%2Fmy-note.md.jsonl": "" });
      const store = new CommentStore(vault);

      await store.editEntry("notes/my-note.md", "c1", "updated text", "Alice");

      const written = vault.adapter.append.mock.calls[0];
      expect(written[0]).toBe(".yaos-extension/comments/notes%2Fmy-note.md.jsonl");
      const parsed = JSON.parse(written[1]);
      expect(parsed.type).toBe("edit");
      expect(parsed.targetId).toBe("c1");
      expect(parsed.newText).toBe("updated text");
      expect(parsed.editedBy).toBe("Alice");
      expect(parsed.editedAt).toBeTypeOf("number");
      expect(parsed.mentions).toEqual([]);
    });

    it("creates the folder if needed before writing", async () => {
      const vault = makeVault({});
      const store = new CommentStore(vault);

      await store.editEntry("notes/my-note.md", "c1", "updated", "Alice");

      expect(vault.adapter.mkdir).toHaveBeenCalledWith(".yaos-extension/comments");
      expect(vault.adapter.append).toHaveBeenCalled();
    });
  });

  describe("extractMentions", () => {
    it("parses a single mention", () => {
      expect(CommentStore.extractMentions("@Alice take a look")).toEqual(["Alice"]);
    });

    it("parses multiple mentions", () => {
      expect(CommentStore.extractMentions("@Alice and @Bob should review")).toEqual(["Alice", "Bob"]);
    });

    it("returns empty array when no mentions", () => {
      expect(CommentStore.extractMentions("no mentions here")).toEqual([]);
    });

    it("handles punctuation after name", () => {
      expect(CommentStore.extractMentions("@Alice, check this!")).toEqual(["Alice"]);
    });

    it("handles @ at end of text", () => {
      expect(CommentStore.extractMentions("hey @")).toEqual([]);
    });

    it("handles empty string", () => {
      expect(CommentStore.extractMentions("")).toEqual([]);
    });

    it("handles lowercase device names", () => {
      expect(CommentStore.extractMentions("@iphone check this")).toEqual(["iphone"]);
    });

    it("only matches single word after @", () => {
      expect(CommentStore.extractMentions("@Alice take a look")).toEqual(["Alice"]);
    });

    it("handles underscores and digits in names", () => {
      expect(CommentStore.extractMentions("@Device_2 is online")).toEqual(["Device_2"]);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentStore } from "./commentStore";
import type { Comment, Reply } from "./types";

function makeApp(frontmatterByPath: Record<string, Record<string, any>> = {}) {
  const fmStore: Record<string, Record<string, any>> = {};

  for (const [path, fm] of Object.entries(frontmatterByPath)) {
    fmStore[path] = JSON.parse(JSON.stringify(fm));
  }

  return {
    vault: {
      getFileByPath: vi.fn((path: string) =>
        path in fmStore ? { path } : null
      ),
    },
    metadataCache: {
      getFileCache: vi.fn((file: any) => {
        const fm = fmStore[file.path];
        return fm ? { frontmatter: JSON.parse(JSON.stringify(fm)) } : null;
      }),
    },
    fileManager: {
      processFrontMatter: vi.fn(async (file: any, fn: (fm: any) => void) => {
        if (!fmStore[file.path]) fmStore[file.path] = {};
        fn(fmStore[file.path]);
      }),
    },
    _fmStore: fmStore,
  } as any;
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "1713123456000",
    text: "This looks good",
    author: "Alice",
    authorColor: "#f00",
    createdAt: 1713123456000,
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
    id: "1713123500000",
    commentId: "1713123456000",
    text: "I agree",
    author: "Bob",
    authorColor: "#0f0",
    createdAt: 1713123500000,
    mentions: [],
    ...overrides,
  };
}

describe("CommentStore", () => {
  describe("getThreadsForFile", () => {
    it("returns empty array when file does not exist", async () => {
      const app = makeApp({});
      const store = new CommentStore(app);
      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toEqual([]);
    });

    it("returns empty array when file has no frontmatter", async () => {
      const app = makeApp({ "notes/my-note.md": {} });
      const store = new CommentStore(app);
      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toEqual([]);
    });

    it("returns empty array when file has no yaos-comments key", async () => {
      const app = makeApp({ "notes/my-note.md": { title: "My Note" } });
      const store = new CommentStore(app);
      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toEqual([]);
    });

    it("returns a single comment as a thread with no replies", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              authorColor: "#f00",
              createdAt: 1713123456000,
              rangeText: "selected text",
              rangeContext: "some context before selected text and after",
              rangeOffset: 20,
              rangeLength: 13,
              resolved: false,
              mentions: [],
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.comment.id).toBe("1713123456000");
      expect(threads[0]!.comment.text).toBe("This looks good");
      expect(threads[0]!.comment.author).toBe("Alice");
      expect(threads[0]!.replies).toEqual([]);
    });

    it("groups replies under their parent comment", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              authorColor: "#f00",
              createdAt: 1713123456000,
              rangeText: "selected text",
              rangeContext: "some context before selected text and after",
              rangeOffset: 20,
              rangeLength: 13,
              resolved: false,
              mentions: [],
              replies: {
                "1713123500000": {
                  text: "I agree",
                  author: "Bob",
                  authorColor: "#0f0",
                  createdAt: 1713123500000,
                  mentions: [],
                },
                "1713123600000": {
                  text: "Me too",
                  author: "Charlie",
                  authorColor: "#00f",
                  createdAt: 1713123600000,
                  mentions: [],
                },
              },
            },
          },
        },
      });
      const store = new CommentStore(app);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(1);
      expect(threads[0]!.replies).toHaveLength(2);
      expect(threads[0]!.replies[0]!.id).toBe("1713123500000");
      expect(threads[0]!.replies[0]!.commentId).toBe("1713123456000");
      expect(threads[0]!.replies[1]!.id).toBe("1713123600000");
    });

    it("preserves insertion order (does NOT sort by rangeOffset)", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713100000000": {
              text: "Later in doc",
              author: "Alice",
              authorColor: "#f00",
              createdAt: 1713100000000,
              rangeText: "later text",
              rangeContext: "",
              rangeOffset: 50,
              rangeLength: 5,
              resolved: false,
              mentions: [],
              replies: {},
            },
            "1713200000000": {
              text: "Earlier in doc",
              author: "Bob",
              authorColor: "#0f0",
              createdAt: 1713200000000,
              rangeText: "earlier text",
              rangeContext: "",
              rangeOffset: 10,
              rangeLength: 6,
              resolved: false,
              mentions: [],
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads).toHaveLength(2);
      expect(threads[0]!.comment.rangeOffset).toBe(50);
      expect(threads[1]!.comment.rangeOffset).toBe(10);
    });

    it("returns multiple threads in insertion order", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "100": {
              text: "First comment",
              author: "Alice",
              authorColor: "#f00",
              createdAt: 100,
              rangeText: "text1",
              rangeContext: "",
              rangeOffset: 0,
              rangeLength: 5,
              resolved: false,
              mentions: [],
              replies: {},
            },
            "200": {
              text: "Second comment",
              author: "Bob",
              authorColor: "#0f0",
              createdAt: 200,
              rangeText: "text2",
              rangeContext: "",
              rangeOffset: 10,
              rangeLength: 5,
              resolved: false,
              mentions: [],
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      const threads = await store.getThreadsForFile("notes/my-note.md");
      expect(threads[0]!.comment.id).toBe("100");
      expect(threads[1]!.comment.id).toBe("200");
    });
  });

  describe("addComment", () => {
    it("creates yaos-comments map if it does not exist", async () => {
      const app = makeApp({ "notes/my-note.md": {} });
      const store = new CommentStore(app);
      const comment = makeComment();

      await store.addComment("notes/my-note.md", comment);

      expect(app._fmStore["notes/my-note.md"]["yaos-comments"]).toBeDefined();
      expect(app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"]).toBeDefined();
    });

    it("adds a comment entry keyed by timestamp ID", async () => {
      const app = makeApp({ "notes/my-note.md": {} });
      const store = new CommentStore(app);
      const comment = makeComment();

      await store.addComment("notes/my-note.md", comment);

      const entry = app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"];
      expect(entry.text).toBe("This looks good");
      expect(entry.author).toBe("Alice");
      expect(entry.createdAt).toBe(1713123456000);
      expect(entry.rangeText).toBe("selected text");
      expect(entry.rangeContext).toBe("some context before selected text and after");
      expect(entry.rangeOffset).toBe(20);
      expect(entry.rangeLength).toBe(13);
      expect(entry.resolved).toBe(false);
      expect(entry.mentions).toEqual([]);
    });

    it("initializes empty replies sub-map", async () => {
      const app = makeApp({ "notes/my-note.md": {} });
      const store = new CommentStore(app);
      const comment = makeComment();

      await store.addComment("notes/my-note.md", comment);

      const entry = app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"];
      expect(entry.replies).toEqual({});
    });

    it("works when file has no existing frontmatter", async () => {
      const app = makeApp({ "notes/my-note.md": {} });
      const store = new CommentStore(app);
      const comment = makeComment();

      await store.addComment("notes/my-note.md", comment);

      expect(app.fileManager.processFrontMatter).toHaveBeenCalled();
    });
  });

  describe("addReply", () => {
    it("adds a reply to the correct comment's replies map", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              authorColor: "#f00",
              createdAt: 1713123456000,
              rangeText: "selected text",
              rangeContext: "",
              rangeOffset: 20,
              rangeLength: 13,
              resolved: false,
              mentions: [],
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);
      const reply = makeReply();

      await store.addReply("notes/my-note.md", reply);

      const replies = app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"].replies;
      expect(replies["1713123500000"]).toBeDefined();
      expect(replies["1713123500000"].text).toBe("I agree");
      expect(replies["1713123500000"].author).toBe("Bob");
      expect(replies["1713123500000"].createdAt).toBe(1713123500000);
    });

    it("creates replies sub-map if it does not exist", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              authorColor: "#f00",
              createdAt: 1713123456000,
              rangeText: "selected text",
              rangeContext: "",
              rangeOffset: 20,
              rangeLength: 13,
              resolved: false,
              mentions: [],
            },
          },
        },
      });
      const store = new CommentStore(app);
      const reply = makeReply();

      await store.addReply("notes/my-note.md", reply);

      const comment = app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"];
      expect(comment.replies).toBeDefined();
      expect(comment.replies["1713123500000"]).toBeDefined();
    });

    it("no-ops if comment does not exist", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "999": {
              text: "Other comment",
              author: "Alice",
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);
      const reply = makeReply();

      await store.addReply("notes/my-note.md", reply);

      const comments = app._fmStore["notes/my-note.md"]["yaos-comments"];
      expect(comments["999"].replies).toEqual({});
      expect(comments["1713123500000"]).toBeUndefined();
    });
  });

  describe("deleteEntry", () => {
    it("removes a top-level comment (and its replies)", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              replies: { "1713123500000": { text: "I agree" } },
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.deleteEntry("notes/my-note.md", "1713123456000");

      expect(app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"]).toBeUndefined();
    });

    it("removes a reply from the correct comment's replies map", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              replies: {
                "1713123500000": { text: "I agree", author: "Bob" },
                "1713123600000": { text: "Me too", author: "Charlie" },
              },
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.deleteEntry("notes/my-note.md", "1713123500000");

      const replies = app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"].replies;
      expect(replies["1713123500000"]).toBeUndefined();
      expect(replies["1713123600000"]).toBeDefined();
    });

    it("no-ops if target does not exist", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.deleteEntry("notes/my-note.md", "nonexistent");

      expect(app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"]).toBeDefined();
    });
  });

  describe("resolveComment", () => {
    it("sets resolved: true on a comment", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              resolved: false,
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.resolveComment("notes/my-note.md", "1713123456000", true);

      expect(app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"].resolved).toBe(true);
    });

    it("sets resolved: false on a comment (reopen)", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              resolved: true,
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.resolveComment("notes/my-note.md", "1713123456000", false);

      expect(app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"].resolved).toBe(false);
    });

    it("no-ops if comment does not exist", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "This looks good",
              author: "Alice",
              resolved: false,
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.resolveComment("notes/my-note.md", "nonexistent", true);

      expect(app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"].resolved).toBe(false);
    });
  });

  describe("editEntry", () => {
    it("updates text, mentions, and sets editedAt on a comment", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "original",
              author: "Alice",
              mentions: [],
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.editEntry("notes/my-note.md", "1713123456000", "@Bob take a look");

      const entry = app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"];
      expect(entry.text).toBe("@Bob take a look");
      expect(entry.mentions).toEqual(["Bob"]);
      expect(entry.editedAt).toBeTypeOf("number");
    });

    it("updates text, mentions, and sets editedAt on a reply", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "original comment",
              author: "Alice",
              replies: {
                "1713123500000": {
                  text: "original reply",
                  author: "Bob",
                  mentions: [],
                },
              },
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.editEntry("notes/my-note.md", "1713123500000", "updated reply @Charlie");

      const reply = app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"].replies["1713123500000"];
      expect(reply.text).toBe("updated reply @Charlie");
      expect(reply.mentions).toEqual(["Charlie"]);
      expect(reply.editedAt).toBeTypeOf("number");
    });

    it("extracts mentions from new text", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "original",
              author: "Alice",
              mentions: ["Bob"],
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.editEntry("notes/my-note.md", "1713123456000", "@Charlie and @Dave review");

      const entry = app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"];
      expect(entry.mentions).toEqual(["Charlie", "Dave"]);
    });

    it("no-ops if target does not exist", async () => {
      const app = makeApp({
        "notes/my-note.md": {
          "yaos-comments": {
            "1713123456000": {
              text: "original",
              author: "Alice",
              mentions: [],
              replies: {},
            },
          },
        },
      });
      const store = new CommentStore(app);

      await store.editEntry("notes/my-note.md", "nonexistent", "new text");

      expect(app._fmStore["notes/my-note.md"]["yaos-comments"]["1713123456000"].text).toBe("original");
    });
  });

  describe("round-trip", () => {
    it("writes a comment then reads it back as a thread", async () => {
      const app = makeApp({ "notes/my-note.md": {} });
      const store = new CommentStore(app);
      const comment = makeComment({ id: "100" });

      await store.addComment("notes/my-note.md", comment);
      const threads = await store.getThreadsForFile("notes/my-note.md");

      expect(threads).toHaveLength(1);
      expect(threads[0]!.comment.id).toBe("100");
      expect(threads[0]!.comment.text).toBe("This looks good");
      expect(threads[0]!.replies).toEqual([]);
    });

    it("writes a comment + reply and reads back a thread with replies", async () => {
      const app = makeApp({ "notes/my-note.md": {} });
      const store = new CommentStore(app);
      const comment = makeComment({ id: "200" });
      const reply = makeReply({ id: "300", commentId: "200", text: "Agreed!" });

      await store.addComment("notes/my-note.md", comment);
      await store.addReply("notes/my-note.md", reply);
      const threads = await store.getThreadsForFile("notes/my-note.md");

      expect(threads).toHaveLength(1);
      expect(threads[0]!.replies).toHaveLength(1);
      expect(threads[0]!.replies[0]!.text).toBe("Agreed!");
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

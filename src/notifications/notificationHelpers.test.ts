import { describe, test, expect } from "vitest";
import { createMentionNotifications, createReplyNotification, createDocumentMentionNotification } from "./notificationHelpers";

describe("createMentionNotifications", () => {
  test("creates one notification per mention", () => {
    const result = createMentionNotifications({
      commentId: "c1",
      fileId: "notes/test.md",
      fromDevice: "Alice",
      mentions: ["Bob", "Charlie"],
      preview: "Hey @Bob and @Charlie check this out",
    });

    expect(result.length).toBe(2);
    expect(result[0]!.kind).toBe("mention");
    expect(result[0]!.targetDevice).toBe("Bob");
    expect(result[0]!.commentId).toBe("c1");
    expect(result[1]!.targetDevice).toBe("Charlie");
  });

  test("returns empty array when no mentions", () => {
    const result = createMentionNotifications({
      commentId: "c1",
      fileId: "test.md",
      fromDevice: "Alice",
      mentions: [],
      preview: "No mentions here",
    });

    expect(result).toEqual([]);
  });

  test("includes replyId when provided", () => {
    const result = createMentionNotifications({
      commentId: "c1",
      replyId: "r1",
      fileId: "test.md",
      fromDevice: "Alice",
      mentions: ["Bob"],
      preview: "@Bob what do you think?",
    });

    expect(result.length).toBe(1);
    expect(result[0]!.replyId).toBe("r1");
  });

  test("truncates preview to 80 characters", () => {
    const longPreview = "A".repeat(200);
    const result = createMentionNotifications({
      commentId: "c1",
      fileId: "test.md",
      fromDevice: "Alice",
      mentions: ["Bob"],
      preview: longPreview,
    });

    expect(result[0]!.preview.length).toBe(80);
  });

  test("sets correct fromDevice and fileId", () => {
    const result = createMentionNotifications({
      commentId: "c1",
      fileId: "path/to/file.md",
      fromDevice: "Laptop",
      mentions: ["Phone"],
      preview: "test",
    });

    expect(result[0]!.fromDevice).toBe("Laptop");
    expect(result[0]!.fileId).toBe("path/to/file.md");
  });
});

describe("createReplyNotification", () => {
  test("creates notification when replier is not the comment author", () => {
    const result = createReplyNotification({
      commentId: "c1",
      replyId: "r1",
      fileId: "test.md",
      fromDevice: "Bob",
      commentAuthor: "Alice",
      preview: "I disagree",
    });

    expect(result).not.toBeNull();
    expect(result!.kind).toBe("reply");
    expect(result!.targetDevice).toBe("Alice");
    expect(result!.fromDevice).toBe("Bob");
    expect(result!.commentId).toBe("c1");
    expect(result!.replyId).toBe("r1");
  });

  test("returns null when replier is the comment author", () => {
    const result = createReplyNotification({
      commentId: "c1",
      replyId: "r1",
      fileId: "test.md",
      fromDevice: "Alice",
      commentAuthor: "Alice",
      preview: "Updating my comment",
    });

    expect(result).toBeNull();
  });

  test("truncates preview to 80 characters", () => {
    const longPreview = "B".repeat(200);
    const result = createReplyNotification({
      commentId: "c1",
      replyId: "r1",
      fileId: "test.md",
      fromDevice: "Bob",
      commentAuthor: "Alice",
      preview: longPreview,
    });

    expect(result!.preview.length).toBe(80);
  });
});

describe("createDocumentMentionNotification", () => {
  test("creates a notification with kind document_mention", () => {
    const result = createDocumentMentionNotification({
      fileId: "notes/test.md",
      fromDevice: "Alice",
      targetDevice: "Bob",
      preview: "@Bob take a look at this",
    });

    expect(result.kind).toBe("document_mention");
    expect(result.targetDevice).toBe("Bob");
    expect(result.fromDevice).toBe("Alice");
    expect(result.fileId).toBe("notes/test.md");
    expect(result.type).toBe("notification");
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeDefined();
  });

  test("has no commentId", () => {
    const result = createDocumentMentionNotification({
      fileId: "notes/test.md",
      fromDevice: "Alice",
      targetDevice: "Bob",
      preview: "@Bob",
    });

    expect(result.commentId).toBeUndefined();
  });

  test("truncates preview to 80 characters", () => {
    const longPreview = "C".repeat(200);
    const result = createDocumentMentionNotification({
      fileId: "test.md",
      fromDevice: "Alice",
      targetDevice: "Bob",
      preview: longPreview,
    });

    expect(result.preview.length).toBe(80);
  });
});

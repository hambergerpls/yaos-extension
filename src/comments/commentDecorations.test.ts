import { describe, it, expect } from "vitest";
import { findRangeInDocument } from "./commentDecorations";

describe("findRangeInDocument", () => {
  it("finds an exact match at the given offset", () => {
    const doc = "Hello world this is a test";
    const result = findRangeInDocument(doc, "world", "", 6);
    expect(result).toEqual({ from: 6, to: 11 });
  });

  it("returns null when text is not found", () => {
    const doc = "Hello world";
    const result = findRangeInDocument(doc, "missing", "", 0);
    expect(result).toBeNull();
  });

  it("finds text regardless of offset hint", () => {
    const doc = "The quick brown fox jumps";
    const result = findRangeInDocument(doc, "brown", "", 0);
    expect(result).toEqual({ from: 10, to: 15 });
  });

  it("returns null when document is empty", () => {
    const result = findRangeInDocument("", "text", "", 0);
    expect(result).toBeNull();
  });

  it("disambiguates using context when text appears multiple times", () => {
    const doc = "aaa hello world bbb hello world ccc";
    const result = findRangeInDocument(doc, "hello world", "bbb hello", 20);
    expect(result).toEqual({ from: 20, to: 31 });
  });

  it("prefers match closest to offset hint", () => {
    const doc = "hello world and hello again";
    const result = findRangeInDocument(doc, "hello", "", 15);
    expect(result).toEqual({ from: 16, to: 21 });
  });

  it("handles rangeText at the start of the document", () => {
    const doc = "Hello world";
    const result = findRangeInDocument(doc, "Hello", "", 0);
    expect(result).toEqual({ from: 0, to: 5 });
  });

  it("handles rangeText at the end of the document", () => {
    const doc = "Hello world";
    const result = findRangeInDocument(doc, "world", "", 10);
    expect(result).toEqual({ from: 6, to: 11 });
  });

  it("handles empty rangeText by returning null", () => {
    const doc = "Hello world";
    const result = findRangeInDocument(doc, "", "", 0);
    expect(result).toBeNull();
  });

  it("handles multiline text", () => {
    const doc = "line one\nline two\nline three";
    const result = findRangeInDocument(doc, "line two", "", 10);
    expect(result).toEqual({ from: 9, to: 17 });
  });

  it("falls back to first match when offset hint is inaccurate", () => {
    const doc = "alpha beta gamma";
    const result = findRangeInDocument(doc, "gamma", "", 0);
    expect(result).toEqual({ from: 11, to: 16 });
  });
});

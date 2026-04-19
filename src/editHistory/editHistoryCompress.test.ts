import { describe, it, expect } from "vitest";
import { encodeContent, decodeContent } from "./editHistoryCompress";

describe("encodeContent", () => {
	it("returns raw plain text when below the 512-byte threshold", () => {
		const result = encodeContent("short text");
		expect(result.content).toBe("short text");
		expect(result.contentEnc).toBeUndefined();
	});

	it("returns dfb64 payload when compression shrinks large repeating text", () => {
		const raw = "the quick brown fox jumps over the lazy dog.\n".repeat(100);
		// raw.length ≈ 4500 chars; deflate should crush the repetition.
		const result = encodeContent(raw);
		expect(result.contentEnc).toBe("dfb64");
		expect(result.content.length).toBeLessThan(raw.length);
	});
});

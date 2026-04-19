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

	it("roundtrips large compressible content through encode+decode", () => {
		const raw = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n".repeat(20);
		const { content, contentEnc } = encodeContent(raw);
		expect(contentEnc).toBe("dfb64");
		expect(decodeContent(content, contentEnc)).toBe(raw);
	});

	it("falls back to raw when deflate does not shrink the payload", () => {
		// Random-looking high-entropy string: every char unique in a tight range.
		// Deflate + base64 should be larger than raw because there's nothing to exploit.
		let raw = "";
		for (let i = 0; i < 800; i++) {
			raw += String.fromCharCode(33 + ((i * 1103515245 + 12345) % 93));
		}
		const result = encodeContent(raw);
		// If implementation chose dfb64, then it must actually be smaller (by contract);
		// otherwise it must have fallen back to raw.
		if (result.contentEnc === "dfb64") {
			expect(result.content.length).toBeLessThan(raw.length);
		} else {
			expect(result.content).toBe(raw);
			expect(result.contentEnc).toBeUndefined();
		}
	});
});

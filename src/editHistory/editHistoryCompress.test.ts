import { describe, it, expect } from "vitest";
import { encodeContent } from "./editHistoryCompress";

describe("encodeContent", () => {
	it("returns raw plain text when below the 512-byte threshold", () => {
		const result = encodeContent("short text");
		expect(result.content).toBe("short text");
		expect(result.contentEnc).toBeUndefined();
	});
});

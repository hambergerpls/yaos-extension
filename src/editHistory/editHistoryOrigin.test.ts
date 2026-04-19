import { describe, it, expect } from "vitest";
import { isLocalOrigin } from "./editHistoryOrigin";

describe("isLocalOrigin", () => {
	it("returns false when origin is the provider reference", () => {
		const provider = { name: "fake-provider" };
		expect(isLocalOrigin(provider, provider)).toBe(false);
	});
});

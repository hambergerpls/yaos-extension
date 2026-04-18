import { describe, it, expect, vi } from "vitest";
import { createDebouncer } from "./debounce";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("createDebouncer", () => {
	it("coalesces N calls within the window into one execution", async () => {
		const debounce = createDebouncer(30);
		const fn = vi.fn(async () => {});

		debounce(fn);
		debounce(fn);
		debounce(fn);

		expect(fn).toHaveBeenCalledTimes(0);
		await sleep(60);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("uses the LATEST function passed (trailing-edge replacement)", async () => {
		const debounce = createDebouncer(30);
		const a = vi.fn(async () => {});
		const b = vi.fn(async () => {});
		const c = vi.fn(async () => {});

		debounce(a);
		debounce(b);
		debounce(c);

		await sleep(60);
		expect(a).not.toHaveBeenCalled();
		expect(b).not.toHaveBeenCalled();
		expect(c).toHaveBeenCalledTimes(1);
	});

	it("returned promise resolves after the trailing execution completes", async () => {
		const debounce = createDebouncer(30);
		let done = false;
		const p = debounce(async () => {
			await sleep(10);
			done = true;
		});

		expect(done).toBe(false);
		await p;
		expect(done).toBe(true);
	});

	it("subsequent calls after the window start a new cycle", async () => {
		const debounce = createDebouncer(30);
		const fn = vi.fn(async () => {});

		debounce(fn);
		await sleep(60);
		expect(fn).toHaveBeenCalledTimes(1);

		debounce(fn);
		await sleep(60);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

/**
 * Trailing-edge debouncer. Returns a function that, when called with a task,
 * schedules the task to run after `ms` milliseconds of quiescence. If called
 * again before that window expires, the latest task replaces the scheduled one
 * and the timer resets.
 *
 * The returned promise resolves when the scheduled task completes. All calls
 * within a single quiescent window share the same promise.
 */
export function createDebouncer(ms: number) {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pendingTask: (() => Promise<void> | void) | null = null;
	let pendingPromise: Promise<void> | null = null;
	let resolvePending: (() => void) | null = null;
	let rejectPending: ((e: unknown) => void) | null = null;

	return (task: () => Promise<void> | void): Promise<void> => {
		pendingTask = task;

		if (!pendingPromise) {
			pendingPromise = new Promise<void>((resolve, reject) => {
				resolvePending = resolve;
				rejectPending = reject;
			});
		}

		if (timer) clearTimeout(timer);
		timer = setTimeout(async () => {
			timer = null;
			const runTask = pendingTask!;
			const resolver = resolvePending!;
			const rejecter = rejectPending!;
			pendingTask = null;
			pendingPromise = null;
			resolvePending = null;
			rejectPending = null;
			try {
				await runTask();
				resolver();
			} catch (e) {
				rejecter(e);
			}
		}, ms);

		return pendingPromise;
	};
}

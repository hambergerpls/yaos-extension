import type { EditHistoryStore } from "./editHistoryStore";
import { computeLineHunks, reconstructVersion } from "./editHistoryDiff";
import { encodeContent } from "./editHistoryCompress";
import type { PendingEditsDb } from "./pendingEditsDb";
import { logWarn } from "../logger";

export interface CaptureSettings {
	rebaseInterval: number;
	maxPerFilePerDay: number;
	debounceMs: number;
	maxWaitMs: number;
}

interface FileTimer {
	idle: ReturnType<typeof setTimeout>;
	max: ReturnType<typeof setTimeout> | null;
	// Timestamp of the first edit in the current burst. Not currently consumed;
	// reserved for future UI affordances (e.g. "capturing in Xs" indicator) or
	// telemetry on typical burst durations.
	firstScheduledAt: number;
}

export class EditHistoryCapture {
	private store: EditHistoryStore;
	private getDeviceName: () => string;
	private settings: CaptureSettings;
	private pendingTimers: Map<string, FileTimer> = new Map();
	private dailyCounts: Map<string, { date: string; count: number }> = new Map();
	private observeDeepHandler: ((...args: unknown[]) => void) | null = null;
	private idToText: any = null;
	private getFilePath: ((fileId: string) => string | undefined) | null = null;
	private getText: ((fileId: string) => { toJSON: () => string } | null | undefined) | null = null;
	private maxSizeBytes: number;
	private pendingDb: PendingEditsDb;

	constructor(
		store: EditHistoryStore,
		getDeviceName: () => string,
		settings: CaptureSettings,
		maxSizeBytes: number = 1_000_000,
		pendingDb: PendingEditsDb,
	) {
		this.store = store;
		this.getDeviceName = getDeviceName;
		this.settings = settings;
		this.maxSizeBytes = maxSizeBytes;
		this.pendingDb = pendingDb;
	}

	start(
		idToText: any,
		getFilePath: (fileId: string) => string | undefined,
		getText: (fileId: string) => { toJSON: () => string } | null | undefined,
	): void {
		this.idToText = idToText;
		this.getFilePath = getFilePath;
		this.getText = getText;

		this.observeDeepHandler = (events: any) => {
			this.onIdToTextObserveDeep(events);
		};
		idToText.observeDeep(this.observeDeepHandler);
	}

	stop(): void {
		if (this.observeDeepHandler && this.idToText) {
			this.idToText.unobserveDeep(this.observeDeepHandler);
		}
		this.observeDeepHandler = null;
		this.idToText = null;
		this.getFilePath = null;
		this.getText = null;
		for (const { idle, max } of this.pendingTimers.values()) {
			clearTimeout(idle);
			if (max) clearTimeout(max);
		}
		this.pendingTimers.clear();
	}

	scheduleCapture(fileId: string, path: string, content: string): void {
		this.pendingDb.put({ fileId, path, content, ts: Date.now() }).catch((e) => {
			logWarn("editHistoryCapture: failed to write pending edit to IndexedDB", e);
		});

		const existing = this.pendingTimers.get(fileId);

		// Always reset the idle timer
		if (existing) clearTimeout(existing.idle);
		const idle = setTimeout(() => this.fireCapture(fileId), this.settings.debounceMs);

		if (existing) {
			// Mid-burst: keep the existing max timer and firstScheduledAt intact
			this.pendingTimers.set(fileId, {
				idle,
				max: existing.max,
				firstScheduledAt: existing.firstScheduledAt,
			});
		} else {
			// First edit in a new burst: arm the max timer
			const max = setTimeout(() => this.fireCapture(fileId), this.settings.maxWaitMs);
			this.pendingTimers.set(fileId, {
				idle,
				max,
				firstScheduledAt: Date.now(),
			});
		}
	}

	private fireCapture(fileId: string): void {
		const timer = this.pendingTimers.get(fileId);
		if (!timer) return;
		clearTimeout(timer.idle);
		if (timer.max) clearTimeout(timer.max);
		this.pendingTimers.delete(fileId);
		void this.promoteFromDb(fileId);
	}

	async flush(): Promise<void> {
		for (const { idle, max } of this.pendingTimers.values()) {
			clearTimeout(idle);
			if (max) clearTimeout(max);
		}
		this.pendingTimers.clear();

		const all = await this.pendingDb.getAll();
		await this.batchCapture(all);
		await this.pendingDb.clear();
	}

	async recoverOrphans(): Promise<void> {
		const all = await this.pendingDb.getAll();
		await this.batchCapture(all);
		await this.pendingDb.clear();
	}

	private async batchCapture(edits: Array<{ fileId: string; path: string; content: string }>): Promise<void> {
		const accepted: string[] = [];
		await this.store.transaction((data) => {
			for (const edit of edits) {
				if (edit.content.length > this.maxSizeBytes) continue;
				if (!this.isWithinDailyLimit(edit.fileId)) continue;

				const entry = data.entries[edit.fileId];
				if (!entry) {
					const enc = encodeContent(edit.content);
					data.entries[edit.fileId] = {
						path: edit.path,
						baseIndex: 0,
						versions: [{ ts: Date.now(), device: this.getDeviceName(), content: enc.content, contentEnc: enc.contentEnc }],
					};
					accepted.push(edit.fileId);
					continue;
				}

				const lastContent = reconstructVersion(entry, entry.versions.length - 1);
				if (lastContent === edit.content) continue;

				entry.path = edit.path;
				const versionsSinceBase = entry.versions.length - entry.baseIndex;
				if (versionsSinceBase >= this.settings.rebaseInterval || lastContent === null) {
					const enc = encodeContent(edit.content);
					entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), content: enc.content, contentEnc: enc.contentEnc });
					entry.baseIndex = entry.versions.length - 1;
				} else {
					const hunks = computeLineHunks(lastContent, edit.content);
					entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), hunks });
				}
				accepted.push(edit.fileId);
			}
		});
		for (const fileId of accepted) this.incrementDailyCount(fileId);
	}

	private async promoteFromDb(fileId: string): Promise<void> {
		const pending = await this.pendingDb.get(fileId);
		if (!pending) return;
		try {
			await this.captureSnapshot(fileId, pending.path, pending.content);
			await this.pendingDb.remove(fileId);
		} catch (e) {
			logWarn(
				"editHistoryCapture: promoteFromDb failed, keeping pending edit for recovery",
				e,
			);
		}
	}

	async captureSnapshot(
		fileId: string,
		path: string,
		content: string,
	): Promise<void> {
		if (content.length > this.maxSizeBytes) return;
		if (!this.isWithinDailyLimit(fileId)) return;

		let didAdd = false;
		await this.store.transaction((data) => {
			const entry = data.entries[fileId];

			if (!entry) {
				const enc = encodeContent(content);
				data.entries[fileId] = {
					path,
					baseIndex: 0,
					versions: [{ ts: Date.now(), device: this.getDeviceName(), content: enc.content, contentEnc: enc.contentEnc }],
				};
				didAdd = true;
				return;
			}

			const lastContent = reconstructVersion(entry, entry.versions.length - 1);
			if (lastContent === content) return;

			entry.path = path;
			const versionsSinceBase = entry.versions.length - entry.baseIndex;
			if (versionsSinceBase >= this.settings.rebaseInterval || lastContent === null) {
				const enc = encodeContent(content);
				entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), content: enc.content, contentEnc: enc.contentEnc });
				entry.baseIndex = entry.versions.length - 1;
			} else {
				const hunks = computeLineHunks(lastContent, content);
				entry.versions.push({ ts: Date.now(), device: this.getDeviceName(), hunks });
			}
			didAdd = true;
		});

		if (didAdd) this.incrementDailyCount(fileId);
	}

	private isWithinDailyLimit(fileId: string): boolean {
		const today = new Date().toISOString().slice(0, 10);
		const counter = this.dailyCounts.get(fileId);
		if (!counter || counter.date !== today) return true;
		return counter.count < this.settings.maxPerFilePerDay;
	}

	private incrementDailyCount(fileId: string): void {
		const today = new Date().toISOString().slice(0, 10);
		const counter = this.dailyCounts.get(fileId);
		if (!counter || counter.date !== today) {
			this.dailyCounts.set(fileId, { date: today, count: 1 });
		} else {
			counter.count++;
		}
	}

	private onIdToTextObserveDeep(events: any[]): void {
		if (!this.getFilePath || !this.getText) return;

		const fileIds = new Set<string>();

		for (const event of events) {
			const eventPath: unknown[] = event.path;
			if (eventPath && eventPath.length >= 1) {
				// Text-level change inside the map: path[0] is the fileId
				fileIds.add(eventPath[0] as string);
			} else {
				// Map-level change (key added/removed): iterate event.keys
				const changedKeys: Map<string, unknown> | undefined = event.keys;
				if (changedKeys) {
					for (const [fileId] of changedKeys) {
						fileIds.add(fileId);
					}
				}
			}
		}

		for (const fileId of fileIds) {
			const yText = this.getText(fileId);
			if (!yText) continue;

			const path = this.getFilePath(fileId);
			if (!path) continue;

			const content = yText.toJSON();
			this.scheduleCapture(fileId, path, content);
		}
	}
}

import type { EditHistoryStore } from "./editHistoryStore";
import { computeDiff, reconstructVersion } from "./editHistoryDiff";
import type { VersionSnapshot } from "./types";
import type { PendingEditsDb } from "./pendingEditsDb";
import { logWarn } from "../logger";

export interface CaptureSettings {
	rebaseInterval: number;
	maxPerFilePerDay: number;
	debounceMs: number;
}

export class EditHistoryCapture {
	private store: EditHistoryStore;
	private getDeviceName: () => string;
	private settings: CaptureSettings;
	private pendingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private dailyCounts: Map<string, { date: string; count: number }> = new Map();
	private transactionHandler: ((...args: unknown[]) => void) | null = null;
	private observeHandler: ((...args: unknown[]) => void) | null = null;
	private ydoc: any = null;
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
		ydoc: any,
		idToText: any,
		getFilePath: (fileId: string) => string | undefined,
		getText: (fileId: string) => { toJSON: () => string } | null | undefined,
	): void {
		this.ydoc = ydoc;
		this.idToText = idToText;
		this.getFilePath = getFilePath;
		this.getText = getText;

		this.transactionHandler = () => {
			this.onTransaction();
		};
		ydoc.on("afterTransaction", this.transactionHandler);

		this.observeHandler = (event: any) => {
			this.onIdToTextObserve(event);
		};
		idToText.observe(this.observeHandler);
	}

	stop(): void {
		if (this.transactionHandler && this.ydoc) {
			this.ydoc.off("afterTransaction", this.transactionHandler);
		}
		if (this.observeHandler && this.idToText) {
			this.idToText.unobserve(this.observeHandler);
		}
		this.transactionHandler = null;
		this.observeHandler = null;
		this.ydoc = null;
		this.idToText = null;
		this.getFilePath = null;
		this.getText = null;
		for (const timer of this.pendingTimers.values()) {
			clearTimeout(timer);
		}
		this.pendingTimers.clear();
	}

	scheduleCapture(fileId: string, path: string, content: string): void {
		this.pendingDb.put({ fileId, path, content, ts: Date.now() }).catch((e) => {
			logWarn("editHistoryCapture: failed to write pending edit to IndexedDB", e);
		});

		const existing = this.pendingTimers.get(fileId);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.pendingTimers.delete(fileId);
			void this.promoteFromDb(fileId);
		}, this.settings.debounceMs);

		this.pendingTimers.set(fileId, timer);
	}

	async flush(): Promise<void> {
		for (const timer of this.pendingTimers.values()) {
			clearTimeout(timer);
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
		const batch: Array<{ fileId: string; path: string; snapshot: VersionSnapshot }> = [];

		for (const edit of edits) {
			if (edit.content.length > this.maxSizeBytes) continue;
			if (!this.isWithinDailyLimit(edit.fileId)) continue;

			const entry = await this.store.getEntry(edit.fileId);
			let snap: VersionSnapshot | null = null;

			if (!entry) {
				snap = { ts: Date.now(), device: this.getDeviceName(), content: edit.content };
			} else {
				const lastContent = reconstructVersion(entry, entry.versions.length - 1);
				if (lastContent === edit.content) continue;
				const versionsSinceBase = entry.versions.length - entry.baseIndex;
				if (versionsSinceBase >= this.settings.rebaseInterval || lastContent === null) {
					snap = { ts: Date.now(), device: this.getDeviceName(), content: edit.content };
				} else {
					const diff = computeDiff(lastContent, edit.content);
					snap = { ts: Date.now(), device: this.getDeviceName(), diff };
				}
			}

			if (snap) {
				batch.push({ fileId: edit.fileId, path: edit.path, snapshot: snap });
				this.incrementDailyCount(edit.fileId);
			}
		}

		await this.store.addVersions(batch);
	}

	private async promoteFromDb(fileId: string): Promise<void> {
		const pending = await this.pendingDb.get(fileId);
		if (!pending) return;
		await this.pendingDb.remove(fileId);
		await this.captureSnapshot(fileId, pending.path, pending.content);
	}

	async captureSnapshot(
		fileId: string,
		path: string,
		content: string,
	): Promise<void> {
		if (content.length > this.maxSizeBytes) return;
		if (!this.isWithinDailyLimit(fileId)) return;

		const entry = await this.store.getEntry(fileId);

		if (!entry) {
			const snap: VersionSnapshot = {
				ts: Date.now(),
				device: this.getDeviceName(),
				content,
			};
			await this.store.addVersion(fileId, path, snap);
			this.incrementDailyCount(fileId);
			return;
		}

		const lastContent = reconstructVersion(entry, entry.versions.length - 1);
		if (lastContent === content) return;

		const versionsSinceBase = entry.versions.length - entry.baseIndex;
		if (versionsSinceBase >= this.settings.rebaseInterval || lastContent === null) {
			const snap: VersionSnapshot = {
				ts: Date.now(),
				device: this.getDeviceName(),
				content,
			};
			await this.store.addVersion(fileId, path, snap);
			this.incrementDailyCount(fileId);
			return;
		}

		const diff = computeDiff(lastContent, content);
		const snap: VersionSnapshot = {
			ts: Date.now(),
			device: this.getDeviceName(),
			diff,
		};
		await this.store.addVersion(fileId, path, snap);
		this.incrementDailyCount(fileId);
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

	private onTransaction(): void {
	}

	private onIdToTextObserve(event: any): void {
		if (!this.getFilePath || !this.getText) return;

		const changedKeys: Map<string, unknown> = event.keys;
		if (!changedKeys) return;

		for (const [fileId] of changedKeys) {
			const yText = this.getText(fileId);
			if (!yText) continue;

			const path = this.getFilePath(fileId);
			if (!path) continue;

			const content = yText.toJSON();
			this.scheduleCapture(fileId, path, content);
		}
	}
}

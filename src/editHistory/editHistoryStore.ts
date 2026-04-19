import type { Vault } from "obsidian";
import type { EditHistoryData, FileHistoryEntry, VersionSnapshot } from "./types";
import { DEFAULT_EDIT_HISTORY_DATA } from "./types";
import { reconstructVersion } from "./editHistoryDiff";
import { encodeContent } from "./editHistoryCompress";
import { logWarn } from "../logger";

const HISTORY_PATH = ".yaos-extension/edit-history.json";

export class EditHistoryStore {
	private vault: Vault;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(vault: Vault) {
		this.vault = vault;
	}

	private enqueue<T>(op: () => Promise<T>): Promise<T> {
		const next = this.writeQueue.then(op, op);
		// Keep the chain alive without propagating failures into the queue head.
		this.writeQueue = next.then(() => {}, () => {});
		return next;
	}

	async load(): Promise<EditHistoryData> {
		try {
			const exists = await this.vault.adapter.exists(HISTORY_PATH);
			if (!exists) return DEFAULT_EDIT_HISTORY_DATA();
			const raw = await this.vault.adapter.read(HISTORY_PATH);
			const parsed = JSON.parse(raw) as { version?: number };
			if (parsed?.version !== 3) {
				// Breaking format upgrade: silently wipe stale entries.
				const fresh = DEFAULT_EDIT_HISTORY_DATA();
				await this.save(fresh);
				return fresh;
			}
			return parsed as EditHistoryData;
		} catch (e) {
			logWarn("editHistoryStore: failed to load", e);
			return DEFAULT_EDIT_HISTORY_DATA();
		}
	}

	async save(data: EditHistoryData): Promise<void> {
		const dir = ".yaos-extension";
		if (!(await this.vault.adapter.exists(dir))) {
			await this.vault.adapter.mkdir(dir);
		}
		await this.vault.adapter.write(HISTORY_PATH, JSON.stringify(data, null, "\t"));
	}

	/**
	 * Atomically read, mutate, and write the edit history file.
	 * The callback receives the current data; its mutations are flushed to disk
	 * when it resolves. Serialized against all other mutating operations via
	 * the internal write queue.
	 */
	async transaction<T>(fn: (data: EditHistoryData) => T | Promise<T>): Promise<T> {
		return this.enqueue(async () => {
			const data = await this.load();
			const result = await fn(data);
			await this.save(data);
			return result;
		});
	}

	async addVersion(
		fileId: string,
		path: string,
		snapshot: VersionSnapshot,
	): Promise<void> {
		await this.transaction((data) => {
			this.applyVersion(data, fileId, path, snapshot);
		});
	}

	async addVersions(
		entries: Array<{ fileId: string; path: string; snapshot: VersionSnapshot }>,
	): Promise<void> {
		if (entries.length === 0) return;
		await this.transaction((data) => {
			for (const { fileId, path, snapshot } of entries) {
				this.applyVersion(data, fileId, path, snapshot);
			}
		});
	}

	private applyVersion(
		data: EditHistoryData,
		fileId: string,
		path: string,
		snapshot: VersionSnapshot,
	): void {
		if (!data.entries[fileId]) {
			data.entries[fileId] = {
				path,
				baseIndex: 0,
				versions: [snapshot],
			};
		} else {
			const entry = data.entries[fileId]!;
			entry.path = path;
			entry.versions.push(snapshot);
			if (snapshot.content !== undefined) {
				entry.baseIndex = entry.versions.length - 1;
			}
		}
	}

	async getEntry(fileId: string): Promise<FileHistoryEntry | undefined> {
		const data = await this.load();
		return data.entries[fileId];
	}

	async prune(retentionDays: number): Promise<void> {
		await this.transaction((data) => {
			const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

			for (const fileId of Object.keys(data.entries)) {
				const entry = data.entries[fileId]!;

				const firstRecentIdx = entry.versions.findIndex(v => v.ts >= cutoff);
				if (firstRecentIdx === -1) {
					delete data.entries[fileId];
					continue;
				}

				if (firstRecentIdx === 0) continue;

				if (entry.baseIndex < firstRecentIdx) {
					const newBaseContent = reconstructVersion(entry, firstRecentIdx);
					if (newBaseContent !== null) {
						const remaining = entry.versions.slice(firstRecentIdx);
						const { content, contentEnc } = encodeContent(newBaseContent);
						remaining[0] = { ...remaining[0]!, content, contentEnc, hunks: undefined };
						entry.versions = remaining;
						entry.baseIndex = 0;
					} else {
						delete data.entries[fileId];
					}
				} else {
					entry.baseIndex -= firstRecentIdx;
					entry.versions = entry.versions.slice(firstRecentIdx);
				}
			}
		});
	}

	async pruneEntry(fileId: string): Promise<void> {
		await this.transaction((data) => {
			delete data.entries[fileId];
		});
	}
}

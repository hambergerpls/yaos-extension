import type { Vault } from "obsidian";
import type { EditHistoryData, FileHistoryEntry, VersionSnapshot } from "./types";
import { DEFAULT_EDIT_HISTORY_DATA } from "./types";
import { reconstructVersion } from "./editHistoryDiff";
import { logWarn } from "../logger";

const HISTORY_PATH = ".yaos-extension/edit-history.json";

export class EditHistoryStore {
	private vault: Vault;

	constructor(vault: Vault) {
		this.vault = vault;
	}

	async load(): Promise<EditHistoryData> {
		try {
			const exists = await this.vault.adapter.exists(HISTORY_PATH);
			if (!exists) return DEFAULT_EDIT_HISTORY_DATA();
			const raw = await this.vault.adapter.read(HISTORY_PATH);
			return JSON.parse(raw) as EditHistoryData;
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

	async addVersion(
		fileId: string,
		path: string,
		snapshot: VersionSnapshot,
	): Promise<void> {
		const data = await this.load();
		this.applyVersion(data, fileId, path, snapshot);
		await this.save(data);
	}

	async addVersions(
		entries: Array<{ fileId: string; path: string; snapshot: VersionSnapshot }>,
	): Promise<void> {
		if (entries.length === 0) return;
		const data = await this.load();
		for (const { fileId, path, snapshot } of entries) {
			this.applyVersion(data, fileId, path, snapshot);
		}
		await this.save(data);
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
		const data = await this.load();
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
					remaining[0] = { ...remaining[0]!, content: newBaseContent, diff: undefined };
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

		await this.save(data);
	}

	async pruneEntry(fileId: string): Promise<void> {
		const data = await this.load();
		delete data.entries[fileId];
		await this.save(data);
	}
}

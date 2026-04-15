import { ItemView } from "obsidian";
import type { EditHistoryStore } from "./editHistoryStore";
import { reconstructVersion, computeDiffSummary } from "./editHistoryDiff";
import type { FileHistoryEntry, VersionSnapshot } from "./types";

export const EDIT_HISTORY_VIEW_TYPE = "yaos-extension-edit-history";

function formatDate(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function getDeviceInitials(name: string): string {
	return name.split(/[-_\s]/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

export class EditHistoryView extends ItemView {
	private store: EditHistoryStore;
	private onRestore: (content: string) => void;

	constructor(leaf: any, store: EditHistoryStore, onRestore: (content: string) => void) {
		super(leaf);
		this.store = store;
		this.onRestore = onRestore;
	}

	getViewType(): string {
		return EDIT_HISTORY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Edit History";
	}

	getIcon(): string {
		return "history";
	}

	async onOpen(): Promise<void> {}

	async onClose(): Promise<void> {}

	async refresh(fileId: string | null): Promise<void> {
		this.contentEl.empty();

		if (!fileId) {
			this.renderEmpty("No file selected");
			return;
		}

		const entry = await this.store.getEntry(fileId);
		if (!entry || entry.versions.length === 0) {
			this.renderEmpty("No edit history for this file");
			return;
		}

		this.renderHistory(entry);
	}

	private renderEmpty(message: string): void {
		const el = this.contentEl.createDiv({ cls: "yaos-extension-edit-history-empty" });
		el.textContent = message;
	}

	private renderHistory(entry: FileHistoryEntry): void {
		const header = this.contentEl.createDiv({ cls: "yaos-extension-edit-history-file-path" });
		header.textContent = entry.path;

		const sorted = [...entry.versions].reverse();

		const groups = new Map<string, { version: VersionSnapshot; originalIndex: number }[]>();
		for (let i = 0; i < sorted.length; i++) {
			const v = sorted[i]!;
			const originalIndex = entry.versions.indexOf(v);
			const dateKey = formatDate(v.ts);
			if (!groups.has(dateKey)) groups.set(dateKey, []);
			groups.get(dateKey)!.push({ version: v, originalIndex });
		}

		for (const [dateKey, items] of groups) {
			const groupEl = this.contentEl.createDiv({ cls: "yaos-extension-edit-history-date-group" });
			groupEl.createDiv({ cls: "yaos-extension-edit-history-date-header", text: dateKey });

			for (const { version, originalIndex } of items) {
				this.renderEntry(groupEl, entry, version, originalIndex);
			}
		}
	}

	private renderEntry(
		parent: HTMLElement,
		entry: FileHistoryEntry,
		version: VersionSnapshot,
		versionIndex: number,
	): void {
		const el = parent.createDiv({ cls: "yaos-extension-edit-history-entry" });

		const topRow = el.createDiv({ cls: "yaos-extension-edit-history-entry-top" });

		const avatar = topRow.createDiv({ cls: "yaos-extension-edit-history-avatar" });
		avatar.textContent = getDeviceInitials(version.device);

		const deviceEl = topRow.createSpan({ cls: "yaos-extension-edit-history-device" });
		deviceEl.textContent = version.device;

		const timeEl = topRow.createSpan({ cls: "yaos-extension-edit-history-time" });
		timeEl.textContent = formatTime(version.ts);

		if (version.diff) {
			const summary = computeDiffSummary(version.diff);
			const summaryEl = el.createDiv({ cls: "yaos-extension-edit-history-summary" });
			const parts: string[] = [];
			if (summary.added > 0) parts.push(`+${summary.added}`);
			if (summary.removed > 0) parts.push(`-${summary.removed}`);
			summaryEl.textContent = parts.join(" ") + " lines";
		}

		const actions = el.createDiv({ cls: "yaos-extension-edit-history-actions" });
		const restoreBtn = actions.createEl("button", {
			cls: "yaos-extension-edit-history-restore",
			text: "Restore",
		});
		restoreBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const content = reconstructVersion(entry, versionIndex);
			if (content !== null) {
				this.onRestore(content);
			}
		});
	}
}

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

const SESSION_GAP_MS = 5 * 60 * 1000;

interface Session {
	device: string;
	startTs: number;
	endTs: number;
	versions: Array<{ version: VersionSnapshot; originalIndex: number }>;
}

function groupIntoSessions(
	items: Array<{ version: VersionSnapshot; originalIndex: number }>,
): Session[] {
	// items are ordered newest-first
	const sessions: Session[] = [];
	for (const item of items) {
		const last = sessions[sessions.length - 1];
		if (
			last &&
			last.device === item.version.device &&
			last.startTs - item.version.ts <= SESSION_GAP_MS
		) {
			// item is older than last's current oldest; extend the session backward
			last.startTs = item.version.ts;
			last.versions.push(item);
		} else {
			sessions.push({
				device: item.version.device,
				startTs: item.version.ts,
				endTs: item.version.ts,
				versions: [item],
			});
		}
	}
	return sessions;
}

function getSessionId(s: Session): string {
	return `${s.device}-${s.startTs}`;
}

export class EditHistoryView extends ItemView {
	private store: EditHistoryStore;
	private onRestore: (content: string) => void;
	private expandedSessions: Set<string> = new Set();

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

		// Newest-first ordering
		const items: Array<{ version: VersionSnapshot; originalIndex: number }> = [];
		for (let i = entry.versions.length - 1; i >= 0; i--) {
			items.push({ version: entry.versions[i]!, originalIndex: i });
		}

		const sessions = groupIntoSessions(items);

		// Group sessions by calendar date using the NEWEST version's timestamp (endTs)
		const dateGroups = new Map<string, Session[]>();
		for (const s of sessions) {
			const dateKey = formatDate(s.endTs);
			if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, []);
			dateGroups.get(dateKey)!.push(s);
		}

		for (const [dateKey, sessionsForDate] of dateGroups) {
			const groupEl = this.contentEl.createDiv({ cls: "yaos-extension-edit-history-date-group" });
			groupEl.createDiv({ cls: "yaos-extension-edit-history-date-header", text: dateKey });

			for (const session of sessionsForDate) {
				if (session.versions.length === 1) {
					// Single-version session → render as a regular entry (no session chrome)
					const item = session.versions[0]!;
					this.renderEntry(groupEl, entry, item.version, item.originalIndex);
				} else {
					this.renderSession(groupEl, entry, session);
				}
			}
		}
	}

	private renderSession(parent: HTMLElement, entry: FileHistoryEntry, session: Session): void {
		const sessionId = getSessionId(session);
		const sessionEl = parent.createDiv({ cls: "yaos-extension-edit-history-session" });

		const header = sessionEl.createDiv({ cls: "yaos-extension-edit-history-session-header" });

		const avatar = header.createDiv({ cls: "yaos-extension-edit-history-avatar" });
		avatar.textContent = getDeviceInitials(session.device);

		const deviceEl = header.createSpan({ cls: "yaos-extension-edit-history-device" });
		deviceEl.textContent = session.device;

		const timeEl = header.createSpan({ cls: "yaos-extension-edit-history-time" });
		if (session.startTs === session.endTs) {
			timeEl.textContent = formatTime(session.startTs);
		} else {
			timeEl.textContent = `${formatTime(session.startTs)} – ${formatTime(session.endTs)}`;
		}

		const countEl = header.createSpan({ cls: "yaos-extension-edit-history-session-count" });
		countEl.textContent = `${session.versions.length} edits`;

		// Aggregate diff summary across all versions in the session
		let addedTotal = 0;
		let removedTotal = 0;
		for (const { version } of session.versions) {
			if (version.diff) {
				const sum = computeDiffSummary(version.diff);
				addedTotal += sum.added;
				removedTotal += sum.removed;
			}
		}
		if (addedTotal > 0 || removedTotal > 0) {
			const summaryEl = header.createSpan({ cls: "yaos-extension-edit-history-summary" });
			const parts: string[] = [];
			if (addedTotal > 0) parts.push(`+${addedTotal}`);
			if (removedTotal > 0) parts.push(`-${removedTotal}`);
			summaryEl.textContent = parts.join(" ") + " lines";
		}

		const chevron = header.createSpan({ cls: "yaos-extension-edit-history-session-chevron" });
		chevron.textContent = "▸";

		const childrenEl = sessionEl.createDiv({ cls: "yaos-extension-edit-history-session-children" });
		const expanded = this.expandedSessions.has(sessionId);
		if (!expanded) {
			childrenEl.style.display = "none";
		} else {
			chevron.textContent = "▾";
		}

		for (const { version, originalIndex } of session.versions) {
			this.renderEntry(childrenEl, entry, version, originalIndex);
		}

		header.addEventListener("click", () => {
			if (this.expandedSessions.has(sessionId)) {
				this.expandedSessions.delete(sessionId);
				childrenEl.style.display = "none";
				chevron.textContent = "▸";
			} else {
				this.expandedSessions.add(sessionId);
				childrenEl.style.display = "";
				chevron.textContent = "▾";
			}
		});
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

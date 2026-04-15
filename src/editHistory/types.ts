export interface VersionSnapshot {
	ts: number;
	device: string;
	content?: string;
	diff?: [number, string][];
}

export interface FileHistoryEntry {
	path: string;
	baseIndex: number;
	versions: VersionSnapshot[];
}

export interface EditHistoryData {
	version: number;
	entries: Record<string, FileHistoryEntry>;
}

export function DEFAULT_EDIT_HISTORY_DATA(): EditHistoryData {
	return { version: 1, entries: {} };
}

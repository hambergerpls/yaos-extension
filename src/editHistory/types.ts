export interface LineHunk {
	/** 0-indexed line in the reconstructed previous version where deletion starts. */
	s: number;
	/** Number of old lines deleted (consumed from previous version starting at `s`). */
	d: number;
	/** New lines inserted at position `s` (each entry is one line, no trailing `\n`). */
	a: string[];
}

export interface VersionSnapshot {
	ts: number;
	device: string;
	/** Full-text base snapshot. Present on the first version and every rebase. */
	content?: string;
	/** Encoding for `content`. Absent = plain UTF-8; "dfb64" = deflate-raw + base64. */
	contentEnc?: "dfb64";
	/** Line-oriented delta against the immediately preceding version. */
	hunks?: LineHunk[];
}

export interface FileHistoryEntry {
	path: string;
	baseIndex: number;
	versions: VersionSnapshot[];
}

export interface EditHistoryData {
	version: 3;
	entries: Record<string, FileHistoryEntry>;
}

export function DEFAULT_EDIT_HISTORY_DATA(): EditHistoryData {
	return { version: 3, entries: {} };
}

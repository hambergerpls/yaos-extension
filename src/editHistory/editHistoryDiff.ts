import diff from "fast-diff";
import type { FileHistoryEntry } from "./types";

export type DiffOp = [number, string];
export interface DiffSummary {
	added: number;
	removed: number;
}

export function computeDiff(oldContent: string, newContent: string): DiffOp[] {
	return diff(oldContent, newContent);
}

export function applyDiff(baseContent: string, diffs: DiffOp[]): string {
	let result = "";
	for (const [op, text] of diffs) {
		if (op === 0) {
			result += text;
		} else if (op === 1) {
			result += text;
		}
	}
	return result;
}

export function reconstructVersion(
	entry: FileHistoryEntry,
	versionIndex: number,
): string | null {
	if (versionIndex < 0 || versionIndex >= entry.versions.length) return null;

	const base = entry.versions[entry.baseIndex];
	if (!base || base.content === undefined) return null;

	let content = base.content;
	for (let i = entry.baseIndex + 1; i <= versionIndex; i++) {
		const version = entry.versions[i];
		if (!version || !version.diff) return null;
		content = applyDiff(content, version.diff);
	}
	return content;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export function computeDiffSummary(diffs: DiffOp[]): DiffSummary {
	let added = 0;
	let removed = 0;
	for (const [op, text] of diffs) {
		if (text.length === 0) continue;
		const lines = countLines(text);
		if (op === 1) added += lines;
		else if (op === -1) removed += lines;
	}
	return { added, removed };
}

export type DiffLine =
	| { kind: "retain"; text: string }
	| { kind: "add"; text: string }
	| { kind: "del"; text: string };

export function segmentLines(ops: DiffOp[]): DiffLine[] {
	const result: DiffLine[] = [];
	let oldBuf = "";
	let newBuf = "";

	const flush = () => {
		if (oldBuf === newBuf) {
			if (oldBuf !== "") result.push({ kind: "retain", text: oldBuf });
		} else if (oldBuf === "") {
			result.push({ kind: "add", text: newBuf });
		} else if (newBuf === "") {
			result.push({ kind: "del", text: oldBuf });
		} else {
			result.push({ kind: "del", text: oldBuf });
			result.push({ kind: "add", text: newBuf });
		}
		oldBuf = "";
		newBuf = "";
	};

	for (const [op, text] of ops) {
		for (const ch of text) {
			if (ch === "\n") {
				flush();
				continue;
			}
			if (op === 0) {
				oldBuf += ch;
				newBuf += ch;
			} else if (op === 1) {
				newBuf += ch;
			} else if (op === -1) {
				oldBuf += ch;
			}
		}
	}
	flush();

	return result;
}

export type HunkItem =
	| { kind: "hunk"; lines: DiffLine[] }
	| { kind: "skip"; count: number };

export const DEFAULT_CONTEXT_LINES = 3;

export function buildHunks(lines: DiffLine[], context: number): HunkItem[] {
	const changeIdx: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i]!.kind !== "retain") changeIdx.push(i);
	}
	if (changeIdx.length === 0) return [];

	const keep = new Array<boolean>(lines.length).fill(false);
	for (const i of changeIdx) {
		const lo = Math.max(0, i - context);
		const hi = Math.min(lines.length - 1, i + context);
		for (let j = lo; j <= hi; j++) keep[j] = true;
	}

	const items: HunkItem[] = [];
	let i = 0;
	while (i < lines.length) {
		if (keep[i]) {
			const start = i;
			while (i < lines.length && keep[i]) i++;
			items.push({ kind: "hunk", lines: lines.slice(start, i) });
		} else {
			const start = i;
			while (i < lines.length && !keep[i]) i++;
			items.push({ kind: "skip", count: i - start });
		}
	}
	return items;
}

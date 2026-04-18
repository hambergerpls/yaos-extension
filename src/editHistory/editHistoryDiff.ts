import DiffMatchPatch from "diff-match-patch";
import type { FileHistoryEntry, LineHunk } from "./types";

export type { LineHunk } from "./types";

export interface DiffSummary {
	added: number;
	removed: number;
}

export function computeLineHunks(oldContent: string, newContent: string): LineHunk[] {
	// Work in the "split on \n" line convention so trailing-newline differences
	// round-trip correctly: "a\n".split("\n") === ["a", ""] is the canonical
	// line array. We hash each unique line to a single Unicode char and run
	// dmp.diff_main on the hashed strings (dmp's built-in diff_linesToChars_
	// keeps the "\n" attached to each line, which collapses "a" vs "a\n" into
	// a single token and corrupts trailing-newline semantics).
	const oldLines = oldContent === "" ? [] : oldContent.split("\n");
	const newLines = newContent === "" ? [] : newContent.split("\n");

	const lineMap = new Map<string, string>();
	const lineArray: string[] = [];
	const encode = (lines: string[]): string => {
		let result = "";
		for (const line of lines) {
			let ch = lineMap.get(line);
			if (ch === undefined) {
				ch = String.fromCharCode(lineArray.length + 1);
				lineMap.set(line, ch);
				lineArray.push(line);
			}
			result += ch;
		}
		return result;
	};
	const oldHash = encode(oldLines);
	const newHash = encode(newLines);

	const dmp: any = new (DiffMatchPatch as any)();
	const diffs = dmp.diff_main(oldHash, newHash, false);

	const hunks: LineHunk[] = [];
	let oldLineCursor = 0;
	let i = 0;

	while (i < diffs.length) {
		const [op, text] = diffs[i] as [number, string];
		// Retain: just advance the cursor (one char == one line in hashed form).
		if (op === 0) {
			oldLineCursor += text.length;
			i++;
			continue;
		}
		// Start of a change run. Collect consecutive -1/+1 ops.
		const hunkStart = oldLineCursor;
		let deleted = 0;
		const added: string[] = [];
		while (i < diffs.length && (diffs[i]![0] === -1 || diffs[i]![0] === 1)) {
			const [op2, text2] = diffs[i] as [number, string];
			if (op2 === -1) {
				deleted += text2.length;
			} else {
				for (const ch of text2) added.push(lineArray[ch.charCodeAt(0) - 1]!);
			}
			i++;
		}
		oldLineCursor += deleted;
		hunks.push({ s: hunkStart, d: deleted, a: added });
	}

	return hunks;
}

export function applyLineHunks(base: string, hunks: LineHunk[]): string {
	// Split preserving the convention that a trailing "\n" appears as a final "" element.
	const baseLines = base === "" ? [] : base.split("\n");

	const out: string[] = [];
	let cursor = 0;
	for (const h of hunks) {
		// Copy retained lines before this hunk.
		for (let i = cursor; i < h.s; i++) out.push(baseLines[i]!);
		// Skip d old lines.
		cursor = h.s + h.d;
		// Emit added lines.
		for (const line of h.a) out.push(line);
	}
	// Copy trailing retained lines.
	for (let i = cursor; i < baseLines.length; i++) out.push(baseLines[i]!);

	return out.join("\n");
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
		if (!version || !version.hunks) return null;
		content = applyLineHunks(content, version.hunks);
	}
	return content;
}

export function computeDiffSummary(hunks: LineHunk[]): DiffSummary {
	let added = 0;
	let removed = 0;
	for (const h of hunks) {
		added += h.a.length;
		removed += h.d;
	}
	return { added, removed };
}

export type DiffLine =
	| { kind: "retain"; text: string }
	| { kind: "add"; text: string }
	| { kind: "del"; text: string };

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

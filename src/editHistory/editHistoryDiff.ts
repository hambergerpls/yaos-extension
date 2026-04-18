import DiffMatchPatch from "diff-match-patch";
import type { FileHistoryEntry, LineHunk } from "./types";

export type { LineHunk } from "./types";

export interface DiffSummary {
	added: number;
	removed: number;
}

export function computeLineHunks(oldContent: string, newContent: string): LineHunk[] {
	const dmp: any = new (DiffMatchPatch as any)();
	const conv = dmp.diff_linesToChars_(oldContent, newContent);
	const diffs = dmp.diff_main(conv.chars1, conv.chars2, false);
	dmp.diff_charsToLines_(diffs, conv.lineArray);

	const hunks: LineHunk[] = [];
	let oldLineCursor = 0;
	let i = 0;

	while (i < diffs.length) {
		const [op, text] = diffs[i] as [number, string];
		// Retain: just advance the cursor.
		if (op === 0) {
			oldLineCursor += countLinesInChunk(text);
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
				deleted += countLinesInChunk(text2);
			} else {
				for (const line of splitIntoLines(text2)) added.push(line);
			}
			i++;
		}
		oldLineCursor += deleted;
		hunks.push({ s: hunkStart, d: deleted, a: added });
	}

	return hunks;
}

/**
 * Count how many *lines* are in a multi-line chunk returned by
 * diff_charsToLines_. The chunk is a concatenation of full lines,
 * each ending in "\n" — EXCEPT possibly the final line if the source
 * had no trailing newline.
 *
 * Example: "a\nb\n" → 2 lines. "a\nb" → 2 lines. "" → 0 lines.
 */
function countLinesInChunk(text: string): number {
	if (text.length === 0) return 0;
	let n = 0;
	for (const ch of text) if (ch === "\n") n++;
	if (!text.endsWith("\n")) n++;
	return n;
}

/**
 * Split a multi-line chunk into individual line strings without trailing "\n".
 * "a\nb\n" → ["a", "b"]. "a\nb" → ["a", "b"]. "" → [].
 */
function splitIntoLines(text: string): string[] {
	if (text.length === 0) return [];
	const parts = text.split("\n");
	// If the chunk ends in "\n", split produces a trailing "" we drop.
	if (text.endsWith("\n")) parts.pop();
	return parts;
}

export function applyLineHunks(_base: string, _hunks: LineHunk[]): string {
	throw new Error("not implemented");
}

export function reconstructVersion(
	_entry: FileHistoryEntry,
	_versionIndex: number,
): string | null {
	throw new Error("not implemented");
}

export function computeDiffSummary(_hunks: LineHunk[]): DiffSummary {
	throw new Error("not implemented");
}

export type DiffLine =
	| { kind: "retain"; text: string }
	| { kind: "add"; text: string }
	| { kind: "del"; text: string };

export type HunkItem =
	| { kind: "hunk"; lines: DiffLine[] }
	| { kind: "skip"; count: number };

export const DEFAULT_CONTEXT_LINES = 3;

export function buildHunks(_lines: DiffLine[], _context: number): HunkItem[] {
	throw new Error("not implemented");
}

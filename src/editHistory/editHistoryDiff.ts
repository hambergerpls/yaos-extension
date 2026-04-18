import DiffMatchPatch from "diff-match-patch";
import type { FileHistoryEntry, LineHunk } from "./types";

export type { LineHunk } from "./types";

export interface DiffSummary {
	added: number;
	removed: number;
}

export function computeLineHunks(_oldContent: string, _newContent: string): LineHunk[] {
	throw new Error("not implemented");
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

// silence unused-import lint temporarily
void DiffMatchPatch;

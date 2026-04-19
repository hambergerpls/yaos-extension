import type { Vault } from "obsidian";
import type { EditHistoryData, FileHistoryEntry, VersionSnapshot } from "./types";
import { listAllHistoryFiles } from "./editHistoryStore";
import { reconstructVersion } from "./editHistoryDiff";
import { logWarn } from "../logger";

/**
 * A merged, cross-device view of a single fileId's history.
 *
 * `versions` is the full timeline ordered by `ts` ascending. Each entry also
 * carries the `deviceId` (filename stem) it came from and its absolute
 * reconstructed content, computed inside its own device-local delta chain.
 *
 * We pre-reconstruct per device (not per-merged-timeline) because `hunks` are
 * relative to the preceding version in the same device's file. Interleaving
 * versions from two devices would make deltas un-applicable.
 */
export interface MergedEntry {
	path: string;
	versions: VersionSnapshot[];
	/** Absolute content for each `versions[i]`, same length. */
	absoluteContents: Array<string | null>;
	/** Device filename stem (e.g. "alpha" from edit-history-alpha.json) per version. */
	sourceDeviceIds: string[];
}

function deriveDeviceIdFromFilename(path: string): string {
	const slash = path.lastIndexOf("/");
	const name = slash >= 0 ? path.slice(slash + 1) : path;
	if (name === "edit-history.json") return "legacy";
	const m = /^edit-history-(.+)\.json$/.exec(name);
	return m?.[1] ?? "unknown";
}

export async function loadMergedEntry(
	vault: Vault,
	fileId: string,
): Promise<MergedEntry | null> {
	const files = await listAllHistoryFiles(vault);
	if (files.length === 0) return null;

	interface PerDevice {
		deviceId: string;
		entry: FileHistoryEntry;
	}
	const perDevice: PerDevice[] = [];
	let mergedPath: string | null = null;

	for (const filePath of files) {
		try {
			const raw = await vault.adapter.read(filePath);
			const parsed = JSON.parse(raw) as EditHistoryData;
			if (parsed?.version !== 3) continue;
			const entry = parsed.entries?.[fileId];
			if (!entry) continue;
			perDevice.push({
				deviceId: deriveDeviceIdFromFilename(filePath),
				entry,
			});
			if (!mergedPath) mergedPath = entry.path;
		} catch (e) {
			logWarn(`editHistoryMerge: failed to read ${filePath}`, e);
		}
	}

	if (perDevice.length === 0) return null;

	interface Flat {
		ts: number;
		version: VersionSnapshot;
		absolute: string | null;
		deviceId: string;
	}
	const flat: Flat[] = [];
	for (const { deviceId, entry } of perDevice) {
		for (let i = 0; i < entry.versions.length; i++) {
			const version = entry.versions[i]!;
			const absolute = reconstructVersion(entry, i);
			flat.push({ ts: version.ts, version, absolute, deviceId });
		}
	}

	flat.sort((a, b) => a.ts - b.ts);

	return {
		path: mergedPath ?? "",
		versions: flat.map((f) => f.version),
		absoluteContents: flat.map((f) => f.absolute),
		sourceDeviceIds: flat.map((f) => f.deviceId),
	};
}

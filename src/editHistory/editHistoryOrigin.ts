/**
 * Decide whether a Yjs transaction originated locally (this device) or
 * was applied by the y-websocket provider from a remote peer.
 *
 * The YAOS sync plugin (and y-websocket in general) applies remote updates
 * with `txn.origin === provider`. Local editor keystrokes use y-codemirror's
 * YSyncConfig object, local disk-sync uses the string "disk-sync", etc.
 *
 * We only care about one distinction for edit history: is this a remote
 * update? Remote = reference-equal to the provider. Everything else is
 * treated as local so we don't drop disk-originated or seed-originated
 * edits that should still show up in the timeline.
 */
export function isLocalOrigin(origin: unknown, provider: unknown): boolean {
	// `null`/`undefined` provider means "no provider reference known" — treat
	// every origin as local rather than fail-closed matching null origins.
	if (provider != null && origin === provider) return false;
	return true;
}

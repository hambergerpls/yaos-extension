import { App } from "obsidian";

export interface AwarenessLike {
  clientID: number;
  states: Map<number, Record<string, unknown>>;
  getStates(): Map<number, Record<string, unknown>>;
  getLocalState(): Record<string, unknown> | null;
  on(event: "change" | "update", handler: (data: AwarenessChangeData, origin: unknown) => void): void;
  off(event: "change" | "update", handler: (data: AwarenessChangeData, origin: unknown) => void): void;
}

export interface AwarenessChangeData {
  added: number[];
  updated: number[];
  removed: number[];
}

export interface AwarenessUser {
  name: string;
  color: string;
  colorLight: string;
}

export interface RemotePeer {
  clientId: number;
  name: string;
  color: string;
  colorLight: string;
  hasCursor: boolean;
}

function getYaosPlugin(app: App): unknown | null {
  try {
    return (app as any).plugins?.getPlugin("yaos") ?? null;
  } catch {
    return null;
  }
}

export function getAwareness(app: App): AwarenessLike | null {
  const plugin = getYaosPlugin(app);
  if (!plugin) return null;

  const vaultSync = (plugin as any)?.vaultSync;
  if (!vaultSync) return null;

  const provider = vaultSync.provider;
  if (!provider) return null;

  const awareness = provider.awareness;
  if (!awareness || typeof awareness.getStates !== "function") return null;

  return awareness as AwarenessLike;
}

export function isYaosAvailable(app: App): boolean {
  return getYaosPlugin(app) !== null;
}

export function isYaosConnected(app: App): boolean {
  const plugin = getYaosPlugin(app);
  if (!plugin) return false;
  const vaultSync = (plugin as any)?.vaultSync;
  if (!vaultSync) return false;
  const provider = vaultSync.provider;
  if (!provider) return false;
  return !!provider.wsconnected;
}

export function getRemotePeers(awareness: AwarenessLike): RemotePeer[] {
  const localClientId = awareness.clientID;
  const peers: RemotePeer[] = [];

  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === localClientId) continue;
    const user = state.user as AwarenessUser | undefined;
    const cursor = state.cursor as { anchor: unknown; head: unknown } | null | undefined;

    peers.push({
      clientId,
      name: user?.name || "Anonymous",
      color: user?.color || "#30bced",
      colorLight: user?.colorLight || "#30bced33",
      hasCursor: cursor != null && cursor.anchor != null && cursor.head != null,
    });
  }

  return peers;
}

export function getLocalDeviceName(app: App): string {
  const plugin = getYaosPlugin(app);
  if (!plugin) return "Unknown";
  const settings = (plugin as any)?.settings;
  return settings?.deviceName || "Unknown";
}

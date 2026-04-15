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

export interface DeviceRecord {
  firstSeen: number;
  lastSeen: number;
  color: string;
}

export interface KnownDevice {
  name: string;
  color: string;
  colorLight: string;
  online: boolean;
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

export interface VaultSyncLike {
  ydoc: unknown;
  provider: unknown;
  awareness: unknown;
  idToText: unknown;
  meta: unknown;
  getFileId(path: string): string | undefined;
}

export function getYDoc(app: App): unknown | null {
  const plugin = getYaosPlugin(app);
  if (!plugin) return null;
  const vaultSync = (plugin as any)?.vaultSync;
  if (!vaultSync) return null;
  return vaultSync.ydoc ?? null;
}

export function getVaultSync(app: App): VaultSyncLike | null {
  const plugin = getYaosPlugin(app);
  if (!plugin) return null;
  const vaultSync = (plugin as any)?.vaultSync;
  if (!vaultSync) return null;
  return vaultSync as VaultSyncLike;
}

export function getFileId(app: App, path: string): string | undefined {
  const vaultSync = getVaultSync(app);
  if (!vaultSync || typeof vaultSync.getFileId !== "function") return undefined;
  return vaultSync.getFileId(path);
}

export function getFilePath(app: App, fileId: string): string | undefined {
  const vaultSync = getVaultSync(app);
  if (!vaultSync?.meta) return undefined;
  const meta = vaultSync.meta as any;
  if (typeof meta.get !== "function") return undefined;
  const entry = meta.get(fileId);
  return entry?.path;
}

export function getAllKnownDevices(
  app: App,
  awareness: AwarenessLike | null,
  registry: Record<string, DeviceRecord> | null,
): KnownDevice[] {
  const onlinePeers = awareness ? getRemotePeers(awareness) : [];
  const onlineNames = new Set(onlinePeers.map(p => p.name));

  const devices: KnownDevice[] = [];

  for (const peer of onlinePeers) {
    devices.push({
      name: peer.name,
      color: peer.color,
      colorLight: peer.colorLight,
      online: true,
      hasCursor: peer.hasCursor,
    });
  }

  if (registry) {
    const localName = getLocalDeviceName(app);
    for (const [name, record] of Object.entries(registry)) {
      if (onlineNames.has(name)) continue;
      if (name === localName) continue;
      devices.push({
        name,
        color: record.color,
        colorLight: record.color + "33",
        online: false,
        hasCursor: false,
      });
    }
  }

  return devices;
}

import { Vault } from "obsidian";

export interface DeviceRecord {
  firstSeen: number;
  lastSeen: number;
  color: string;
}

export type DeviceRegistry = Record<string, DeviceRecord>;

const DEVICE_FILE = ".yaos-extension/devices.json";
const DEVICE_FOLDER = ".yaos-extension";

export class DeviceStore {
  private vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  async load(): Promise<DeviceRegistry> {
    try {
      const data = await this.vault.adapter.read(DEVICE_FILE);
      const parsed = JSON.parse(data);
      return parsed.devices ?? {};
    } catch {
      return {};
    }
  }

  async save(registry: DeviceRegistry): Promise<void> {
    const exists = await this.vault.adapter.exists(DEVICE_FOLDER);
    if (!exists) {
      await this.vault.adapter.mkdir(DEVICE_FOLDER);
    }
    const data = JSON.stringify({ devices: registry }, null, 2);
    await this.vault.adapter.write(DEVICE_FILE, data);
  }

  async registerDevice(name: string, color: string): Promise<void> {
    const registry = await this.load();
    const now = Date.now();
    if (registry[name]) {
      registry[name].lastSeen = now;
      registry[name].color = color;
    } else {
      registry[name] = { firstSeen: now, lastSeen: now, color };
    }
    await this.save(registry);
  }
}

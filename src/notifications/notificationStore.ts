import { Vault } from "obsidian";
import type { Notification } from "./types";
import { log } from "../logger";

const NOTIFICATIONS_FOLDER = ".yaos-extension";
const NOTIFICATIONS_FILE = `${NOTIFICATIONS_FOLDER}/notifications.jsonl`;

export interface LocalNotificationState {
  readNotificationIds: string[];
}

export class NotificationStore {
  private vault: Vault;
  private loadData: () => Promise<LocalNotificationState>;
  private saveData: (data: LocalNotificationState) => Promise<void>;
  private readIds: Set<string> = new Set();
  private initialized = false;

  constructor(
    vault: Vault,
    loadData: () => Promise<LocalNotificationState>,
    saveData: (data: LocalNotificationState) => Promise<void>,
  ) {
    this.vault = vault;
    this.loadData = loadData;
    this.saveData = saveData;
  }

  async init(): Promise<void> {
    const state = await this.loadData();
    this.readIds = new Set(state.readNotificationIds ?? []);
    this.initialized = true;
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error("NotificationStore not initialized. Call init() first.");
    }
  }

  private async ensureFolder(): Promise<void> {
    const exists = await this.vault.adapter.exists(NOTIFICATIONS_FOLDER);
    if (!exists) {
      await this.vault.adapter.mkdir(NOTIFICATIONS_FOLDER);
    }
  }

  async addNotification(notification: Notification): Promise<void> {
    await this.ensureFolder();
    const line = JSON.stringify(notification) + "\n";
    log("notificationStore.addNotification: kind=%s target=%s from=%s id=%s", notification.kind, notification.targetDevice, notification.fromDevice, notification.id);
    await this.vault.adapter.append(NOTIFICATIONS_FILE, line);
  }

  async getAllNotifications(): Promise<Notification[]> {
    let raw: string;
    try {
      raw = await this.vault.adapter.read(NOTIFICATIONS_FILE);
    } catch {
      return [];
    }
    if (!raw || raw.trim() === "") return [];

    const notifications: Notification[] = [];
    const lines = raw.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        const parsed = JSON.parse(trimmed) as Notification;
        if (parsed.type === "notification") {
          notifications.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return notifications;
  }

  async getNotificationsForDevice(deviceName: string): Promise<Notification[]> {
    const all = await this.getAllNotifications();
    return all.filter(n => n.targetDevice === deviceName);
  }

  async getUnreadCount(deviceName: string): Promise<number> {
    this.ensureInit();
    const deviceNotifs = await this.getNotificationsForDevice(deviceName);
    return deviceNotifs.filter(n => !this.readIds.has(n.id)).length;
  }

  async markAsRead(notificationId: string): Promise<void> {
    this.ensureInit();
    if (!this.readIds.has(notificationId)) {
      this.readIds.add(notificationId);
      await this.saveData({ readNotificationIds: [...this.readIds] });
    }
  }

  async markAllAsRead(deviceName: string): Promise<void> {
    this.ensureInit();
    const deviceNotifs = await this.getNotificationsForDevice(deviceName);
    for (const notif of deviceNotifs) {
      this.readIds.add(notif.id);
    }
    await this.saveData({ readNotificationIds: [...this.readIds] });
  }

  isRead(notificationId: string): boolean {
    this.ensureInit();
    return this.readIds.has(notificationId);
  }
}

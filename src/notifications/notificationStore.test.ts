import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationStore } from "./notificationStore";
import type { Notification } from "./types";
import type { LocalNotificationState } from "./notificationStore";

function makeVault(files: Record<string, string>) {
  return {
    adapter: {
      exists: vi.fn(async (path: string) => path in files),
      mkdir: vi.fn(async (path: string) => { files[path] = ""; }),
      read: vi.fn(async (path: string) => {
        if (!(path in files)) throw new Error("File not found");
        return files[path];
      }),
      write: vi.fn(async (path: string, data: string) => { files[path] = data; }),
      append: vi.fn(async (path: string, data: string) => {
        if (path in files) {
          files[path] += data;
        } else {
          files[path] = data;
        }
      }),
    },
  } as any;
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    type: "notification",
    id: "notif-1",
    kind: "mention",
    commentId: "comment-1",
    fileId: "notes/my-note.md",
    fromDevice: "Alice",
    targetDevice: "Bob",
    createdAt: 1000,
    preview: "take a look at this",
    ...overrides,
  };
}

describe("NotificationStore", () => {
  let loadData: ReturnType<typeof vi.fn<() => Promise<LocalNotificationState>>>;
  let saveData: ReturnType<typeof vi.fn<(data: LocalNotificationState) => Promise<void>>>;

  beforeEach(() => {
    loadData = vi.fn<() => Promise<LocalNotificationState>>().mockResolvedValue({ readNotificationIds: [] });
    saveData = vi.fn<(data: LocalNotificationState) => Promise<void>>().mockResolvedValue(undefined);
  });

  function createStore(vault: any) {
    return new NotificationStore(vault, loadData, saveData);
  }

  describe("addNotification", () => {
    it("appends a notification to the JSONL file", async () => {
      const vault = makeVault({ ".yaos-extension/notifications.jsonl": "" });
      const store = createStore(vault);
      const notif = makeNotification();

      await store.addNotification(notif);

      const written = vault.adapter.append.mock.calls[0];
      expect(written[0]).toBe(".yaos-extension/notifications.jsonl");
      const parsed = JSON.parse(written[1]);
      expect(parsed.type).toBe("notification");
      expect(parsed.id).toBe("notif-1");
    });

    it("creates the folder if needed", async () => {
      const vault = makeVault({});
      const store = createStore(vault);
      const notif = makeNotification();

      await store.addNotification(notif);

      expect(vault.adapter.mkdir).toHaveBeenCalledWith(".yaos-extension");
    });
  });

  describe("getAllNotifications", () => {
    it("returns all notifications from the JSONL file", async () => {
      const n1 = makeNotification({ id: "n1" });
      const n2 = makeNotification({ id: "n2", createdAt: 2000 });
      const jsonl = JSON.stringify(n1) + "\n" + JSON.stringify(n2) + "\n";
      const vault = makeVault({ ".yaos-extension/notifications.jsonl": jsonl });
      const store = createStore(vault);

      const notifications = await store.getAllNotifications();
      expect(notifications).toHaveLength(2);
    });

    it("returns empty array when file does not exist", async () => {
      const vault = makeVault({});
      const store = createStore(vault);

      const notifications = await store.getAllNotifications();
      expect(notifications).toEqual([]);
    });

    it("skips malformed lines", async () => {
      const n1 = makeNotification({ id: "n1" });
      const jsonl = "not json\n" + JSON.stringify(n1) + "\n";
      const vault = makeVault({ ".yaos-extension/notifications.jsonl": jsonl });
      const store = createStore(vault);

      const notifications = await store.getAllNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.id).toBe("n1");
    });
  });

  describe("getNotificationsForDevice", () => {
    it("filters notifications by targetDevice", async () => {
      const n1 = makeNotification({ id: "n1", targetDevice: "Bob" });
      const n2 = makeNotification({ id: "n2", targetDevice: "Charlie" });
      const jsonl = JSON.stringify(n1) + "\n" + JSON.stringify(n2) + "\n";
      const vault = makeVault({ ".yaos-extension/notifications.jsonl": jsonl });
      const store = createStore(vault);

      const result = await store.getNotificationsForDevice("Bob");
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("n1");
    });
  });

  describe("getUnreadCount", () => {
    it("returns count of unread notifications for a device", async () => {
      const n1 = makeNotification({ id: "n1", targetDevice: "Bob" });
      const n2 = makeNotification({ id: "n2", targetDevice: "Bob" });
      const n3 = makeNotification({ id: "n3", targetDevice: "Bob" });
      const jsonl = JSON.stringify(n1) + "\n" + JSON.stringify(n2) + "\n" + JSON.stringify(n3) + "\n";
      const vault = makeVault({ ".yaos-extension/notifications.jsonl": jsonl });
      loadData.mockResolvedValue({ readNotificationIds: ["n1"] });
      const store = createStore(vault);
      await store.init();

      const count = await store.getUnreadCount("Bob");
      expect(count).toBe(2);
    });

    it("returns 0 when all notifications are read", async () => {
      const n1 = makeNotification({ id: "n1", targetDevice: "Bob" });
      const vault = makeVault({ ".yaos-extension/notifications.jsonl": JSON.stringify(n1) + "\n" });
      loadData.mockResolvedValue({ readNotificationIds: ["n1"] });
      const store = createStore(vault);
      await store.init();

      const count = await store.getUnreadCount("Bob");
      expect(count).toBe(0);
    });

    it("returns 0 when no notifications exist for the device", async () => {
      const vault = makeVault({});
      loadData.mockResolvedValue({ readNotificationIds: [] });
      const store = createStore(vault);
      await store.init();

      const count = await store.getUnreadCount("Bob");
      expect(count).toBe(0);
    });
  });

  describe("markAsRead", () => {
    it("adds the notification ID to the read set", async () => {
      const vault = makeVault({});
      loadData.mockResolvedValue({ readNotificationIds: [] });
      const store = createStore(vault);
      await store.init();

      await store.markAsRead("n1");

      expect(saveData).toHaveBeenCalledWith({ readNotificationIds: ["n1"] });
    });

    it("preserves existing read IDs when adding a new one", async () => {
      const vault = makeVault({});
      loadData.mockResolvedValue({ readNotificationIds: ["n1", "n2"] });
      const store = createStore(vault);
      await store.init();

      await store.markAsRead("n3");

      expect(saveData).toHaveBeenCalledWith({ readNotificationIds: ["n1", "n2", "n3"] });
    });

    it("does not add duplicate IDs", async () => {
      const vault = makeVault({});
      loadData.mockResolvedValue({ readNotificationIds: ["n1"] });
      const store = createStore(vault);
      await store.init();

      await store.markAsRead("n1");

      expect(saveData).not.toHaveBeenCalled();
    });
  });

  describe("markAllAsRead", () => {
    it("marks all notifications for a device as read", async () => {
      const n1 = makeNotification({ id: "n1", targetDevice: "Bob" });
      const n2 = makeNotification({ id: "n2", targetDevice: "Bob" });
      const n3 = makeNotification({ id: "n3", targetDevice: "Charlie" });
      const jsonl = JSON.stringify(n1) + "\n" + JSON.stringify(n2) + "\n" + JSON.stringify(n3) + "\n";
      const vault = makeVault({ ".yaos-extension/notifications.jsonl": jsonl });
      loadData.mockResolvedValue({ readNotificationIds: ["n-existing"] });
      const store = createStore(vault);
      await store.init();

      await store.markAllAsRead("Bob");

      expect(saveData).toHaveBeenCalledWith({
        readNotificationIds: expect.arrayContaining(["n-existing", "n1", "n2"]),
      });
    });
  });

  describe("isRead", () => {
    it("returns true when notification is in the read set", async () => {
      const vault = makeVault({});
      loadData.mockResolvedValue({ readNotificationIds: ["n1"] });
      const store = createStore(vault);
      await store.init();

      expect(store.isRead("n1")).toBe(true);
    });

    it("returns false when notification is not in the read set", async () => {
      const vault = makeVault({});
      loadData.mockResolvedValue({ readNotificationIds: ["n1"] });
      const store = createStore(vault);
      await store.init();

      expect(store.isRead("n2")).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationView, NOTIFICATIONS_VIEW_TYPE } from "./notificationView";
import { NotificationStore } from "./notificationStore";
import type { Notification } from "../comments/types";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    type: "notification",
    id: "notif-1",
    kind: "mention",
    commentId: "c1",
    fileId: "notes/test.md",
    fromDevice: "Bob",
    targetDevice: "Alice",
    createdAt: Date.now() - 60000,
    preview: "Hey @Alice check this out",
    ...overrides,
  };
}

function makeStore(notifications: Notification[], readIds: Set<string> = new Set()) {
  return {
    getNotificationsForDevice: vi.fn(async () => notifications),
    getUnreadCount: vi.fn(async () => notifications.filter(n => !readIds.has(n.id)).length),
    markAsRead: vi.fn(async () => {}),
    markAllAsRead: vi.fn(async () => {}),
    isRead: vi.fn((id: string) => readIds.has(id)),
  } as unknown as NotificationStore;
}

describe("NotificationView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("has correct view type and display text", () => {
    const store = makeStore([]);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());
    expect(view.getViewType()).toBe(NOTIFICATIONS_VIEW_TYPE);
    expect(view.getDisplayText()).toBe("Notifications");
  });

  it("renders empty state when no notifications", async () => {
    const store = makeStore([]);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const empty = view.contentEl.querySelector(".yaos-extension-notification-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("No notifications");
  });

  it("renders notification cards for device notifications", async () => {
    const notifs = [
      makeNotification({ id: "n1", kind: "mention", fromDevice: "Bob" }),
      makeNotification({ id: "n2", kind: "reply", fromDevice: "Charlie" }),
    ];
    const store = makeStore(notifs);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const cards = view.contentEl.querySelectorAll(".yaos-extension-notification-card");
    expect(cards.length).toBe(2);
  });

  it("renders unread indicator for unread notifications", async () => {
    const notifs = [makeNotification({ id: "n1" })];
    const readIds = new Set<string>();
    const store = makeStore(notifs, readIds);

    const view = new NotificationView({} as any, store, "Alice", vi.fn());
    await view.onOpen();
    await view.refresh();

    const card = view.contentEl.querySelector(".yaos-extension-notification-card");
    expect(card?.classList.contains("unread")).toBe(true);
  });

  it("renders read notification without unread indicator", async () => {
    const notifs = [makeNotification({ id: "n1" })];
    const readIds = new Set(["n1"]);
    const store = makeStore(notifs, readIds);

    const view = new NotificationView({} as any, store, "Alice", vi.fn());
    await view.onOpen();
    await view.refresh();

    const card = view.contentEl.querySelector(".yaos-extension-notification-card");
    expect(card?.classList.contains("unread")).toBe(false);
  });

  it("shows notification kind icon", async () => {
    const notifs = [makeNotification({ id: "n1", kind: "mention" })];
    const store = makeStore(notifs);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const icon = view.contentEl.querySelector(".yaos-extension-notification-kind-icon");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-kind")).toBe("mention");
  });

  it("shows from device name with color dot", async () => {
    const notifs = [makeNotification({ id: "n1", fromDevice: "Bob" })];
    const store = makeStore(notifs);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const fromEl = view.contentEl.querySelector(".yaos-extension-notification-from");
    expect(fromEl?.textContent).toContain("Bob");
    const dot = fromEl?.querySelector(".yaos-extension-author-dot");
    expect(dot).not.toBeNull();
  });

  it("shows preview text", async () => {
    const notifs = [makeNotification({ id: "n1", preview: "This is a test notification" })];
    const store = makeStore(notifs);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const previewEl = view.contentEl.querySelector(".yaos-extension-notification-preview");
    expect(previewEl?.textContent).toContain("This is a test notification");
  });

  it("shows file name", async () => {
    const notifs = [makeNotification({ id: "n1", fileId: "notes/test.md" })];
    const store = makeStore(notifs);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const fileEl = view.contentEl.querySelector(".yaos-extension-notification-file");
    expect(fileEl?.textContent).toContain("notes/test.md");
  });

  it("marks notification as read on click", async () => {
    const notifs = [makeNotification({ id: "n1" })];
    const store = makeStore(notifs);
    const onOpenFile = vi.fn();
    const view = new NotificationView({} as any, store, "Alice", onOpenFile);

    await view.onOpen();
    await view.refresh();

    const card = view.contentEl.querySelector(".yaos-extension-notification-card") as HTMLElement;
    card.click();

    expect(store.markAsRead).toHaveBeenCalledWith("n1");
  });

  it("calls onOpenFile callback on click", async () => {
    const notifs = [makeNotification({ id: "n1", fileId: "notes/test.md", commentId: "c1" })];
    const store = makeStore(notifs);
    const onOpenFile = vi.fn();
    const view = new NotificationView({} as any, store, "Alice", onOpenFile);

    await view.onOpen();
    await view.refresh();

    const card = view.contentEl.querySelector(".yaos-extension-notification-card") as HTMLElement;
    card.click();
    await new Promise(r => setTimeout(r, 10));

    expect(onOpenFile).toHaveBeenCalledWith("notes/test.md", "c1");
  });

  it("shows mark all as read button", async () => {
    const notifs = [makeNotification({ id: "n1" })];
    const store = makeStore(notifs);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const btn = view.contentEl.querySelector(".yaos-extension-notification-mark-all");
    expect(btn).not.toBeNull();
  });

  it("calls markAllAsRead when mark all button is clicked", async () => {
    const notifs = [makeNotification({ id: "n1" })];
    const store = makeStore(notifs);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const btn = view.contentEl.querySelector(".yaos-extension-notification-mark-all") as HTMLElement;
    btn.click();

    expect(store.markAllAsRead).toHaveBeenCalledWith("Alice");
  });

  it("sorts notifications by createdAt descending", async () => {
    const notifs = [
      makeNotification({ id: "n1", createdAt: 1000 }),
      makeNotification({ id: "n2", createdAt: 3000 }),
      makeNotification({ id: "n3", createdAt: 2000 }),
    ];
    const store = makeStore(notifs);
    const view = new NotificationView({} as any, store, "Alice", vi.fn());

    await view.onOpen();
    await view.refresh();

    const cards = view.contentEl.querySelectorAll(".yaos-extension-notification-card");
    expect(cards[0]!.getAttribute("data-id")).toBe("n2");
    expect(cards[1]!.getAttribute("data-id")).toBe("n3");
    expect(cards[2]!.getAttribute("data-id")).toBe("n1");
  });
});

import { expect, it, vi } from "vitest";
import { FOCUS_NOTIFICATION_ID, MAX_FOCUS_NOTIFICATIONS } from "../focus";
import { syncReminders } from "../reminders";

const notifications = vi.hoisted(() => ({ cancel: vi.fn(), opened: vi.fn() }));
vi.mock("../native", () => ({ isNative: () => true }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: {
  createChannel: async () => {},
  registerActionTypes: async () => {},
  getPending: async () => ({ notifications: [1999000001, 1999000002, 1999000040, 42].map((id) => ({ id })) }),
  cancel: notifications.cancel,
  addListener: (_name: string, handler: unknown) => { notifications.opened(handler); },
} }));

it("keeps all existing Pomodoro round alerts when rebuilding task reminders", async () => {
  expect(FOCUS_NOTIFICATION_ID + MAX_FOCUS_NOTIFICATIONS - 1).toBe(1999000040);
  await syncReminders([]);
  expect(notifications.cancel).toHaveBeenCalledWith({ notifications: [{ id: 42 }] });
});

it("does not navigate to a task when a focus notification is opened", async () => {
  const { onReminderOpened } = await import("../reminders");
  const open = vi.fn();
  await onReminderOpened(open);
  notifications.opened.mock.calls[0][0]({ notification: { id: FOCUS_NOTIFICATION_ID + 1, extra: { focus: true } } });
  expect(open).not.toHaveBeenCalled();
});

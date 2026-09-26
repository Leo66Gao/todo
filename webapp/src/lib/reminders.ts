"use client";

// Task reminders, scheduled on the phone itself (Android app only): no server
// is involved. Whenever tasks change, the app works out which reminders should
// exist for the next two weeks and brings the scheduled ones in line.

import { create } from "zustand";
import { FOCUS_NOTIFICATION_ID } from "./focus";
import { isNative } from "./native";
import { getLocal, setLocal } from "./prefs";
import { sameDay, startOfDay } from "./time";
import type { Task } from "./model";

export interface ReminderPrefs {
  /** Remind before tasks that have a start time. */
  timed: boolean;
  /** Minutes before the start time (0 = at the start). */
  lead: number;
  /** A morning summary of the day's tasks. */
  summary: boolean;
  /** Minutes after midnight for the summary. */
  summaryAt: number;
}

const DEFAULTS: ReminderPrefs = { timed: true, lead: 10, summary: false, summaryAt: 7 * 60 + 30 };
const KEY = "reminders";
export const LEAD_OPTIONS = [0, 5, 10, 15, 30, 60] as const;

export const useReminderPrefs = create<ReminderPrefs>(() => ({ ...DEFAULTS, ...getLocal<Partial<ReminderPrefs>>(KEY, {}) }));

export function setReminderPrefs(patch: Partial<ReminderPrefs>) {
  useReminderPrefs.setState(patch);
  setLocal(KEY, useReminderPrefs.getState());
}

/** How far ahead reminders are kept scheduled, and at most how many. */
const HORIZON_DAYS = 14;
const MAX_SCHEDULED = 60;
const CHANNEL = "tasks";
const SUMMARY_BASE = 1_900_000_000;

export interface PlannedReminder {
  id: number;
  at: Date;
  title: string;
  body: string;
  taskId: string | null;
  day: string;
}

/** A stable positive 31-bit id per task (Android notification ids are ints). */
function idFor(taskId: string) {
  let h = 2166136261;
  for (let i = 0; i < taskId.length; i++) h = Math.imul(h ^ taskId.charCodeAt(i), 16777619);
  return (h >>> 1) % SUMMARY_BASE;
}

const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** The reminders that should exist right now (pure: easy to test). */
export function planReminders(tasks: Task[], prefs: ReminderPrefs, now: Date, subjectName: (id: string | null) => string | null): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const horizon = now.getTime() + HORIZON_DAYS * 86_400_000;
  if (prefs.timed) {
    for (const task of tasks) {
      if (task.isDone || task.isConflictCopy || !task.startTime) continue;
      const at = new Date(task.startTime.getTime() - prefs.lead * 60_000);
      if (at.getTime() <= now.getTime() || at.getTime() > horizon) continue;
      const subject = subjectName(task.projectId);
      const when = prefs.lead === 0 ? `Now · ${clock(task.startTime)}` : `In ${prefs.lead} min · ${clock(task.startTime)}`;
      out.push({
        id: idFor(task.id),
        at,
        title: task.title || "Untitled task",
        body: subject ? `${when} · ${subject}` : when,
        taskId: task.id,
        day: dayKey(task.startTime),
      });
    }
  }
  if (prefs.summary) {
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const day = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(prefs.summaryAt / 60), prefs.summaryAt % 60);
      if (at.getTime() <= now.getTime()) continue;
      const open = tasks.filter((t) => !t.isDone && !t.isConflictCopy && sameDay(t.date, day));
      if (open.length === 0) continue;
      const first = open.filter((t) => t.startTime).sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime())[0];
      out.push({
        id: SUMMARY_BASE + i,
        at,
        title: open.length === 1 ? "1 task today" : `${open.length} tasks today`,
        body: first ? `First: ${first.title} at ${clock(first.startTime!)}` : open.slice(0, 3).map((t) => t.title).join(", "),
        taskId: null,
        day: dayKey(day),
      });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_SCHEDULED);
}

const fingerprint = (r: PlannedReminder) => `${r.at.getTime()}|${r.title}|${r.body}`;
let scheduled = new Map<number, string>();
let syncing: Promise<void> = Promise.resolve();

/** Brings the phone's scheduled reminders in line with [planned]. */
export function syncReminders(planned: PlannedReminder[]) {
  if (!isNative()) return Promise.resolve();
  syncing = syncing.then(() => apply(planned)).catch((error) => console.warn("Reminders:", error));
  return syncing;
}

let ready = false;
async function apply(planned: PlannedReminder[]) {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  if (!ready) {
    ready = true;
    await LocalNotifications.createChannel({
      id: CHANNEL,
      name: "Task reminders",
      description: "Before tasks with a start time, and the morning summary.",
      importance: 4,
      visibility: 1,
      vibration: true,
    });
    const pending = await LocalNotifications.getPending();
    // The focus timer's notification isn't a reminder: leave it alone.
    scheduled = new Map(pending.notifications.filter((n) => n.id !== FOCUS_NOTIFICATION_ID).map((n) => [n.id, ""]));
  }
  const wanted = new Map(planned.map((r) => [r.id, r]));
  const cancel = [...scheduled.keys()].filter((id) => wanted.get(id) == null || fingerprint(wanted.get(id)!) !== scheduled.get(id));
  if (cancel.length) {
    await LocalNotifications.cancel({ notifications: cancel.map((id) => ({ id })) });
    for (const id of cancel) scheduled.delete(id);
  }
  const add = planned.filter((r) => !scheduled.has(r.id));
  if (add.length === 0) return;
  if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
  await LocalNotifications.schedule({
    notifications: add.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      channelId: CHANNEL,
      smallIcon: "ic_stat_todo",
      iconColor: "#2F5FD0",
      schedule: { at: r.at, allowWhileIdle: true },
      extra: { taskId: r.taskId, day: r.day },
    })),
  });
  for (const r of add) scheduled.set(r.id, fingerprint(r));
}

/** Asks for permission to show notifications (Android 13+). */
export async function requestReminderPermission(): Promise<boolean> {
  if (!isNative()) return false;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const status = await LocalNotifications.checkPermissions();
  if (status.display === "granted") return true;
  return (await LocalNotifications.requestPermissions()).display === "granted";
}

/** Called when a reminder is tapped: [open] shows that day and task. */
export async function onReminderOpened(open: (taskId: string | null, day: Date) => void) {
  if (!isNative()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
    const extra = (notification.extra ?? {}) as { taskId?: string | null; day?: string };
    const [y, m, d] = (extra.day ?? "").split("-").map(Number);
    open(extra.taskId ?? null, y ? new Date(y, m - 1, d) : new Date());
  });
}

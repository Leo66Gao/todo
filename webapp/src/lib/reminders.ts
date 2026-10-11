"use client";

// Task reminders, scheduled on the phone itself (Android app only): no server
// is involved. Whenever tasks change, the app works out which reminders should
// exist for the next two weeks and brings the scheduled ones in line.

import { create } from "zustand";
import { plainLines } from "./delta";
import { isFocusNotification } from "./focus";
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
/** The sample sent from Settings; never rescheduled or cancelled by a sync. */
const PREVIEW_ID = 1_950_000_000;

export interface PlannedReminder {
  id: number;
  at: Date;
  title: string;
  /** The one line shown when the notification is collapsed. */
  body: string;
  /** Shown when it's expanded: the full picture of the task. */
  largeBody?: string;
  /** The morning summary's list of the day's tasks. */
  lines?: string[];
  /** The small line in the header: the subject, or the day's total. */
  summary?: string;
  /** Tints the icon, the header and the buttons (the subject's colour). */
  color: string;
  /** Offers Mark done and Start focus. */
  actions: boolean;
  taskId: string | null;
  day: string;
}

export interface ReminderSubject {
  title: string;
  /** "#RRGGBB". */
  color: string;
}

/** The app's accent, for tasks without a subject. */
export const REMINDER_COLOR = "#2F5FD0";
export const TASK_ACTIONS = "task";

/** A stable positive 31-bit id per task (Android notification ids are ints). */
function idFor(taskId: string) {
  let h = 2166136261;
  for (let i = 0; i < taskId.length; i++) h = Math.imul(h ^ taskId.charCodeAt(i), 16777619);
  return (h >>> 1) % SUMMARY_BASE;
}

const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "1 h 30 min", "45 min", "2 h". */
export function lengthLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

/** "20.00–21.00", or "20.00" when the task has no length. */
export function timeRange(task: Pick<Task, "startTime" | "durationMinutes">) {
  if (!task.startTime) return "";
  const start = clock(task.startTime);
  if (task.durationMinutes <= 0) return start;
  return `${start}–${clock(new Date(task.startTime.getTime() + task.durationMinutes * 60_000))}`;
}

/** The first line of a task's notes as plain text (notes are stored as rich text or Markdown), kept short. */
function firstLine(text: string) {
  const line = plainLines(text)[0] ?? "";
  return line.length > 90 ? `${line.slice(0, 89).trimEnd()}…` : line;
}

const open = (t: Task) => !t.isDone && !t.isConflictCopy;
const byStart = (a: Task, b: Task) => a.startTime!.getTime() - b.startTime!.getTime();

/** The reminder before a timed task: when, what it involves, and what follows. */
function taskReminder(task: Task, tasks: Task[], prefs: ReminderPrefs, subject: ReminderSubject | null, at: Date): PlannedReminder {
  const start = task.startTime!;
  const range = timeRange(task);
  const soon = prefs.lead === 0 ? "starting now" : `starts in ${lengthLabel(prefs.lead)}`;
  const details = [[range, task.durationMinutes > 0 ? lengthLabel(task.durationMinutes) : null, soon].filter(Boolean).join(" · ")];

  if (task.type === "assignment") {
    details.push(sameDay(task.date, start) ? "Assignment · due today" : `Assignment · due ${WEEKDAYS[task.date.getDay()]} ${task.date.getDate()}.${task.date.getMonth() + 1}.`);
  }
  if (task.subtasks.length) {
    const done = task.subtasks.filter((s) => s.isDone).length;
    const next = task.subtasks.find((s) => !s.isDone);
    details.push(next ? `${done} of ${task.subtasks.length} steps done · next: ${next.title}` : `All ${task.subtasks.length} steps done`);
  }
  const note = firstLine(task.notes);
  if (note) details.push(note);

  // Where it sits in the day: what comes after, or that it's the last one.
  const today = tasks.filter((t) => open(t) && t.startTime && sameDay(t.startTime, start)).sort(byStart);
  const after = today[today.findIndex((t) => t.id === task.id) + 1];
  if (after) details.push(`Then ${after.title || "Untitled task"} at ${clock(after.startTime!)}`);
  else if (today.length > 1) details.push("Last one today");

  return {
    id: idFor(task.id),
    at,
    title: task.title || "Untitled task",
    // The subject shows in the header (the summary), so the line is just when.
    body: `${range} · ${soon}`,
    largeBody: details.join("\n"),
    summary: subject?.title,
    color: subject?.color ?? REMINDER_COLOR,
    actions: true,
    taskId: task.id,
    day: dayKey(start),
  };
}

/** The morning summary: the day's tasks in order, with their times. */
function daySummary(day: Date, tasks: Task[], at: Date, subjectOf: (id: string | null) => ReminderSubject | null, index: number): PlannedReminder | null {
  const due = tasks.filter((t) => open(t) && sameDay(t.date, day));
  if (due.length === 0) return null;
  const timed = due.filter((t) => t.startTime).sort(byStart);
  const untimed = due.filter((t) => !t.startTime);
  const ordered = [...timed, ...untimed];
  const shown = 5;
  const lines = ordered.slice(0, shown).map((t) => {
    const subject = subjectOf(t.projectId)?.title;
    const name = t.title || "Untitled task";
    return [t.startTime ? timeRange(t) : null, name, subject].filter(Boolean).join(" · ");
  });
  const planned = due.reduce((sum, t) => sum + Math.max(0, t.durationMinutes), 0);
  const overdue = index === 0 ? tasks.filter((t) => open(t) && t.date.getTime() < day.getTime()).length : 0;
  const summary = [
    ordered.length > shown ? `${ordered.length - shown} more` : null,
    planned > 0 ? `${lengthLabel(planned)} planned` : null,
    overdue ? `${overdue} overdue` : null,
  ].filter(Boolean).join(" · ");
  const first = timed[0];
  const count = due.length === 1 ? "1 task" : `${due.length} tasks`;
  return {
    id: SUMMARY_BASE + index,
    at,
    title: `${WEEKDAYS[day.getDay()]} · ${count}`,
    body: first ? `First up: ${first.title || "Untitled task"} at ${clock(first.startTime!)}` : ordered.slice(0, 3).map((t) => t.title).join(", "),
    lines,
    summary: summary || undefined,
    color: REMINDER_COLOR,
    actions: false,
    taskId: null,
    day: dayKey(day),
  };
}

/** The reminders that should exist right now (pure: easy to test). */
export function planReminders(tasks: Task[], prefs: ReminderPrefs, now: Date, subjectOf: (id: string | null) => ReminderSubject | null): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  const horizon = now.getTime() + HORIZON_DAYS * 86_400_000;
  if (prefs.timed) {
    for (const task of tasks) {
      if (!open(task) || !task.startTime) continue;
      const at = new Date(task.startTime.getTime() - prefs.lead * 60_000);
      if (at.getTime() <= now.getTime() || at.getTime() > horizon) continue;
      out.push(taskReminder(task, tasks, prefs, subjectOf(task.projectId), at));
    }
  }
  if (prefs.summary) {
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const day = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(prefs.summaryAt / 60), prefs.summaryAt % 60);
      if (at.getTime() <= now.getTime()) continue;
      const summary = daySummary(day, tasks, at, subjectOf, i);
      if (summary) out.push(summary);
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_SCHEDULED);
}

const fingerprint = (r: PlannedReminder) => JSON.stringify([r.at.getTime(), r.title, r.body, r.largeBody, r.lines, r.summary, r.color, r.actions]);
let scheduled = new Map<number, string>();
let syncing: Promise<void> = Promise.resolve();

/** Brings the phone's scheduled reminders in line with [planned]. */
export function syncReminders(planned: PlannedReminder[]) {
  if (!isNative()) return Promise.resolve();
  syncing = syncing.then(() => apply(planned)).catch((error) => console.warn("Reminders:", error));
  return syncing;
}

let setup: Promise<void> | null = null;

/** Creates the channel and the buttons once, and learns what's already scheduled. */
function ensureSetup() {
  setup ??= (async () => {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.createChannel({
      id: CHANNEL,
      name: "Task reminders",
      description: "Before tasks with a start time, and the morning summary.",
      importance: 4,
      visibility: 1,
      vibration: true,
    });
    await LocalNotifications.registerActionTypes({
      types: [{ id: TASK_ACTIONS, actions: [{ id: "done", title: "Mark done" }, { id: "focus", title: "Start focus" }] }],
    });
    const pending = await LocalNotifications.getPending();
    // The focus timer's notifications and the sample aren't reminders: leave them alone.
    scheduled = new Map(pending.notifications.filter((n) => !isFocusNotification(n.id) && n.id !== PREVIEW_ID).map((n) => [n.id, ""]));
  })();
  setup.catch(() => (setup = null));
  return setup;
}

async function apply(planned: PlannedReminder[]) {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await ensureSetup();
  const wanted = new Map(planned.map((r) => [r.id, r]));
  const cancel = [...scheduled.keys()].filter((id) => wanted.get(id) == null || fingerprint(wanted.get(id)!) !== scheduled.get(id));
  if (cancel.length) {
    await LocalNotifications.cancel({ notifications: cancel.map((id) => ({ id })) });
    for (const id of cancel) scheduled.delete(id);
  }
  const add = planned.filter((r) => !scheduled.has(r.id));
  if (add.length === 0) return;
  if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
  await LocalNotifications.schedule({ notifications: add.map(toNotification) });
  for (const r of add) scheduled.set(r.id, fingerprint(r));
}

function toNotification(r: PlannedReminder) {
  return {
      id: r.id,
      title: r.title,
      body: r.body,
      ...(r.largeBody ? { largeBody: r.largeBody } : {}),
      ...(r.lines ? { inboxList: r.lines } : {}),
      ...(r.summary ? { summaryText: r.summary } : {}),
      ...(r.actions ? { actionTypeId: TASK_ACTIONS } : {}),
      channelId: CHANNEL,
      smallIcon: "ic_stat_todo",
      iconColor: r.color,
      schedule: { at: r.at, allowWhileIdle: true },
      extra: { taskId: r.taskId, day: r.day },
  };
}

/**
 * Shows what a reminder looks like, in a few seconds: for the next timed task
 * when there is one, otherwise for an example.
 */
export async function sendSampleReminder(tasks: Task[], prefs: ReminderPrefs, subjectOf: (id: string | null) => ReminderSubject | null) {
  if (!isNative() || !(await requestReminderPermission())) return false;
  const now = new Date();
  const next = tasks
    .filter((t) => open(t) && t.startTime && t.startTime.getTime() > now.getTime())
    .sort(byStart)[0];
  const at = new Date(now.getTime() + 3000);
  let sample: PlannedReminder;
  if (next) {
    sample = taskReminder(next, tasks, prefs, subjectOf(next.projectId), at);
  } else {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
    const example: Task = {
      id: "sample", title: "Essay: write the introduction", notes: "Hook, context, then the thesis in one sentence.", isDone: false,
      date: start, type: "todo", priority: "none", difficulty: 1, durationMinutes: 60, projectId: null, parentTaskId: null,
      category: "General", startTime: start, remainingMinutes: 0, googleEventId: null, calendarEventRevision: 0, isConflictCopy: false,
      subtasks: [
        { id: "a", title: "Outline", isDone: true, date: null, priority: null, difficulty: null },
        { id: "b", title: "Draft the hook", isDone: false, date: null, priority: null, difficulty: null },
        { id: "c", title: "Thesis", isDone: false, date: null, priority: null, difficulty: null },
      ],
    };
    // The buttons show, but with no real task behind them they just open the app.
    sample = { ...taskReminder(example, [example], prefs, { title: "English", color: REMINDER_COLOR }, at), taskId: null };
  }
  await ensureSetup();
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.schedule({ notifications: [toNotification({ ...sample, id: PREVIEW_ID })] });
  return true;
}

/** Asks for permission to show notifications (Android 13+). */
export async function requestReminderPermission(): Promise<boolean> {
  if (!isNative()) return false;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const status = await LocalNotifications.checkPermissions();
  if (status.display === "granted") return true;
  return (await LocalNotifications.requestPermissions()).display === "granted";
}

export type ReminderAction = "open" | "done" | "focus";

/** Called when a reminder or one of its buttons is tapped: [open] shows that day and task. */
export async function onReminderOpened(open: (taskId: string | null, day: Date, action: ReminderAction) => void) {
  if (!isNative()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.addListener("localNotificationActionPerformed", ({ actionId, notification }) => {
    if (isFocusNotification(notification.id) || notification.extra?.focus) return;
    const extra = (notification.extra ?? {}) as { taskId?: string | null; day?: string };
    const [y, m, d] = (extra.day ?? "").split("-").map(Number);
    const action: ReminderAction = actionId === "done" || actionId === "focus" ? actionId : "open";
    open(extra.taskId ?? null, y ? new Date(y, m - 1, d) : new Date(), action);
  });
}

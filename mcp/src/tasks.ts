// Task records as the Todo apps store them (webapp/src/lib/model.ts, which
// mirrors the Flutter app field for field). A record's payload is the task as
// JSON; this module reads and edits that JSON directly, changing only the
// fields asked for, so fields it doesn't know about survive untouched.
//
// Times are local wall-clock strings with no offset ("2026-11-17T13:00:00.000",
// Dart's DateTime.toIso8601String), read back as local time on each device.
// They are kept as wall-clock values here too: a date is "YYYY-MM-DD" and a
// time "HH:MM", in whatever time zone the user's devices are in.

type Json = Record<string, unknown>;

export type Priority = "none" | "low" | "medium" | "high" | "critical";
export const PRIORITIES: Priority[] = ["none", "low", "medium", "high", "critical"];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDay(value: string): boolean {
  const m = DAY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export const isTime = (value: string) => TIME.test(value);

/** "YYYY-MM-DD" of a stored date, or null. */
export const dayOf = (stored: unknown) => (typeof stored === "string" && /^\d{4}-\d{2}-\d{2}/.test(stored) ? stored.slice(0, 10) : null);
/** "HH:MM" of a stored date-time, or null. */
export const timeOf = (stored: unknown) => {
  if (typeof stored !== "string") return null;
  const m = /T(\d{2}):(\d{2})/.exec(stored);
  return m ? `${m[1]}:${m[2]}` : null;
};
const stamp = (day: string, time = "00:00") => `${day}T${time}:00.000`;

const decodePriority = (raw: unknown): Priority => {
  const name = typeof raw === "string" ? raw.replace(/^TaskPriority\./, "") : "none";
  return (PRIORITIES as string[]).includes(name) ? (name as Priority) : "none";
};

/** What an agent sees of a task: enough to plan with. */
export interface TaskView {
  id: string;
  title: string;
  date: string | null;
  start: string | null;
  durationMinutes: number;
  done: boolean;
  type: "todo" | "assignment";
  priority: Priority;
  subjectId: string | null;
  subject?: string;
  /** Assignments' dated steps, each schedulable on its own. */
  milestones?: { id: string; title: string; date: string | null; done: boolean }[];
  subtasks?: { title: string; done: boolean }[];
  conflictCopy?: true;
}

export function viewTask(task: Json, subjects: Map<string, string>): TaskView {
  const subjectId = typeof task.projectId === "string" ? task.projectId : null;
  const subs = Array.isArray(task.subtasks) ? (task.subtasks as Json[]) : [];
  const assignment = task.type === "TaskType.assignment";
  const view: TaskView = {
    id: String(task.id),
    title: String(task.title ?? ""),
    date: dayOf(task.date),
    start: timeOf(task.startTime),
    durationMinutes: typeof task.durationMinutes === "number" ? task.durationMinutes : 0,
    done: task.isDone === true,
    type: assignment ? "assignment" : "todo",
    priority: decodePriority(task.priority),
    subjectId,
    ...(subjectId && subjects.has(subjectId) ? { subject: subjects.get(subjectId) } : {}),
  };
  if (subs.length) {
    if (assignment) {
      view.milestones = subs.map((s) => ({ id: `${view.id}/${String(s.id)}`, title: String(s.title ?? ""), date: dayOf(s.date), done: s.isDone === true }));
    } else {
      view.subtasks = subs.map((s) => ({ title: String(s.title ?? ""), done: s.isDone === true }));
    }
  }
  if (task.isConflictCopy === true) view.conflictCopy = true;
  return view;
}

/** A milestone (an assignment's dated step) is addressed as "taskId/subtaskId". */
export function splitId(id: string): { taskId: string; subtaskId: string | null } {
  const at = id.indexOf("/");
  return at < 0 ? { taskId: id, subtaskId: null } : { taskId: id.slice(0, at), subtaskId: id.slice(at + 1) };
}

export interface Schedule {
  date: string;
  /** "HH:MM", null to make it an all-day task, undefined to keep its time. */
  start?: string | null;
  durationMinutes?: number;
}

/** Moves a task to a day, and optionally a time and length. Keeps its time of day when moved without one, as the app does. */
export function scheduleTask(task: Json, s: Schedule): Json {
  const keep = s.start === undefined ? timeOf(task.startTime) : s.start;
  task.date = stamp(s.date);
  task.startTime = keep ? stamp(s.date, keep) : null;
  if (s.durationMinutes !== undefined) task.durationMinutes = s.durationMinutes;
  return task;
}

/** Moves an assignment's milestone to a day. False when there is no such milestone. */
export function scheduleMilestone(task: Json, subtaskId: string, date: string): boolean {
  const subs = Array.isArray(task.subtasks) ? (task.subtasks as Json[]) : [];
  const sub = subs.find((s) => s.id === subtaskId);
  if (!sub) return false;
  sub.date = stamp(date);
  return true;
}

export interface TaskPatch {
  title?: string;
  done?: boolean;
  priority?: Priority;
  durationMinutes?: number;
  subjectId?: string | null;
}

export function patchTask(task: Json, p: TaskPatch): Json {
  if (p.title !== undefined) task.title = p.title;
  if (p.done !== undefined) task.isDone = p.done;
  if (p.priority !== undefined) task.priority = `TaskPriority.${p.priority}`;
  if (p.durationMinutes !== undefined) task.durationMinutes = p.durationMinutes;
  if (p.subjectId !== undefined) task.projectId = p.subjectId;
  return task;
}

export interface NewTask {
  id: string;
  title: string;
  date: string;
  start?: string | null;
  durationMinutes?: number;
  subjectId?: string | null;
  priority?: Priority;
  assignment?: boolean;
}

/** A new task in the apps' own field order (encodeTask in the web app). */
export function newTask(t: NewTask): Json {
  return {
    id: t.id,
    title: t.title,
    notes: "",
    isDone: false,
    date: stamp(t.date),
    type: t.assignment ? "TaskType.assignment" : "TaskType.todo",
    priority: `TaskPriority.${t.priority ?? "none"}`,
    difficulty: 1,
    durationMinutes: t.durationMinutes ?? 0,
    projectId: t.subjectId ?? null,
    parentTaskId: null,
    category: "General",
    startTime: t.start ? stamp(t.date, t.start) : null,
    remainingMinutes: 0,
    subtasks: [],
    googleEventId: null,
    calendarEventRevision: 0,
    isConflictCopy: false,
  };
}

/** Plain text of a task's notes (stored as a Quill delta, or plain text by older builds). */
export function notesText(notes: unknown): string {
  if (typeof notes !== "string" || !notes) return "";
  try {
    const delta = JSON.parse(notes) as { ops?: { insert?: unknown }[] } | { insert?: unknown }[];
    const ops = Array.isArray(delta) ? delta : delta.ops;
    if (!Array.isArray(ops)) return notes;
    return ops.map((op) => (typeof op.insert === "string" ? op.insert : "")).join("").trim();
  } catch {
    return notes;
  }
}

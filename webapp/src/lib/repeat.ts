// Repeating tasks. A repeating task is a series of ordinary tasks, one per
// day, so every occurrence shows in Today, Week and Calendar and can be
// changed, moved or deleted on its own. The series is either days picked by
// hand ("this Sunday and every day next week") or a rule ("every weekday"),
// stored on each occurrence in `extra.repeat`.
//
// A rule's occurrences are made a few weeks ahead and topped up as time goes
// on. Top-ups use IDs made from the series, its revision and the day, so two
// devices adding the same day write the same record instead of two.

import { format } from "date-fns";
import type { Subtask, Task } from "./model";
import { addDays, startOfDay, startOfWeek, today } from "./time";

export type RepeatUnit = "day" | "week" | "month" | "year";

export type RepeatRule =
  /** Days picked by hand, "yyyy-MM-dd", in order. */
  | { kind: "days"; days: string[] }
  | {
      kind: "rule";
      every: number;
      unit: RepeatUnit;
      /** For weeks: the weekdays (0 = Sunday … 6 = Saturday). */
      weekdays?: number[];
      /** The first day, "yyyy-MM-dd" (the task's own day). */
      start: string;
      /** The last day it may fall on, or none. */
      until?: string | null;
    };

export interface Repeat {
  /** Shared by every task in the series. */
  series: string;
  /** Bumped on every change to the series, so new days get fresh IDs. */
  rev: number;
  rule: RepeatRule;
  /**
   * What new days are made from: the series as set up, or as last changed
   * with "this and upcoming". (Without it, new days copied the last task,
   * so a change made to that one task alone spread to every later one.)
   * Older series have none and fall back to the last task.
   */
  template?: SeriesTemplate;
}

/** The fields a series' tasks share, and its time of day (minutes after midnight, or null for none). */
export interface SeriesTemplate {
  title: string;
  notes: string;
  type: Task["type"];
  priority: Task["priority"];
  difficulty: number;
  difficultySelected?: boolean;
  durationMinutes: number;
  projectId: string | null;
  category: string;
  minute: number | null;
  /** The steps each new day starts with, dated relative to the day (older templates: the last task's). */
  subtasks?: TemplateStep[];
}

/** A step in a series' template: its date is [offset] days from the task's (or none). */
export interface TemplateStep {
  title: string;
  offset: number | null;
  priority: Subtask["priority"];
  difficulty: number | null;
  extra?: Record<string, unknown>;
}

/** [task]'s shared fields, as a series template. */
export function templateOf(task: Task): SeriesTemplate {
  return {
    title: task.title,
    notes: task.notes,
    type: task.type,
    priority: task.priority,
    difficulty: task.difficulty,
    ...(task.extra?.difficultySelected === true ? { difficultySelected: true } : {}),
    durationMinutes: task.durationMinutes,
    projectId: task.projectId,
    category: task.category,
    minute: task.startTime ? task.startTime.getHours() * 60 + task.startTime.getMinutes() : null,
    subtasks: task.subtasks.map((sub) => {
      // (Time already spent on a step belongs to that day's step.)
      const { remainingMinutes: _left, ...extra } = sub.extra ?? {};
      void _left;
      return {
        title: sub.title,
        offset: sub.date ? daysBetween(task.date, sub.date) : null,
        priority: sub.priority,
        difficulty: sub.difficulty,
        ...(Object.keys(extra).length ? { extra } : {}),
      };
    }),
  };
}

/** [task] with the template's shared fields and time of day. */
export function withTemplate(task: Task, t: SeriesTemplate): Task {
  const extra = { ...task.extra };
  if (t.difficultySelected) extra.difficultySelected = true;
  else delete extra.difficultySelected;
  return {
    ...task,
    title: t.title,
    notes: t.notes,
    type: t.type,
    priority: t.priority,
    difficulty: t.difficulty,
    durationMinutes: t.durationMinutes,
    remainingMinutes: t.durationMinutes,
    projectId: t.projectId,
    category: t.category,
    startTime: t.minute == null ? null : new Date(task.date.getFullYear(), task.date.getMonth(), task.date.getDate(), Math.floor(t.minute / 60), t.minute % 60),
    subtasks: t.subtasks
      ? t.subtasks.map((step, i) => ({
          id: `${task.id}-s${i}`,
          title: step.title,
          isDone: false,
          date: step.offset == null ? null : addDays(startOfDay(task.date), step.offset),
          priority: step.priority,
          difficulty: step.difficulty,
          ...(step.extra ? { extra: step.extra } : {}),
        }))
      : task.subtasks,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

function readTemplate(raw: unknown): SeriesTemplate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Record<string, unknown>;
  const str = (v: unknown) => typeof v === "string";
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!str(t.title) || !str(t.notes) || !str(t.category) || !num(t.difficulty) || !num(t.durationMinutes)) return undefined;
  if (t.type !== "todo" && t.type !== "assignment") return undefined;
  if (!["none", "low", "medium", "high", "critical"].includes(t.priority as string)) return undefined;
  if (t.projectId !== null && !str(t.projectId)) return undefined;
  if (t.minute !== null && !(num(t.minute) && (t.minute as number) >= 0 && (t.minute as number) < 1440)) return undefined;
  return {
    title: t.title as string,
    notes: t.notes as string,
    type: t.type,
    priority: t.priority as SeriesTemplate["priority"],
    difficulty: t.difficulty as number,
    ...(t.difficultySelected === true ? { difficultySelected: true } : {}),
    durationMinutes: t.durationMinutes as number,
    projectId: t.projectId as string | null,
    category: t.category as string,
    minute: t.minute as number | null,
    ...(Array.isArray(t.subtasks) && t.subtasks.every(isStep) ? { subtasks: t.subtasks as TemplateStep[] } : {}),
  };
}

function isStep(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Record<string, unknown>;
  const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  return (
    typeof s.title === "string" &&
    (s.offset === null || (int(s.offset) && Math.abs(s.offset as number) <= 3660)) &&
    (s.priority === null || ["none", "low", "medium", "high", "critical"].includes(s.priority as string)) &&
    (s.difficulty === null || (typeof s.difficulty === "number" && Number.isFinite(s.difficulty))) &&
    (s.extra === undefined || (!!s.extra && typeof s.extra === "object" && !Array.isArray(s.extra)))
  );
}

/** How far ahead a rule's days are made, and when they're topped up. */
export const AHEAD_DAYS = 21;
export const TOP_UP_DAYS = 7;
/** At most this many picked days in one series. */
export const MAX_PICKED = 120;

export const dayString = (d: Date) => format(d, "yyyy-MM-dd");

export function parseDay(s: unknown): Date | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayString(d) === s ? d : null;
}

const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);

const withStoredTemplate = (raw: unknown) => {
  const template = readTemplate(raw);
  return template ? { template } : {};
};

/** The task's series, if it repeats (the stored value is checked: it's synced data). */
export function readRepeat(task: Pick<Task, "extra">): Repeat | null {
  const raw = task.extra?.repeat as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object" || typeof raw.series !== "string" || !raw.series) return null;
  const rule = raw.rule as Record<string, unknown> | undefined;
  const rev = typeof raw.rev === "number" && Number.isFinite(raw.rev) ? raw.rev : 0;
  if (rule?.kind === "days" && Array.isArray(rule.days)) {
    const days = [...new Set(rule.days.filter((d): d is string => parseDay(d) != null))].sort().slice(0, MAX_PICKED);
    return { series: raw.series, rev, rule: { kind: "days", days }, ...withStoredTemplate(raw.template) };
  }
  if (rule?.kind === "rule" && ["day", "week", "month", "year"].includes(rule.unit as string) && parseDay(rule.start)) {
    const every = typeof rule.every === "number" && rule.every >= 1 ? Math.min(99, Math.floor(rule.every)) : 1;
    const weekdays = Array.isArray(rule.weekdays) ? [...new Set(rule.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : undefined;
    return {
      series: raw.series,
      rev,
      rule: { kind: "rule", every, unit: rule.unit as RepeatUnit, ...(weekdays?.length ? { weekdays } : {}), start: rule.start as string, until: parseDay(rule.until) ? (rule.until as string) : null },
      ...withStoredTemplate(raw.template),
    };
  }
  return null;
}

/** The same day [n] months on, kept to the month's last day (31 Jan → 28 Feb, then back to 31 Mar). */
function monthsOn(start: Date, n: number) {
  const first = new Date(start.getFullYear(), start.getMonth() + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(start.getDate(), last));
}

/** The weekdays a weekly rule falls on (its start's weekday if none are set). */
export const ruleWeekdays = (rule: Extract<RepeatRule, { kind: "rule" }>) =>
  rule.weekdays?.length ? rule.weekdays : [parseDay(rule.start)!.getDay()];

/** The series' days from [from] to [to], both included (at most [limit]). */
export function repeatDays(rule: RepeatRule, from: Date, to: Date, limit = 400): Date[] {
  const lo = startOfDay(from);
  let hi = startOfDay(to);
  if (rule.kind === "days") {
    return rule.days
      .map(parseDay)
      .filter((d): d is Date => d != null && d >= lo && d <= hi)
      .slice(0, limit);
  }
  const start = parseDay(rule.start);
  if (!start) return [];
  const until = parseDay(rule.until);
  if (until && until < hi) hi = until;
  const out: Date[] = [];
  const every = Math.max(1, rule.every);
  const begin = lo > start ? lo : start;
  if (rule.unit === "day") {
    const skip = Math.ceil(daysBetween(start, begin) / every) * every;
    for (let d = addDays(start, skip); d <= hi && out.length < limit; d = addDays(d, every)) out.push(d);
  } else if (rule.unit === "week") {
    const weekdays = ruleWeekdays(rule);
    const firstWeek = startOfWeek(start);
    for (let d = begin; d <= hi && out.length < limit; d = addDays(d, 1)) {
      const week = Math.round(daysBetween(firstWeek, startOfWeek(d)) / 7);
      if (week % every === 0 && weekdays.includes(d.getDay())) out.push(d);
    }
  } else {
    const step = rule.unit === "month" ? every : every * 12;
    for (let k = 0; out.length < limit; k += step) {
      const d = monthsOn(start, k);
      if (d > hi) break;
      if (d >= begin) out.push(d);
    }
  }
  return out;
}

/** The series' first day after [day], if there is one (looking up to three years ahead). */
export function nextRepeatDay(rule: RepeatRule, day: Date): Date | null {
  return repeatDays(rule, addDays(day, 1), addDays(day, 3 * 366), 1)[0] ?? null;
}

/**
 * The days a series should have tasks on now: every picked day, or a rule's
 * days from today until [AHEAD_DAYS] ahead (and at least its next one).
 */
export function wantedDays(rule: RepeatRule, now = today()): Date[] {
  if (rule.kind === "days") return rule.days.map(parseDay).filter((d): d is Date => d != null);
  const days = repeatDays(rule, now, addDays(now, AHEAD_DAYS));
  if (!days.some((d) => d > now)) {
    const next = nextRepeatDay(rule, now);
    if (next) days.push(next);
  }
  return days;
}

/** The ID of the series' task on [day] made by a top-up. */
export const occurrenceId = (repeat: Pick<Repeat, "series" | "rev">, day: Date) => `${repeat.series}-r${repeat.rev}-${format(day, "yyyyMMdd")}`;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** Picked days as short runs: "Sun 12 Oct, Mon 13 – Sun 19 Oct". */
export function describeDays(days: Date[], max = 3): string {
  const runs: [Date, Date][] = [];
  for (const d of days) {
    const run = runs[runs.length - 1];
    if (run && daysBetween(run[1], d) === 1) run[1] = d;
    else runs.push([d, d]);
  }
  const label = ([a, b]: [Date, Date]) =>
    a.getTime() === b.getTime()
      ? format(a, "EEE d MMM")
      : a.getMonth() === b.getMonth()
        ? `${format(a, "EEE d")} – ${format(b, "EEE d MMM")}`
        : `${format(a, "EEE d MMM")} – ${format(b, "EEE d MMM")}`;
  const shown = runs.slice(0, max).map(label).join(", ");
  return runs.length > max ? `${shown} and ${runs.length - max} more` : shown;
}

/** "Every weekday", "Every 2 weeks on Sun", "8 days: Sun 12 – Sun 19 Oct". */
export function describeRepeat(rule: RepeatRule | null): string {
  if (!rule) return "Doesn’t repeat";
  if (rule.kind === "days") {
    const days = rule.days.map(parseDay).filter((d): d is Date => d != null);
    if (days.length <= 1) return "Doesn’t repeat";
    return `${days.length} days: ${describeDays(days, 2)}`;
  }
  const start = parseDay(rule.start)!;
  const until = parseDay(rule.until);
  const end = until ? `, until ${format(until, "d MMM")}` : "";
  const n = rule.every;
  switch (rule.unit) {
    case "day":
      return `${n === 1 ? "Every day" : `Every ${n} days`}${end}`;
    case "week": {
      const days = ruleWeekdays(rule);
      const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      if (n === 1 && days.length === 7) return `Every day${end}`;
      if (n === 1 && days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return `Every weekday${end}`;
      return `${n === 1 ? "Every week" : `Every ${n} weeks`} on ${sorted.map((d) => WEEKDAY[d]).join(", ")}${end}`;
    }
    case "month":
      return `${n === 1 ? "Every month" : `Every ${n} months`} on the ${ordinal(start.getDate())}${end}`;
    case "year":
      return `${n === 1 ? "Every year" : `Every ${n} years`} on ${format(start, "d MMM")}${end}`;
  }
}

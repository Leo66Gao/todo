"use client";

// Making, changing and topping up repeating tasks (see lib/repeat.ts).

import { uuid, type Task } from "@/lib/model";
import { AHEAD_DAYS, TOP_UP_DAYS, dayString, occurrenceId, readRepeat, repeatDays, templateOf, wantedDays, withTemplate, type Repeat, type RepeatRule } from "@/lib/repeat";
import { addDays, startOfDay, today } from "@/lib/time";
import { TRASH_PREFIX } from "./trash";
import { addTask, deleteTask, updateTask, useWorkspace } from "./workspace";

const tasksOf = (series: string) => useWorkspace.getState().tasks.filter((t) => readRepeat(t)?.series === series);

/** The fields every task in a series shares (what "this and upcoming" changes). */
const SHARED = ["title", "notes", "type", "priority", "difficulty", "durationMinutes", "projectId", "category"] as const;

/** A copy of [template] on [day], open, with the same time of day and its subtasks reset. */
export function occurrenceOf(template: Task, day: Date, repeat: Repeat, id: string): Task {
  const shift = Math.round((startOfDay(day).getTime() - startOfDay(template.date).getTime()) / 86_400_000);
  const start = template.startTime;
  const { milestone: _milestone, ...base } = template;
  void _milestone;
  return {
    ...base,
    id,
    date: startOfDay(day),
    startTime: start ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), start.getHours(), start.getMinutes()) : null,
    isDone: false,
    remainingMinutes: template.durationMinutes,
    subtasks: template.subtasks.map((s, i) => ({ ...s, id: `${id}-s${i}`, isDone: false, date: s.date ? addDays(s.date, shift) : null })),
    googleEventId: null,
    calendarEventRevision: 0,
    isConflictCopy: false,
    extra: { ...template.extra, repeat },
  };
}

const withRepeat = (task: Task, repeat: Repeat | null): Task => {
  const extra = { ...task.extra };
  if (repeat) extra.repeat = repeat;
  else delete extra.repeat;
  return { ...task, extra: Object.keys(extra).length ? extra : undefined };
};

/**
 * Makes [taskId] repeat by [rule] (or stops it with null). Open tasks of the
 * series from today on that no longer fall on one of its days are removed;
 * days without a task get a copy of this one. Done and past tasks stay.
 */
export function setRepeat(taskId: string, chosen: RepeatRule | null): { added: number; removed: number } {
  const task = useWorkspace.getState().tasks.find((t) => t.id === taskId);
  // A rule starts on the day of the task it's set on.
  const rule: RepeatRule | null = chosen?.kind === "rule" ? { ...chosen, start: dayString(task?.date ?? today()) } : chosen;
  if (!task) return { added: 0, removed: 0 };
  const current = readRepeat(task);
  const now = today();
  const members = current ? tasksOf(current.series) : [];
  if (!rule || (rule.kind === "days" && rule.days.length <= 1)) {
    if (!current) return { added: 0, removed: 0 };
    let removed = 0;
    for (const t of members) {
      if (t.id !== task.id && !t.isDone && t.date > task.date) {
        deleteTask(t.id);
        removed++;
      } else updateTask(withRepeat(t, null));
    }
    return { added: 0, removed };
  }
  // New days are made from this task as it is now, not from whichever task ends up last.
  const repeat: Repeat = { series: current?.series ?? task.id, rev: (current?.rev ?? 0) + 1, rule, template: templateOf(task) };
  const wanted = new Set(wantedDays(rule, now).map(dayString));
  wanted.add(dayString(task.date));
  let removed = 0;
  const kept: Task[] = [];
  // Picked days are all on show, so any open one can go; a rule changes the
  // series from this task on.
  const from = rule.kind === "days" ? now : task.date > now ? task.date : now;
  for (const t of members) {
    if (t.id !== task.id && !t.isDone && t.date >= from && !wanted.has(dayString(t.date))) {
      deleteTask(t.id);
      removed++;
    } else kept.push(t);
  }
  if (!kept.some((t) => t.id === task.id)) kept.push(task);
  for (const t of kept) updateTask(withRepeat(t, repeat));
  const template = withRepeat(task, repeat);
  const have = new Set(kept.map((t) => dayString(t.date)));
  let added = 0;
  for (const day of wantedDays(rule, now)) {
    const key = dayString(day);
    if (have.has(key)) continue;
    have.add(key);
    addTask(occurrenceOf(template, day, repeat, rule.kind === "days" ? uuid() : occurrenceId(repeat, day)));
    added++;
  }
  return { added, removed };
}

/** The open tasks in [task]'s series after it. */
export function upcomingOf(task: Task): Task[] {
  const repeat = readRepeat(task);
  if (!repeat) return [];
  return tasksOf(repeat.series).filter((t) => t.id !== task.id && !t.isDone && t.date > task.date);
}

/**
 * Ends [task]'s series the day before it, on every task of the series still
 * there, so it isn't topped up past that day again (after "delete this and
 * upcoming"). Returns a function that undoes it.
 */
export function endSeriesBefore(task: Task): () => void {
  const repeat = readRepeat(task);
  if (!repeat) return () => {};
  const last = dayString(addDays(task.date, -1));
  const before = tasksOf(repeat.series).filter((t) => t.id !== task.id);
  for (const t of before) {
    const own = readRepeat(t);
    if (!own) continue;
    const rule: RepeatRule =
      own.rule.kind === "rule"
        ? { ...own.rule, until: own.rule.until && own.rule.until < last ? own.rule.until : last }
        : { kind: "days", days: own.rule.days.filter((d) => d <= last) };
    updateTask(withRepeat(t, { ...own, rule }));
  }
  return () => {
    for (const t of before) {
      const now = useWorkspace.getState().tasks.find((x) => x.id === t.id);
      if (now) updateTask(withRepeat(now, readRepeat(t)));
    }
  };
}

/** Whether saving [after] over [before] changes something the series shares. */
export function changesShared(before: Task, after: Task): boolean {
  const clock = (d: Date | null) => (d ? d.getHours() * 60 + d.getMinutes() : null);
  return (
    SHARED.some((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])) ||
    clock(before.startTime) !== clock(after.startTime) ||
    before.extra?.difficultySelected !== after.extra?.difficultySelected
  );
}

/** Copies the shared fields (and the time of day) of [task] to the series' upcoming tasks, and to the days still to be made. */
export function applyToUpcoming(task: Task) {
  const repeat = readRepeat(task);
  for (const t of upcomingOf(task)) {
    const next: Task = { ...t };
    for (const f of SHARED) Object.assign(next, { [f]: task[f] });
    const start = task.startTime;
    next.startTime = start ? new Date(t.date.getFullYear(), t.date.getMonth(), t.date.getDate(), start.getHours(), start.getMinutes()) : null;
    if (t.durationMinutes !== task.durationMinutes) next.remainingMinutes = task.durationMinutes;
    const extra = { ...t.extra };
    if (task.extra?.difficultySelected) extra.difficultySelected = true;
    else delete extra.difficultySelected;
    next.extra = extra;
    updateTask(next);
  }
  if (!repeat) return;
  const template = templateOf(task);
  for (const t of tasksOf(repeat.series)) {
    const own = readRepeat(t);
    if (own) updateTask(withRepeat(t, { ...own, template }));
  }
}

/**
 * Keeps every rule's tasks a few weeks ahead: when a series' last task is
 * less than [TOP_UP_DAYS] away, the days up to [AHEAD_DAYS] ahead are added,
 * made from the series' template (older series: from that last task). Only
 * the end is extended, so a day you deleted doesn't come back.
 */
export function topUpRepeats(now = today()) {
  const series = new Map<string, Task[]>();
  for (const t of useWorkspace.getState().tasks) {
    const repeat = readRepeat(t);
    if (repeat?.rule.kind === "rule") series.set(repeat.series, [...(series.get(repeat.series) ?? []), t]);
  }
  for (const members of series.values()) {
    // The newest revision of the series decides (an older device may still hold old ones).
    const rev = Math.max(...members.map((t) => readRepeat(t)!.rev));
    const current = members.filter((t) => readRepeat(t)!.rev === rev).sort((a, b) => a.date.getTime() - b.date.getTime());
    const last = current[current.length - 1];
    if (!last) continue;
    const repeat = readRepeat(last)!;
    if (last.date >= addDays(now, TOP_UP_DAYS)) continue;
    const from = last.date >= now ? addDays(last.date, 1) : now;
    const days = repeatDays(repeat.rule, from, addDays(now, AHEAD_DAYS));
    const { tasks, side } = useWorkspace.getState();
    const ids = new Set(tasks.map((t) => t.id));
    for (const day of days) {
      const id = occurrenceId(repeat, day);
      // A day deleted at the end of the series stays deleted.
      // From the series' template: a change made to the last task alone stays on it.
      const source = repeat.template ? withTemplate(last, repeat.template) : last;
      if (!ids.has(id) && !(`${TRASH_PREFIX}task:${id}` in side)) addTask(occurrenceOf(source, day, repeat, id));
    }
  }
}

let started = false;
/** Tops repeating tasks up once the workspace has loaded (after the first cloud download when signed in), then daily. */
export function startRepeats() {
  if (started) return;
  started = true;
  let day = "";
  const check = () => {
    const s = useWorkspace.getState();
    if (s.isLoading || (s.user && !s.syncDetails.lastDownloadedAt)) return;
    const key = `${s.user?.uid ?? ""}:${dayString(today())}`;
    if (key === day) return;
    day = key;
    topUpRepeats();
  };
  useWorkspace.subscribe(check);
  setInterval(check, 60_000);
  check();
}

/** What a change to a series did, in words ("Added 10 days and removed 2"), or null for nothing. */
export function repeatSummary({ added, removed }: { added: number; removed: number }): string | null {
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  if (added && removed) return `Added ${days(added)} and removed ${removed}`;
  if (added) return `Added ${days(added)}`;
  if (removed) return `Removed ${days(removed)}`;
  return null;
}

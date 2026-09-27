// The upcoming list (the original app's Schedule): everything from today
// on, day by day, with empty stretches folded into one line.

import { format } from "date-fns";
import type { Task } from "./model";
import { addDays, dayKey, sameDay, today } from "./time";

export type UpcomingRow = { kind: "day"; date: Date; tasks: Task[] } | { kind: "gap"; from: Date; to: Date };

/** Days with tasks from `from` on (timed tasks first each day), and the gaps between them. */
export function upcomingRows(all: Task[], from = today()): UpcomingRow[] {
  const start = from.getTime();
  const byDay = new Map<string, { date: Date; tasks: Task[] }>();
  for (const t of all) {
    if (t.date.getTime() < start) continue;
    const key = dayKey(t.date);
    const entry = byDay.get(key) ?? { date: new Date(t.date.getFullYear(), t.date.getMonth(), t.date.getDate()), tasks: [] };
    entry.tasks.push(t);
    byDay.set(key, entry);
  }
  const days = [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  const rows: UpcomingRow[] = [];
  let previous: Date | null = null;
  for (const day of days) {
    if (previous) {
      const gapStart = addDays(previous, 1);
      const gapEnd = addDays(day.date, -1);
      if (gapEnd.getTime() >= gapStart.getTime()) rows.push({ kind: "gap", from: gapStart, to: gapEnd });
    }
    // Open before done; timed in time order, then the rest in list order.
    const tasks = [...day.tasks].sort((a, b) => {
      if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
      if (a.startTime && b.startTime) return a.startTime.getTime() - b.startTime.getTime();
      if (a.startTime || b.startTime) return a.startTime ? -1 : 1;
      return 0;
    });
    rows.push({ kind: "day", date: day.date, tasks });
    previous = day.date;
  }
  return rows;
}

/** "5 Oct", "3 – 9 Oct", or "28 Sep – 3 Oct" across months. */
export function gapLabel(from: Date, to: Date) {
  if (sameDay(from, to)) return format(from, "d MMM");
  return from.getMonth() === to.getMonth()
    ? `${format(from, "d")} – ${format(to, "d MMM")}`
    : `${format(from, "d MMM")} – ${format(to, "d MMM")}`;
}


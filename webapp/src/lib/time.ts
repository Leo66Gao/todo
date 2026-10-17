import { format } from "date-fns";

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const today = () => startOfDay(new Date());

/** Whole days from today to [d] (negative in the past). */
export const daysFromToday = (d: Date) =>
  Math.round((startOfDay(d).getTime() - today().getTime()) / 86400000);

export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Monday-first start of the week containing [d]. */
export function startOfWeek(d: Date) {
  const day = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -day);
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "No time set";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Compact duration for tight spots: 45m, 2h, 1h30. */
export function formatDurationShort(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

const two = (n: number) => String(n).padStart(2, "0");

/** 24-hour clock with a dot, as the Flutter app shows times: 15.30 */
export const formatClock = (d: Date) => `${two(d.getHours())}.${two(d.getMinutes())}`;

export function formatTimeRange(start: Date, minutes: number) {
  if (minutes <= 0) return formatClock(start);
  return `${formatClock(start)}–${formatClock(new Date(start.getTime() + minutes * 60000))}`;
}

export function isOverdue(date: Date, isDone = false) {
  return !isDone && startOfDay(date).getTime() < today().getTime();
}

/** Short due status: "Today", "Tomorrow", "In 5 days", "3 days overdue". */
export function dueLabel(date: Date, isDone = false) {
  if (isDone) return "Completed";
  const days = daysFromToday(date);
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/** Friendly day name relative to today: Today, Tomorrow, Yesterday, Mon 28 Sep. */
export function relativeDay(date: Date, withYear = false) {
  const days = daysFromToday(date);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return format(date, "EEEE");
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, withYear || !sameYear ? "EEE d MMM yyyy" : "EEE d MMM");
}

export const pluralize = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

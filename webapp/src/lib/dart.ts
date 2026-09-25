// Interop helpers for values written by the Flutter app (Dart's DateTime
// serialization and enum.toString()). Both apps share the same Firestore
// records, so everything here must round-trip exactly the way Dart does.

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * Dart's `DateTime.toIso8601String()` for a local time:
 * `2026-09-25T13:30:00.000`. No offset — Dart reads it back as local time.
 */
export function toDartIso(date: Date): string {
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}`
  );
}

const LOCAL_ISO =
  /^([+-]?\d{4,6})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d{1,9}))?)?)?)?$/;

/**
 * Parses what Dart's `DateTime.parse` accepts. Strings without an offset are
 * local times (the common case); `Z`/`+hh:mm` strings are converted to local.
 * Returns null for anything unreadable.
 */
export function parseDartDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const local = LOCAL_ISO.exec(value.trim());
  if (local) {
    const [, y, mo, d, h = "0", mi = "0", s = "0", frac = ""] = local;
    const ms = frac ? Number((frac + "000").slice(0, 3)) : 0;
    const date = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
      ms,
    );
    // Years 0–99 would otherwise be mapped to 1900–1999.
    if (Number(y) < 100) date.setFullYear(Number(y));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  // Offset forms: trim fractional digits beyond milliseconds for JS.
  const normalized = value
    .trim()
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type TaskType = "todo" | "assignment";
export type Priority = "none" | "low" | "medium" | "high" | "critical";

export const PRIORITIES: Priority[] = ["none", "low", "medium", "high", "critical"];

export const encodeTaskType = (t: TaskType) => `TaskType.${t}`;
export const decodeTaskType = (raw: unknown): TaskType =>
  raw === "TaskType.assignment" ? "assignment" : "todo";

export const encodePriority = (p: Priority) => `TaskPriority.${p}`;
export function decodePriority(raw: unknown): Priority | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/^TaskPriority\./, "");
  return (PRIORITIES as string[]).includes(name) && raw.startsWith("TaskPriority.")
    ? (name as Priority)
    : null;
}

/** Flutter colours are 32-bit ARGB ints (e.g. 0xFF2196F3). */
export function argbToCss(value: number | undefined | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "#8E8E93";
  const v = value >>> 0;
  const a = ((v >>> 24) & 0xff) / 255;
  const r = (v >>> 16) & 0xff;
  const g = (v >>> 8) & 0xff;
  const b = v & 0xff;
  return a >= 0.999 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a.toFixed(3)})`;
}

export function hexToArgb(hex: string): number {
  const clean = hex.replace("#", "");
  return (0xff000000 | parseInt(clean.slice(0, 6), 16)) >>> 0;
}

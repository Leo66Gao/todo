// Time entry, matching the Flutter app: "16", "18.30", "18:30", "6pm",
// "9.15am", "10:45pm". A trailing time in a task title sets its start time.

export interface ClockTime {
  hour: number;
  minute: number;
}

const TOKEN = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i;

export function parseTimeToken(text: string): ClockTime | null {
  const match = TOKEN.exec(text.trim());
  if (!match) {
    // Also accept compact 24h input like "1530" or "930".
    const compact = /^(\d{1,2})(\d{2})$/.exec(text.trim());
    if (!compact) return null;
    const hour = Number(compact[1]);
    const minute = Number(compact[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (meridiem) {
    if (hour > 12 || hour === 0) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  return { hour, minute };
}

/** Splits a trailing time off a title: "Gym 18.30" → ("Gym", 18:30). */
export function parseTimeFromTitle(title: string): { title: string; time: ClockTime | null } {
  const trimmed = title.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return { title: trimmed, time: null };
  const last = parts[parts.length - 1];
  // Same rule as Flutter: the last word must be a time on its own.
  const match = /^(\d{1,2})([:.](\d{2}))?\s*(am|pm)?$/i.exec(last);
  if (!match) return { title: trimmed, time: null };
  const time = parseTimeToken(last);
  if (!time) return { title: trimmed, time: null };
  const rest = parts.slice(0, -1).join(" ");
  return rest ? { title: rest, time } : { title: trimmed, time: null };
}

export const clockOf = (d: Date): ClockTime => ({ hour: d.getHours(), minute: d.getMinutes() });

export const withClock = (day: Date, t: ClockTime) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), t.hour, t.minute);

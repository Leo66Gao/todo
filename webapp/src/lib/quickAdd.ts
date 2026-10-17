// Natural language in a task's title: "physics IA draft fri 3pm 2h",
// "essay due 12 oct", "gym tomorrow at 7 #pe !", "physics review fri 18-20 urgent". Each recognised phrase is
// reported with where it is, so it can be shown, applied, or ignored.

import type { Priority } from "./dart";
import { addDays, startOfDay } from "./time";
import { parseTimeToken, type ClockTime } from "./timeParse";

/** Words a trailing number counts rather than tells the time of. */
const COUNTED = /^(?:ch|chap|chapter|chapters|p|pg|pp|page|pages|unit|units|section|sections|sec|q|qs|question|questions|lesson|lessons|ex|exs|exercise|exercises|topic|topics|part|problem|problems|set|week|weeks|lecture|lab|test|quiz|no|nos|nr|slide|slides|module|level|grade|year|paper|essay|draft|kapitel|seite|luku|sivu|tehtävä|tehtävät)$/;

export type TokenKind = "date" | "time" | "duration" | "subject" | "priority";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  /** Kept in the title (a subject named in passing, like "physics IA"). */
  keep?: boolean;
}

export interface QuickAdd {
  /** The title with the recognised phrases taken out. */
  title: string;
  date?: Date;
  due?: boolean;
  time?: ClockTime;
  minutes?: number;
  projectId?: string;
  priority?: Priority;
  tokens: Token[];
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const weekday = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  const alias: Record<string, number> = { tues: 2, weds: 3, thur: 4, thurs: 4 };
  if (alias[w] != null) return alias[w];
  return WEEKDAYS.findIndex((d) => d === w || (w.length === 3 && d.startsWith(w)));
};
const month = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  if (w === "sept") return 8;
  return MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)));
};

/** The next date on this weekday (a week ahead when it's today). */
function nextWeekday(now: Date, day: number, skipWeek = false) {
  let diff = (day - now.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  if (skipWeek && diff < 7) diff += 7;
  return addDays(startOfDay(now), diff);
}

/** A day and month, this year or next if it has passed. */
function dayMonth(now: Date, day: number, m: number): Date | null {
  if (m < 0 || m > 11 || day < 1 || day > 31) return null;
  let date = new Date(now.getFullYear(), m, day);
  if (date.getMonth() !== m) return null;
  if (date < startOfDay(now)) date = new Date(now.getFullYear() + 1, m, day);
  return date;
}

export interface QuickAddContext {
  now: Date;
  projects: { id: string; title: string }[];
  /** Kinds not to look for (already set by hand, or dismissed). */
  ignore?: TokenKind[];
}

export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAdd {
  const result: QuickAdd = { title: text.trim(), tokens: [] };
  const taken: boolean[] = new Array(text.length).fill(false);
  const free = (start: number, end: number) => !taken.slice(start, end).some(Boolean);
  const ignored = new Set(ctx.ignore ?? []);
  const take = (kind: TokenKind, start: number, end: number, keep = false) => {
    for (let i = start; i < end; i++) taken[i] = true;
    result.tokens.push({ kind, start, end, keep });
  };
  /** Every match of a whole-word pattern not already used. */
  const scan = (pattern: RegExp, run: (m: RegExpExecArray, start: number, end: number) => boolean | void) => {
    // (Not part of a number like "3.1" or "1.10": "Maths 3.1-3.4" holds no time.)
    const re = new RegExp(`(?<![\\p{L}\\p{N}#!])(?<!\\d[.,:])(?:${pattern.source})(?![\\p{L}\\p{N}])(?![.,:]\\d)`, "giu");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      if (free(start, end)) run(m, start, end);
    }
  };
  const now = ctx.now;
  /**
   * The word before `start` counts things ("section 2.30", "exercises 1.10
   * to 1.20"). A range also counts after "numbers" or "days" ("numbers
   * 1-5"); a single number there is a time ("complex numbers 10").
   */
  const counted = (start: number, range = false) => {
    const word = (/(\S+)\s*$/.exec(text.slice(0, start))?.[1] ?? "").toLowerCase().replace(/[.:#]+$/, "");
    return COUNTED.test(word) || (range && /^(?:numbers?|days?)$/.test(word));
  };

  // Dates -------------------------------------------------------------------
  const setDate = (date: Date | null, start: number, end: number) => {
    if (!date || result.date || ignored.has("date")) return false;
    result.date = date;
    take("date", start, end);
    return true;
  };
  // "due" before a date makes it an assignment's deadline.
  const withDue = (source: string) => new RegExp(`(?:due\\s+(?:on\\s+|by\\s+)?|on\\s+|by\\s+)?${source}`);
  const isDue = (m: RegExpExecArray) => /^due\b/i.test(m[0]);

  scan(withDue("(today|tod|tonight|tomorrow|tmrw?|tmr)"), (m, s, e) => {
    const w = m[1].toLowerCase();
    if (setDate(addDays(startOfDay(now), w.startsWith("to") && w !== "tomorrow" ? 0 : 1), s, e)) result.due ||= isDue(m);
  });
  scan(withDue("in\\s+(\\d{1,2}|a|one|two|three)\\s+(days?|weeks?)"), (m, s, e) => {
    const n = { a: 1, one: 1, two: 2, three: 3 }[m[1].toLowerCase() as "a"] ?? Number(m[1]);
    if (setDate(addDays(startOfDay(now), n * (m[2].toLowerCase().startsWith("w") ? 7 : 1)), s, e)) result.due ||= isDue(m);
  });
  scan(withDue("next\\s+week"), (m, s, e) => {
    if (setDate(nextWeekday(now, 1), s, e)) result.due ||= isDue(m);
  });
  scan(withDue("(?:(next|this)\\s+)?([a-z]{3,9}\\.?)"), (m, s, e) => {
    const word = m[2];
    const day = weekday(word);
    // "SAT" (the test) isn't Saturday.
    if (day < 0 || (word.length === 3 && word === word.toUpperCase())) return;
    // "fri" on a Friday is next week's; "this fri" is today.
    const which = m[1]?.toLowerCase();
    const date = which === "this" && day === now.getDay() ? startOfDay(now) : nextWeekday(now, day, which === "next");
    if (setDate(date, s, e)) result.due ||= isDue(m);
  });
  scan(withDue("(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?([a-z]{3,9}\\.?)"), (m, s, e) => {
    if (setDate(dayMonth(now, Number(m[1]), month(m[2])), s, e)) result.due ||= isDue(m);
  });
  scan(withDue("([a-z]{3,9}\\.?)\\s+(\\d{1,2})(?:st|nd|rd|th)?"), (m, s, e) => {
    if (setDate(dayMonth(now, Number(m[2]), month(m[1])), s, e)) result.due ||= isDue(m);
  });
  scan(withDue("(\\d{1,2})/(\\d{1,2})"), (m, s, e) => {
    if (setDate(dayMonth(now, Number(m[1]), Number(m[2]) - 1), s, e)) result.due ||= isDue(m);
  });

  // Time ranges: "18-20", "18.00–19.30", "6-8pm", "from 4 to 5:30pm" set the
  // start and the length. A bare "12-14" after "pages" or "questions" is a
  // range of those, not of hours.
  let rangeMinutes = 0;
  const T = "\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm)?";
  scan(new RegExp(`(?:from\\s+|at\\s+)?(${T})\\s*(?:-|–|—|to|until|till)\\s*(${T})`), (m, s, e) => {
    if (result.time || ignored.has("time")) return;
    // Marked as a time: "from", "at", or am/pm.
    const marked = /am|pm/i.test(m[1] + m[2]) || /^(?:from|at)\b/i.test(m[0]);
    const plain = !marked && !/[:.]/.test(m[1] + m[2]);
    const endText = m[2].replace(/\s+/g, "");
    let startText = m[1].replace(/\s+/g, "");
    // "6-8pm": the start takes the end's half of the day.
    const half = /(am|pm)$/i.exec(endText);
    if (half && !/(am|pm)$/i.test(startText)) startText += half[1];
    const start = parseTimeToken(startText);
    const end = parseTimeToken(endText);
    if (!start || !end) return;
    // After "pages" or "exercises" it's a range of those, unless it can only
    // be hours ("lab 14.00-16.00"); and an unmarked start before 6 is rarely meant.
    if (!marked && ((counted(s, true) && (plain || start.hour < 7)) || (!plain && start.hour < 6))) return;
    let length = end.hour * 60 + end.minute - (start.hour * 60 + start.minute);
    // "6pm-8" reads as 18–20.
    if (length <= 0 && end.hour < 12 && start.hour >= 12) length += 12 * 60;
    if (length <= 0 || length > 16 * 60) return;
    result.time = start;
    rangeMinutes = length;
    take("time", s, e);
  });

  // Durations (before times, so "2h" isn't read as a time) -----------------
  scan(/(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)(?:\s*(\d{1,2})\s*(?:m|min|mins|minutes?)?)?|(?:for\s+)?(\d{1,3})\s*(m|min|mins|minutes)/, (m, s, e) => {
    if (result.minutes || ignored.has("duration")) return;
    const minutes = m[1] ? Math.round(Number(m[1]) * 60) + (m[3] ? Number(m[3]) : 0) : Number(m[4]);
    if (minutes <= 0 || minutes > 24 * 60) return;
    result.minutes = minutes;
    take("duration", s, e);
  });

  // A range's length, unless a length was also given ("run 7-9 1h").
  if (rangeMinutes && !result.minutes && !ignored.has("duration")) result.minutes = rangeMinutes;

  // Times -------------------------------------------------------------------
  scan(/(?:at\s+|@\s*)?(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm))|(?:at\s+|@\s*)(\d{1,2}(?:[:.]\d{2})?)|(\d{1,2}[:.]\d{2})/, (m, s, e) => {
    if (result.time || ignored.has("time")) return;
    const time = parseTimeToken((m[1] ?? m[2] ?? m[3]).replace(/\s+/g, ""));
    if (!time) return;
    // A bare "2.30" after "section", or before 6 in the morning, is a number, not a time.
    if (m[3] && ((counted(s) && time.hour < 7) || time.hour < 6)) return;
    result.time = time;
    take("time", s, e);
  });
  // Like the phone app: a bare hour at the very end ("Gym 18"), but not a
  // number that counts something ("Revise ch 3", "Exercise 12").
  if (!result.time && !ignored.has("time")) {
    const last = /\s(\d{1,2})\s*$/.exec(text);
    const before = last ? (/(\S+)\s*$/.exec(text.slice(0, last.index))?.[1] ?? "").toLowerCase().replace(/[.:#]+$/, "") : "";
    if (last && !COUNTED.test(before) && free(last.index + 1, text.trimEnd().length)) {
      const time = parseTimeToken(last[1]);
      if (time) {
        result.time = time;
        take("time", last.index + 1, text.trimEnd().length);
      }
    }
  }

  // Priority ------------------------------------------------------------------
  const priorityRe = /(?<![\p{L}\p{N}])(!{1,3}|!(?:low|medium|med|high|urgent|critical)|p[1-3])(?![\p{L}\p{N}!])/giu;
  for (let m = priorityRe.exec(text); m; m = priorityRe.exec(text)) {
    if (result.priority || ignored.has("priority") || !free(m.index, m.index + m[0].length)) continue;
    const t = m[1].toLowerCase();
    result.priority =
      t === "!!!" || t === "p1" || t === "!urgent" || t === "!critical"
        ? "critical"
        : t === "!!" || t === "p2" || t === "!high"
          ? "high"
          : t === "!" || t === "p3" || t === "!medium" || t === "!med"
            ? "medium"
            : "low";
    take("priority", m.index, m.index + m[0].length);
  }

  // Priority in words: "urgent", "high priority", "low prio"; "critical" or
  // "important" only as the last word (so "critical thinking" stays a title).
  if (!result.priority && !ignored.has("priority")) {
    const named = (word: string): Priority =>
      /^(urgent|critical|crit)/i.test(word) ? "critical" : /^high/i.test(word) || /^important/i.test(word) ? "high" : /^(medium|med)/i.test(word) ? "medium" : "low";
    scan(/(?:(urgent|critical|crit|high|medium|med|low)\s+prio(?:rity)?|prio(?:rity)?\s*[:=]?\s*(urgent|critical|crit|high|medium|med|low)|(urgent|asap))/, (m, s, e) => {
      if (result.priority) return;
      result.priority = named(m[1] ?? m[2] ?? (m[3].toLowerCase() === "asap" ? "high" : m[3]));
      take("priority", s, e);
    });
    if (!result.priority) {
      const last = /\s(critical|important)\s*$/i.exec(text);
      if (last && free(last.index + 1, text.trimEnd().length)) {
        result.priority = named(last[1]);
        take("priority", last.index + 1, text.trimEnd().length);
      }
    }
  }

  // Subject: "#physics" (taken out), or its name in passing (kept) ----------
  const words = (title: string) =>
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !["hl", "sl", "aa", "ai"].includes(w));
  const hashRe = /#([\p{L}\p{N}][\p{L}\p{N}-]*)/gu;
  for (let m = hashRe.exec(text); m; m = hashRe.exec(text)) {
    if (result.projectId || ignored.has("subject")) break;
    const tag = m[1].toLowerCase();
    const project = ctx.projects.find((p) => words(p.title).some((w) => w.startsWith(tag) || tag.startsWith(w)));
    if (project) {
      result.projectId = project.id;
      take("subject", m.index, m.index + m[0].length);
    }
  }
  if (!result.projectId && !ignored.has("subject")) {
    for (const p of ctx.projects) {
      const main = words(p.title)[0];
      if (!main || main.length < 4) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${main}(?![\\p{L}\\p{N}])`, "iu");
      const m = re.exec(text);
      if (m && free(m.index, m.index + m[0].length)) {
        result.projectId = p.id;
        take("subject", m.index, m.index + m[0].length, true);
        break;
      }
    }
  }

  // What's left is the title.
  result.tokens.sort((a, b) => a.start - b.start);
  let title = "";
  let cursor = 0;
  for (const t of result.tokens) {
    if (t.keep) continue;
    title += text.slice(cursor, t.start);
    cursor = t.end;
  }
  title += text.slice(cursor);
  result.title = title.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/[\s,;:–—-]+$/, "").trim();
  return result;
}


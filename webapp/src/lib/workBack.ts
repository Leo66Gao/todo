// Working back from a deadline: the request to the AI helper, and making
// sure what comes back is a usable plan (real dates, in range, in order).

import { format } from "date-fns";
import type { ChatMessage } from "./ai";
import { addDays, startOfDay } from "./time";

export interface Step {
  title: string;
  date: Date;
  minutes?: number;
}

export interface WorkBackInput {
  title: string;
  subject?: string;
  notes?: string;
  deadline: Date;
  today: Date;
  minutes: number;
  existing: string[];
  /** Open tasks on each day from today to the deadline. */
  load: Map<number, number>;
  request?: string;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const label = (d: Date) => format(d, "yyyy-MM-dd (EEEE)");

/** The last day a step can be on: the day before the deadline, or today. */
export function lastStepDay(deadline: Date, today: Date) {
  const before = addDays(startOfDay(deadline), -1);
  return before < startOfDay(today) ? startOfDay(today) : before;
}

export function workBackMessages(input: WorkBackInput): ChatMessage[] {
  const last = lastStepDay(input.deadline, input.today);
  const days: string[] = [];
  for (let d = startOfDay(input.today); d <= last; d = addDays(d, 1)) {
    days.push(`${format(d, "yyyy-MM-dd EEE")}: ${input.load.get(d.getTime()) ?? 0}`);
  }
  const hours = Math.round((input.minutes / 60) * 10) / 10;
  const lines = [
    `Assignment: ${input.title}`,
    input.subject && `Subject: ${input.subject}`,
    `Deadline: ${label(input.deadline)}`,
    `Today: ${label(input.today)}`,
    input.minutes > 0 && `Time it needs in total: about ${hours} hours`,
    input.notes?.trim() && `Notes:\n${input.notes.trim().slice(0, 1500)}`,
    input.existing.length > 0 && `Steps it already has:\n${input.existing.map((s) => `- ${s}`).join("\n")}`,
    `Open tasks on each day:\n${days.slice(0, 60).join("\n")}`,
    input.request?.trim() && `The student adds: ${input.request.trim().slice(0, 500)}`,
    "",
    "Rules:",
    "- 3 to 7 steps, in the order they should be done.",
    `- Dates from ${iso(input.today)} to ${iso(last)}. Spread the steps out, prefer days with fewer tasks, and leave a day spare before the deadline when there is room.`,
    "- Titles: concrete, at most 8 words, starting with a verb, in the language of the assignment title.",
    "- Don't repeat steps it already has.",
    '- minutes: a realistic time for the step.',
    "",
    'Answer as {"steps":[{"title":"…","date":"YYYY-MM-DD","minutes":60}]}',
  ];
  return [
    {
      role: "system",
      content:
        "You help a secondary-school student plan an assignment by breaking it into steps and dating each one, working back from the deadline. Answer with JSON only.",
    },
    { role: "user", content: lines.filter((l) => l !== false && l !== undefined && l !== "").join("\n").replace(/\nRules:/, "\n\nRules:") },
  ];
}

/** The AI's answer as steps within range, in date order. */
export function readSteps(answer: unknown, deadline: Date, today: Date): Step[] {
  const raw = (answer as { steps?: unknown })?.steps;
  if (!Array.isArray(raw)) return [];
  const first = startOfDay(today);
  const last = lastStepDay(deadline, today);
  const steps: Step[] = [];
  for (const item of raw.slice(0, 8)) {
    const { title, date, minutes } = (item ?? {}) as { title?: unknown; date?: unknown; minutes?: unknown };
    if (typeof title !== "string" || !title.trim()) continue;
    const m = typeof date === "string" ? date.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
    let day = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : last;
    if (Number.isNaN(day.getTime())) day = last;
    if (day < first) day = first;
    if (day > last) day = last;
    steps.push({
      title: title.trim().replace(/\.$/, "").slice(0, 120),
      date: day,
      minutes: typeof minutes === "number" && minutes > 0 && minutes <= 24 * 60 ? Math.round(minutes) : undefined,
    });
  }
  return steps.sort((a, b) => a.date.getTime() - b.date.getTime());
}

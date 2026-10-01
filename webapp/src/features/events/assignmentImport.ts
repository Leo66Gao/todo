"use client";

// Turns the events of a chosen calendar into assignments: for a school
// platform's feed (ManageBac, Toddle, …) subscribed to in Google Calendar.
// Each event maps to one task with a fixed ID, so it is imported once; an
// assignment you delete stays deleted; and when the school moves a deadline,
// the assignment follows unless you have changed it yourself.

import type { Project } from "@/lib/model";
import { getLocal, setLocal } from "@/lib/prefs";
import { startOfDay } from "@/lib/time";
import { ensureMonths, modeOf, setMonthListener, useGoogleEvents, type GEvent } from "@/lib/googleEvents";
import { addTask, newTask, updateTask, useWorkspace } from "@/store/workspace";

/** What was last imported for each task (to tell the school's edits from yours). */
type Imported = Record<string, { title: string; date: number }>;
const importedKey = (uid: string) => `gcal.imported.${uid}`;

export function importedTaskId(event: Pick<GEvent, "calendarId" | "id">) {
  let h = 2166136261;
  const text = `${event.calendarId}|${event.id}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `import-${(h >>> 0).toString(36)}-${event.id.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "")}`;
}

const ALIASES: Record<string, string[]> = {
  maths: ["math", "mathematics", "maths"],
  math: ["math", "mathematics", "maths"],
  lit: ["lit", "literature"],
  english: ["english", "eng"],
  chemistry: ["chemistry", "chem"],
  biology: ["biology", "bio"],
  physics: ["physics", "phys"],
  economics: ["economics", "econ"],
  history: ["history", "hist"],
  computer: ["computer", "cs", "comp"],
  science: ["science", "sci"],
  tok: ["tok", "theory of knowledge"],
};

/** The subject an event belongs to, from its title and notes (best word match). */
export function matchSubject(text: string, projects: Project[]): string | null {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let best: { id: string; score: number } | null = null;
  for (const p of projects) {
    const words = p.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    if (words.length === 0) continue;
    // Level markers (HL/SL, AA/AI) only break ties between the same subject.
    const main = words.filter((w) => !["hl", "sl", "aa", "ai"].includes(w));
    const hits = (main.length ? main : words).filter((w) => (ALIASES[w] ?? [w]).some((a) => haystack.includes(` ${a} `))).length;
    if (hits === 0) continue;
    const extra = words.filter((w) => ["hl", "sl", "aa", "ai"].includes(w) && haystack.includes(` ${w} `)).length;
    const score = hits / Math.max(1, main.length) + extra * 0.1;
    if (score >= 1 && (!best || score > best.score)) best = { id: p.id, score };
  }
  return best?.id ?? null;
}

/** Brings assignments in line with one month of a feed's events. */
export function importAssignments(events: GEvent[]) {
  const { user, tasks, projects, isLoading } = useWorkspace.getState();
  if (!user || isLoading) return;
  const calendars = useGoogleEvents.getState().calendars;
  const feeds = new Set(calendars.filter((c) => modeOf(c) === "assignments").map((c) => c.id));
  if (feeds.size === 0) return;
  const imported = getLocal<Imported>(importedKey(user.uid), {});
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const cutoff = startOfDay(new Date()).getTime() - 86_400_000;
  let changed = false;
  for (const event of events) {
    if (!feeds.has(event.calendarId) || event.start.getTime() < cutoff) continue;
    const id = importedTaskId(event);
    const date = startOfDay(event.allDay ? event.start : new Date(event.start.getTime()));
    const title = event.title.replace(/^(due|deadline)\s*[:\-–]\s*/i, "").trim() || event.title;
    const task = byId.get(id);
    const last = imported[id];
    if (!task) {
      if (last) continue; // Imported before and deleted since: leave it deleted.
      addTask(
        newTask({
          id,
          title,
          date,
          type: "assignment",
          durationMinutes: 120,
          projectId: matchSubject(`${event.title} ${event.description ?? ""} ${event.location ?? ""}`, projects),
        }),
      );
      imported[id] = { title, date: date.getTime() };
      changed = true;
    } else if (last && (last.title !== title || last.date !== date.getTime())) {
      // The school changed it: follow, unless you edited the assignment yourself.
      const yours = task.title !== last.title || task.date.getTime() !== last.date;
      if (!yours && !task.isDone) updateTask({ ...task, title, date });
      imported[id] = { title, date: date.getTime() };
      changed = true;
    } else if (!last) {
      imported[id] = { title: task.title, date: task.date.getTime() };
      changed = true;
    }
  }
  if (changed) setLocal(importedKey(user.uid), imported);
}

/** Keeps the coming months of every assignment feed loaded (and so imported). */
function keepAhead() {
  const { calendarConnected } = useWorkspace.getState();
  const { calendars, modes } = useGoogleEvents.getState();
  if (!calendarConnected || !calendars.some((c) => modeOf(c, modes) === "assignments")) return;
  const now = new Date();
  ensureMonths(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 4, 1));
}

let started = false;
export function startAssignmentImport() {
  if (started || typeof window === "undefined") return;
  started = true;
  setMonthListener((_key, events) => importAssignments(events));
  useWorkspace.subscribe((s, prev) => {
    if (s.calendarConnected !== prev.calendarConnected || s.isLoading !== prev.isLoading) keepAhead();
  });
  useGoogleEvents.subscribe((s, prev) => {
    if (s.modes !== prev.modes || s.calendars !== prev.calendars) keepAhead();
  });
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && keepAhead());
  keepAhead();
}

"use client";

// Two ways to add work with AI that never make you wait: the task appears at
// once with what's known, and the AI fills in the rest in the background.
//
// - Smart add: the typed sentence ("essay draft by fri, 2h, hard, history")
//   becomes a fully set task.
// - From a photo: text is read on the device (OCR), then turned into an
//   assignment with its subtasks and milestones, or a handful of tasks.

import { create } from "zustand";
import { format } from "date-fns";
import { PRIORITIES, type Priority } from "./dart";
import { chatJson, AiError, useAiKey } from "./ai";
import { uuid, type Subtask, type Task } from "./model";
import { startOfDay, today } from "./time";
import { addTask, deleteTask, newTask, updateTask, useWorkspace } from "@/store/workspace";
import { toast } from "@/ui/toast";

/** Tasks the AI is still working on (rows show a shimmer). */
export const useAiPending = create<{ ids: string[] }>(() => ({ ids: [] }));
const pending = (id: string, on: boolean) =>
  useAiPending.setState((s) => ({ ids: on ? [...s.ids, id] : s.ids.filter((x) => x !== id) }));

interface AiTask {
  title?: string;
  type?: "todo" | "assignment";
  date?: string;
  time?: string | null;
  minutes?: number;
  priority?: string;
  difficulty?: number | null;
  subject?: string | null;
  notes?: string;
  subtasks?: { title: string; date?: string | null }[];
}

function context() {
  const { projects } = useWorkspace.getState();
  const now = new Date();
  return [
    `Today is ${format(now, "EEEE yyyy-MM-dd")}, local time ${format(now, "HH:mm")}.`,
    `The student's subjects: ${projects.map((p) => p.title).join(", ") || "none"}.`,
    "Dates as yyyy-MM-dd, times as HH:mm (24h). Weekday names mean the next such day. minutes = estimated work time.",
    `priority is one of ${PRIORITIES.join(", ")}. difficulty 1–5 or null if not said. subject must be one of the subjects above, or null.`,
    'An "assignment" has a due date (the date); a "todo" is work done on its date.',
  ].join("\n");
}

const clampDate = (s?: string | null) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
};

/** Applies an AI answer over a task. */
function apply(base: Task, ai: AiTask): Task {
  const { projects } = useWorkspace.getState();
  const date = clampDate(ai.date) ?? base.date;
  let startTime: Date | null = base.startTime;
  if (ai.time && /^\d{1,2}:\d{2}$/.test(ai.time)) {
    const [h, m] = ai.time.split(":").map(Number);
    startTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
  } else if (ai.time === null) startTime = null;
  const minutes = ai.minutes && ai.minutes > 0 && ai.minutes < 24 * 60 ? Math.round(ai.minutes / 5) * 5 : base.durationMinutes;
  const priority = PRIORITIES.includes(ai.priority as Priority) ? (ai.priority as Priority) : base.priority;
  const project = ai.subject ? projects.find((p) => p.title.toLowerCase() === ai.subject!.toLowerCase()) : undefined;
  const difficulty = ai.difficulty && ai.difficulty >= 1 && ai.difficulty <= 5 ? Math.round(ai.difficulty) : null;
  const extra = { ...base.extra };
  if (difficulty === 1) extra.difficultySelected = true;
  const subtasks: Subtask[] = [
    ...base.subtasks,
    ...(ai.subtasks ?? [])
      .filter((s) => s.title?.trim())
      .map((s) => ({ id: uuid(), title: s.title.trim(), isDone: false, date: clampDate(s.date), priority: null, difficulty: null })),
  ];
  return {
    ...base,
    title: ai.title?.trim() || base.title,
    type: ai.type === "assignment" || ai.type === "todo" ? ai.type : base.type,
    date,
    startTime,
    durationMinutes: minutes,
    remainingMinutes: minutes,
    priority,
    difficulty: difficulty ?? base.difficulty,
    projectId: project?.id ?? base.projectId,
    notes: base.notes || (ai.notes?.trim() ? JSON.stringify({ ops: [{ insert: `${ai.notes.trim()}\n` }] }) : ""),
    subtasks,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

const current = (id: string) => useWorkspace.getState().tasks.find((t) => t.id === id);

function fail(error: unknown) {
  toast(error instanceof AiError ? error.message : "The AI couldn’t finish that. Try again.");
}

/**
 * Adds the task right away as typed, then lets the AI read the sentence and
 * set its date, time, length, priority, difficulty and subject.
 */
export function smartAdd(text: string, base: Partial<Task>) {
  if (!useAiKey.getState().key) {
    toast("Add your DeepSeek API key in Settings to use smart add.");
    return false;
  }
  const task = newTask({ ...base, title: text.trim(), date: base.date ?? today() });
  addTask(task);
  pending(task.id, true);
  void (async () => {
    try {
      const ai = await chatJson<AiTask>([
        {
          role: "system",
          content: `${context()}\nTurn the student's note into one task. Reply as JSON {title, type, date, time, minutes, priority, difficulty, subject}. title: short, cleaned, without the date/time/length words. Leave out what isn't said (null).`,
        },
        { role: "user", content: text },
      ]);
      const now = current(task.id);
      // Edited meanwhile: the person's changes win.
      if (now && now.title === task.title) updateTask(apply(now, ai));
    } catch (error) {
      fail(error);
    } finally {
      pending(task.id, false);
    }
  })();
  return true;
}

/** Reads the text in a photo on the device. */
async function readPhoto(file: File): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    void worker.terminate();
  }
}

/**
 * Adds a placeholder at once, reads the photo, and replaces the placeholder
 * with what the AI finds: one assignment with subtasks, or separate tasks.
 */
export function tasksFromPhoto(file: File, base: Partial<Task>) {
  if (!useAiKey.getState().key) {
    toast("Add your DeepSeek API key in Settings to add tasks from a photo.");
    return false;
  }
  const holder = newTask({ ...base, title: "Reading photo…", date: base.date ?? today() });
  addTask(holder);
  pending(holder.id, true);
  void (async () => {
    try {
      const text = (await readPhoto(file)).trim();
      if (text.length < 4) throw new AiError("No text found in that photo. Try a sharper, closer shot.");
      const ai = await chatJson<{ tasks?: AiTask[] }>([
        {
          role: "system",
          content: `${context()}\nThe text below was read from a photo (a whiteboard, an assignment sheet, a syllabus) and may have OCR errors. Reply as JSON {tasks: [{title, type, date, time, minutes, priority, difficulty, subject, notes, subtasks: [{title, date}]}]}. One assignment sheet = one assignment, with its steps as subtasks and any interim deadlines as subtask dates; a list of separate jobs = separate tasks (at most 12). notes: one or two useful lines from the sheet (requirements, word count), else "".`,
        },
        { role: "user", content: text.slice(0, 12000) },
      ]);
      const list = (ai.tasks ?? []).filter((t) => t.title?.trim());
      if (list.length === 0) throw new AiError("Couldn’t find any tasks in that photo.");
      const now = current(holder.id);
      if (now) updateTask(apply({ ...now, title: "" }, list[0]));
      for (const extra of list.slice(1)) addTask(apply(newTask({ ...base, title: "", date: base.date ?? today() }), extra));
      toast(list.length === 1 ? "Added from your photo" : `Added ${list.length} tasks from your photo`);
    } catch (error) {
      if (current(holder.id)?.title === "Reading photo…") deleteTask(holder.id);
      fail(error);
    } finally {
      pending(holder.id, false);
    }
  })();
  return true;
}

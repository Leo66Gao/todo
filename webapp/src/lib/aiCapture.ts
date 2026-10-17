"use client";

// Two ways to add work with AI that never make you wait: the task appears at
// once with what's known, and the AI fills in the rest in the background.
//
// - Smart add: the typed sentence ("essay draft by fri, 2h, hard, history")
//   becomes a fully set task.
// - From a photo: the AI looks at the photo itself (an assignment sheet, a
//   whiteboard, handwriting) and turns it into an assignment with its
//   subtasks and milestones, or a handful of tasks.

import { create } from "zustand";
import { format } from "date-fns";
import { PRIORITIES, type Priority } from "./dart";
import { chatJson, AiError, useAiKey } from "./ai";
import { photoDataUrl } from "./photoData";
import { uuid, type Subtask, type Task } from "./model";
import { startOfDay, today } from "./time";
import { addTask, captureWorkspaceSession, deleteTask, newTask, updateTask, useWorkspace } from "@/store/workspace";
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
    "You turn a secondary-school student's words or photos into tasks for their planner. Reply with JSON only.",
    `Today is ${format(now, "EEEE yyyy-MM-dd")}, local time ${format(now, "HH:mm")}.`,
    `The student's subjects: ${projects.map((p) => p.title).join(", ") || "none"}.`,
    "Fields:",
    "- title: short and specific, in the student's language, without the date, time, length or priority words (\"Physics lab report\", not \"do physics lab report by friday 2h\").",
    '- type: "assignment" when something is handed in or due (the date is the due date); "todo" for work done on its date (revision, reading, practice).',
    "- date: yyyy-MM-dd. A weekday means the next one (a week ahead if it's today's weekday); \"this <weekday>\" on that day means today; \"next <weekday>\" means the one in the week after; \"next week\" means that Monday. null if no day is given.",
    "- time: HH:mm (24h) only if a time is given, else null.",
    "- minutes: the work time if said or clearly implied (\"2h\", \"quick\" ≈ 15), else null.",
    `- priority: one of ${PRIORITIES.join(", ")}; only if said or clearly urgent ("asap", "urgent", "tomorrow's test"), else null.`,
    "- difficulty: 1–5 only if said, else null.",
    "- subject: one of the subjects above when the task clearly belongs to it (by name, topic or teacher), else null.",
  ].join("\n");
}

const clampDate = (s?: string | null) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) || format(d, "yyyy-MM-dd") !== s ? null : startOfDay(d);
};

/** The model's JSON is external input; a prompt is not a schema. */
export function parseAiTask(value: unknown): AiTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiError("DeepSeek returned an invalid task. Try again.");
  const raw = value as Record<string, unknown>;
  const text = (key: string, max = 1000) => typeof raw[key] === "string" ? (raw[key] as string).trim().slice(0, max) : undefined;
  return {
    title: text("title"), type: raw.type === "assignment" || raw.type === "todo" ? raw.type : undefined,
    date: text("date", 10), time: raw.time === null ? null : text("time", 5),
    minutes: typeof raw.minutes === "number" && Number.isFinite(raw.minutes) ? raw.minutes : undefined,
    difficulty: typeof raw.difficulty === "number" && Number.isFinite(raw.difficulty) ? raw.difficulty : undefined,
    priority: text("priority", 30), subject: text("subject"), notes: text("notes", 12000),
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks.slice(0, 50).flatMap((s) => {
      if (!s || typeof s !== "object" || typeof s.title !== "string") return [];
      return [{ title: s.title.trim().slice(0, 1000), date: typeof s.date === "string" ? s.date : null }];
    }) : [],
  };
}

/** Applies an AI answer over a task. */
function apply(base: Task, ai: AiTask): Task {
  const { projects } = useWorkspace.getState();
  const date = clampDate(ai.date) ?? base.date;
  let startTime: Date | null = base.startTime;
  if (ai.time && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(ai.time)) {
    const [h, m] = ai.time.split(":").map(Number);
    startTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m);
  } else if (ai.time === null) startTime = null;
  const minutes = ai.minutes && ai.minutes > 0 && ai.minutes < 24 * 60 ? Math.max(5, Math.round(ai.minutes / 5) * 5) : base.durationMinutes;
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

/** Keep every field the person changed while the answer was being prepared. */
export function mergeAiTask(original: Task, current: Task, answer: unknown): Task {
  const proposed = apply(original, parseAiTask(answer));
  const next = { ...current };
  const fields = ["title", "type", "date", "startTime", "durationMinutes", "remainingMinutes", "priority", "difficulty", "projectId", "notes", "subtasks"] as const;
  for (const field of fields) {
    if (JSON.stringify(current[field]) === JSON.stringify(original[field])) {
      Object.assign(next, { [field]: proposed[field] });
    }
  }
  // A time inferred for the original date must not undo a manual date change.
  if (next.startTime && next.date.getTime() !== proposed.date.getTime() && current.startTime === original.startTime) {
    next.startTime = new Date(next.date.getFullYear(), next.date.getMonth(), next.date.getDate(), next.startTime.getHours(), next.startTime.getMinutes());
  }
  if (next.difficulty === proposed.difficulty && current.difficulty === original.difficulty) {
    next.extra = { ...current.extra, ...(proposed.extra?.difficultySelected ? { difficultySelected: true } : {}) };
  }
  return next;
}

function taskOperation(id: string) {
  const session = captureWorkspaceSession();
  const controller = new AbortController();
  const valid = () => session() && current(id) != null;
  const unsubscribe = useWorkspace.subscribe(() => { if (!valid()) controller.abort(); });
  return { valid, controller, unsubscribe };
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
  const operation = taskOperation(task.id);
  pending(task.id, true);
  void (async () => {
    try {
      const ai = await chatJson<unknown>([
        {
          role: "system",
          content: `${context()}\n\nTurn the student's sentence into one task. Reply as {"title", "type", "date", "time", "minutes", "priority", "difficulty", "subject"}.`,
        },
        { role: "user", content: text },
      ], operation.controller.signal);
      const now = current(task.id);
      // Edited meanwhile: the person's changes win.
      if (operation.valid() && now) updateTask(mergeAiTask(task, now, ai));
    } catch (error) {
      if (operation.valid() && !operation.controller.signal.aborted) fail(error);
    } finally {
      operation.unsubscribe();
      pending(task.id, false);
    }
  })();
  return true;
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
  const operation = taskOperation(holder.id);
  pending(holder.id, true);
  void (async () => {
    try {
      const image = await photoDataUrl(file).catch((error: Error) => {
        throw new AiError(error.message);
      });
      if (!operation.valid()) return;
      const ai = await chatJson<{ tasks?: AiTask[] }>([
        {
          role: "system",
          content: `${context()}

The student took a photo of work to do: an assignment sheet, a whiteboard, a syllabus, a planner page or handwriting. Read it carefully (including handwriting and anything at an angle) and reply as {"tasks": [{"title", "type", "date", "time", "minutes", "priority", "difficulty", "subject", "notes", "subtasks": [{"title", "date"}]}]}.
- One assignment sheet = one assignment: its parts or steps as subtasks, and any interim deadlines as subtask dates.
- A list of separate jobs (homework on a board, a week's plan) = separate tasks, at most 12.
- notes: the details worth keeping from the photo (requirements, word count, pages, what to bring), in one to three short lines; else "".
- Dates written without a year are the next such date. Leave out anything that isn't a task.
- If there's nothing to do in the photo, reply {"tasks": []}.`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Here is the photo." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ], operation.controller.signal);
      if (!operation.valid()) return;
      const list = (Array.isArray(ai.tasks) ? ai.tasks : []).slice(0, 12).map(parseAiTask).filter((t) => t.title);
      if (list.length === 0) throw new AiError("Couldn’t find any tasks in that photo.");
      const now = current(holder.id);
      if (!now) return;
      updateTask(mergeAiTask(holder, now, list[0]));
      for (const extra of list.slice(1)) addTask(apply(newTask({ ...base, title: "", date: base.date ?? today() }), extra));
      toast(list.length === 1 ? "Added from your photo" : `Added ${list.length} tasks from your photo`);
    } catch (error) {
      if (!operation.valid() || operation.controller.signal.aborted) return;
      if (current(holder.id)?.title === "Reading photo…") deleteTask(holder.id);
      fail(error);
    } finally {
      operation.unsubscribe();
      pending(holder.id, false);
    }
  })();
  return true;
}

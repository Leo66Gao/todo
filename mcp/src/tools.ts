// The tools an agent gets: read the workspace, then move, edit and add tasks.
// Nothing here deletes; a task the agent shouldn't keep can be marked done.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SignInExpired, Workspace, type FirebaseEnv } from "./firestore";
import { isDay, isTime, newTask, notesText, patchTask, PRIORITIES, scheduleMilestone, scheduleTask, splitId, viewTask } from "./tasks";

const day = z.string().refine(isDay, "A day as YYYY-MM-DD");
const time = z.string().refine(isTime, "A time as HH:MM (24-hour)");
const minutes = z.number().int().min(0).max(24 * 60);
const priority = z.enum(PRIORITIES as [string, ...string[]]);

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ ...text(message), isError: true });

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function createServer(env: FirebaseEnv, refreshToken: string): McpServer {
  const server = new McpServer(
    { name: "todo", version: "1.0.0" },
    {
      instructions:
        "The user's Todo app: tasks with a day, an optional start time and a length, grouped by subject; assignments have dated milestones. " +
        "Dates are YYYY-MM-DD and times HH:MM in the user's own time zone. " +
        "To plan a day, list its tasks first, then schedule them so they don't overlap. Tell the user what you moved.",
    },
  );

  // One sign-in per request; every tool reports an expired one the same way.
  let opened: Promise<Workspace> | null = null;
  const workspace = () => (opened ??= Workspace.open(env, refreshToken));
  const run = <A>(fn: (ws: Workspace, args: A) => Promise<ReturnType<typeof text>>) => async (args: A) => {
    try {
      return await fn(await workspace(), args);
    } catch (error) {
      if (error instanceof SignInExpired) return failure("Your Todo sign-in has expired. Reconnect the Todo connector to sign in again.");
      return failure(error instanceof Error ? error.message : String(error));
    }
  };
  const subjects = async (ws: Workspace) =>
    new Map((await ws.list("project")).flatMap((r) => {
      const p = JSON.parse(r.payload) as { id?: unknown; title?: unknown };
      return typeof p.id === "string" ? [[p.id, String(p.title ?? "")] as const] : [];
    }));
  const tasks = async (ws: Workspace) => {
    const names = await subjects(ws);
    return (await ws.list("task")).map((r) => viewTask(JSON.parse(r.payload) as Record<string, unknown>, names));
  };

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Tasks whose day falls between `from` and `to` (inclusive), sorted by day and start time. " +
        "Open tasks only unless include_done. Assignments include their milestones, which are listed under their own day too.",
      inputSchema: { from: day, to: day, include_done: z.boolean().optional() },
      annotations: READ,
    },
    run(async (ws, { from, to, include_done }: { from: string; to: string; include_done?: boolean }) => {
      if (to < from) return failure("`to` is before `from`.");
      const all = await tasks(ws);
      const inRange = (d: string | null) => d != null && d >= from && d <= to;
      const shown = all.filter((t) => (include_done || !t.done) && !t.conflictCopy && (inRange(t.date) || t.milestones?.some((m) => inRange(m.date) && (include_done || !m.done))));
      shown.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.start ?? "99").localeCompare(b.start ?? "99"));
      return text({ from, to, count: shown.length, tasks: shown });
    }),
  );

  server.registerTool(
    "list_subjects",
    { title: "List subjects", description: "The user's subjects (courses or areas), with the ids tasks refer to.", annotations: READ },
    run(async (ws) => text([...(await subjects(ws))].map(([id, title]) => ({ id, title })))),
  );

  server.registerTool(
    "get_task",
    { title: "Get a task", description: "One task in full, with its notes as plain text.", inputSchema: { id: z.string() }, annotations: READ },
    run(async (ws, { id }: { id: string }) => {
      const record = await ws.get(`task:${splitId(id).taskId}`);
      if (!record) return failure(`No task ${id}.`);
      const raw = JSON.parse(record.payload) as Record<string, unknown>;
      return text({ ...viewTask(raw, await subjects(ws)), notes: notesText(raw.notes) });
    }),
  );

  server.registerTool(
    "schedule_task",
    {
      title: "Schedule a task",
      description:
        "Moves a task to a day, and optionally sets its start time and length. Leave `start` out to keep its time of day; " +
        "pass null to make it a task for the day with no set time. A milestone id (taskId/milestoneId) moves that milestone's day.",
      inputSchema: { id: z.string(), date: day, start: time.nullable().optional(), duration_minutes: minutes.optional() },
      annotations: WRITE,
    },
    run(async (ws, { id, date, start, duration_minutes }: { id: string; date: string; start?: string | null; duration_minutes?: number }) => {
      const { taskId, subtaskId } = splitId(id);
      let missing = false;
      const saved = await ws.update(`task:${taskId}`, (task) => {
        if (subtaskId == null) return scheduleTask(task, { date, start, durationMinutes: duration_minutes });
        if (!scheduleMilestone(task, subtaskId, date)) {
          missing = true;
          return null;
        }
        return task;
      });
      if (!saved) return failure(missing ? `No milestone ${id}.` : `No task ${id}.`);
      return text({ saved: viewTask(saved, await subjects(ws)) });
    }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update a task",
      description: "Changes a task's title, priority, length or subject, or marks it done or not done.",
      inputSchema: {
        id: z.string(),
        title: z.string().min(1).max(500).optional(),
        done: z.boolean().optional(),
        priority: priority.optional(),
        duration_minutes: minutes.optional(),
        subject_id: z.string().nullable().optional(),
      },
      annotations: WRITE,
    },
    run(async (ws, a: { id: string; title?: string; done?: boolean; priority?: string; duration_minutes?: number; subject_id?: string | null }) => {
      if (a.subject_id && !(await subjects(ws)).has(a.subject_id)) return failure(`No subject ${a.subject_id}; list_subjects shows the ids.`);
      const saved = await ws.update(`task:${splitId(a.id).taskId}`, (task) =>
        patchTask(task, { title: a.title, done: a.done, priority: a.priority as never, durationMinutes: a.duration_minutes, subjectId: a.subject_id }),
      );
      if (!saved) return failure(`No task ${a.id}.`);
      return text({ saved: viewTask(saved, await subjects(ws)) });
    }),
  );

  server.registerTool(
    "create_task",
    {
      title: "Add a task",
      description: "Adds a task on a day, optionally at a time, with a length, subject and priority. `assignment` makes it an assignment.",
      inputSchema: {
        title: z.string().min(1).max(500),
        date: day,
        start: time.nullable().optional(),
        duration_minutes: minutes.optional(),
        subject_id: z.string().nullable().optional(),
        priority: priority.optional(),
        assignment: z.boolean().optional(),
      },
      annotations: WRITE,
    },
    run(async (ws, a: { title: string; date: string; start?: string | null; duration_minutes?: number; subject_id?: string | null; priority?: string; assignment?: boolean }) => {
      const names = await subjects(ws);
      if (a.subject_id && !names.has(a.subject_id)) return failure(`No subject ${a.subject_id}; list_subjects shows the ids.`);
      const task = newTask({
        id: crypto.randomUUID(),
        title: a.title,
        date: a.date,
        start: a.start,
        durationMinutes: a.duration_minutes,
        subjectId: a.subject_id,
        priority: a.priority as never,
        assignment: a.assignment,
      });
      if (!(await ws.put(`task:${task.id as string}`, JSON.stringify(task), null))) return failure("Could not add the task; try again.");
      return text({ created: viewTask(task, names) });
    }),
  );

  return server;
}

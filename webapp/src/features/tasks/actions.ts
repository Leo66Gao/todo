"use client";

import { format } from "date-fns";
import type { Priority } from "@/lib/dart";
import { argbToCss } from "@/lib/dart";
import { uuid, type Task } from "@/lib/model";
import { startTaskFocus } from "@/lib/focus";
import { addDays, formatDuration, relativeDay, startOfDay, startOfWeek, today } from "@/lib/time";
import type { Route } from "@/shell/nav";
import { ui } from "@/shell/ui";
import { endSeriesBefore, upcomingOf } from "@/store/repeat";
import { restoreFromTrash, trashTask } from "@/store/trash";
import {
  addSubtaskFull,
  addTask,
  captureWorkspaceSession,
  deleteTask,
  patchTask,
  rescheduleTask,
  toggleTask,
  useWorkspace,
} from "@/store/workspace";
import type { MenuItem } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { PRIORITY_LABEL, priorityColor, workMinutes } from "./meta";

type Navigate = (route: Route) => void;

/** Assignments and their milestones open as a page; to-dos in the inspector. */
export function openTask(task: Task, navigate: Navigate, opts?: { forcePanel?: boolean }) {
  if (!opts?.forcePanel && (task.type === "assignment" || task.parentTaskId)) {
    navigate({ view: "assignment", id: task.parentTaskId ?? task.id });
    return;
  }
  ui.inspect(task.id);
}

export function editTask(task: Task, navigate: Navigate) {
  if (task.milestone) {
    navigate({ view: "assignment", id: task.milestone.parentId });
    return;
  }
  ui.editTask(task.id);
}

export function removeTask(task: Task) {
  const currentSession = captureWorkspaceSession();
  const state = useWorkspace.getState();
  if (task.milestone) {
    const parent = state.tasks.find((t) => t.id === task.milestone!.parentId);
    const index = parent?.subtasks.findIndex((s) => s.id === task.milestone!.subtaskId) ?? -1;
    const sub = parent?.subtasks[index];
    deleteTask(task.id);
    if (parent && sub) {
      toast(`Deleted “${task.title}”`, { label: "Undo", run: () => { if (currentSession()) addSubtaskFull(parent.id, sub, index); } });
    }
    return;
  }
  const snapshot = state.tasks.find((t) => t.id === task.id);
  if (!snapshot) return;
  if (ui.get().inspectorId === task.id) ui.closeInspector();
  // Kept in Recently deleted; Undo brings it back from there (under a new ID,
  // so a deletion that has already synced can't remove it again).
  trashTask(snapshot);
  toast(`Deleted “${task.title}”`, {
    label: "Undo",
    run: () => {
      if (currentSession()) restoreFromTrash("task", snapshot.id);
    },
  });
}

export function moveTask(task: Task, day: Date, quiet = false) {
  const currentSession = captureWorkspaceSession();
  const previous = task.date;
  rescheduleTask(task.id, day);
  if (!quiet) {
    toast(`Moved to ${relativeDay(day)}`, { label: "Undo", run: () => { if (currentSession()) rescheduleTask(task.id, previous); } });
  }
}

/** A copy of the task (open, on [day] if given, not part of any repeating series), placed after it. */
export function duplicateTask(task: Task, day?: Date) {
  if (task.milestone) return;
  const currentSession = captureWorkspaceSession();
  const index = useWorkspace.getState().tasks.findIndex((t) => t.id === task.id);
  const date = day ?? task.date;
  const shift = Math.round((startOfDay(date).getTime() - startOfDay(task.date).getTime()) / 86_400_000);
  const id = uuid();
  const extra = { ...task.extra };
  delete extra.repeat;
  const copy: Task = {
    ...task,
    id,
    date,
    startTime: task.startTime ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), task.startTime.getHours(), task.startTime.getMinutes()) : null,
    isDone: false,
    remainingMinutes: task.isDone ? task.durationMinutes : task.remainingMinutes,
    googleEventId: null,
    calendarEventRevision: 0,
    isConflictCopy: false,
    // Dated subtasks (milestones) keep their distance from the new day.
    subtasks: task.subtasks.map((s) => ({ ...s, id: uuid(), isDone: false, date: s.date ? addDays(s.date, shift) : null })),
    extra: Object.keys(extra).length ? extra : undefined,
  };
  addTask(copy, index + 1);
  // The open panel moves to the copy, ready to change it.
  if (ui.get().inspectorId === task.id) ui.inspect(copy.id);
  else ui.select(copy.id);
  toast(day ? `Duplicated to ${relativeDay(day)}` : "Duplicated", { label: "Edit", run: () => { if (currentSession()) ui.editTask(copy.id); } });
}

/** Deletes a repeating task and the open ones after it (all can come back with Undo). */
export function removeUpcoming(task: Task) {
  const currentSession = captureWorkspaceSession();
  const all = [task, ...upcomingOf(task)].map((t) => useWorkspace.getState().tasks.find((x) => x.id === t.id)).filter((t): t is Task => !!t);
  if (ui.get().inspectorId && all.some((t) => t.id === ui.get().inspectorId)) ui.closeInspector();
  for (const t of all) trashTask(t);
  // The series ends the day before: the tasks left keep it from being topped
  // up again past the deleted days.
  const resume = endSeriesBefore(task);
  toast(`Deleted ${all.length} ${all.length === 1 ? "task" : "tasks"}`, {
    label: "Undo",
    run: () => {
      if (!currentSession()) return;
      for (const t of all) restoreFromTrash("task", t.id);
      resume();
    },
  });
}

export function taskMenu(task: Task, navigate: Navigate): MenuItem[] {
  const { projects, settings } = useWorkspace.getState();
  const now = today();
  const isMilestone = !!task.milestone;
  const priorities: Priority[] = ["none", "low", "medium", "high", "critical"];
  const items: MenuItem[] = [
    { label: "Open", onSelect: () => openTask(task, navigate, { forcePanel: !isMilestone && task.type !== "assignment" }) },
  ];
  if (!isMilestone) items.push({ label: "Edit…", shortcut: "↩", onSelect: () => ui.editTask(task.id) });
  if (task.type === "assignment" && !isMilestone) {
    items.push({ label: "Open assignment", onSelect: () => navigate({ view: "assignment", id: task.id }) });
  }
  items.push({ label: task.isDone ? "Mark as not done" : "Mark as done", shortcut: "Space", onSelect: () => toggleTask(task.id) });
  if (!task.isDone) {
    const minutes = workMinutes(task);
    items.push({
      label: minutes > 0 ? `Focus for ${formatDuration(minutes)}` : "Focus",
      shortcut: "F",
      onSelect: () => startTaskFocus(task, minutes),
    });
  }
  items.push(
    { separator: true },
    {
      label: "Move to",
      items: [
        { label: "Today", onSelect: () => moveTask(task, now) },
        { label: "Tomorrow", onSelect: () => moveTask(task, addDays(now, 1)) },
        { label: `Next week`, onSelect: () => moveTask(task, addDays(startOfWeek(now), 7)) },
        { separator: true },
        ...Array.from({ length: 7 }, (_, i) => addDays(now, i + 2)).map((d) => ({
          label: format(d, "EEEE d MMM"),
          onSelect: () => moveTask(task, d),
        })),
      ],
    },
  );
  if (!isMilestone) {
    items.push({
      label: "Priority",
      items: priorities.map((p) => ({
        label: PRIORITY_LABEL[p],
        swatch: p === "none" ? undefined : priorityColor(p),
        checked: task.priority === p,
        onSelect: () => patchTask(task.id, { priority: p }),
      })),
    });
    if (projects.length > 0) {
      items.push({
        label: "Subject",
        items: [
          { label: "No subject", checked: task.projectId == null, onSelect: () => patchTask(task.id, { projectId: null }) },
          { separator: true },
          ...projects.map((p) => ({
            label: p.title,
            swatch: argbToCss(p.colorValue),
            checked: task.projectId === p.id,
            onSelect: () => patchTask(task.id, { projectId: p.id }),
          })),
        ],
      });
    }
    if (settings.labels.length > 0) {
      items.push({
        label: "Label",
        items: [
          { label: "No label", checked: task.category === "General", onSelect: () => patchTask(task.id, { category: "General" }) },
          { separator: true },
          ...settings.labels.map((l) => ({
            label: l.name,
            swatch: argbToCss(l.colorValue),
            checked: task.category === l.name,
            onSelect: () => patchTask(task.id, { category: l.name }),
          })),
        ],
      });
    }
    items.push(
      { separator: true },
      { label: "Duplicate", shortcut: "⌘D", onSelect: () => duplicateTask(task) },
      {
        label: "Duplicate to",
        items: [
          { label: "Today", onSelect: () => duplicateTask(task, now) },
          { label: "Tomorrow", onSelect: () => duplicateTask(task, addDays(now, 1)) },
          { label: "Next week", onSelect: () => duplicateTask(task, addDays(startOfWeek(now), 7)) },
          { separator: true },
          ...Array.from({ length: 7 }, (_, i) => addDays(now, i + 2)).map((d) => ({
            label: format(d, "EEEE d MMM"),
            onSelect: () => duplicateTask(task, d),
          })),
        ],
      },
    );
  } else {
    items.push({ separator: true });
  }
  items.push({ label: "Delete", shortcut: "⌫", destructive: true, onSelect: () => removeTask(task) });
  if (!isMilestone && upcomingOf(task).length > 0) {
    items.push({ label: "Delete this and upcoming", destructive: true, onSelect: () => removeUpcoming(task) });
  }
  return items;
}

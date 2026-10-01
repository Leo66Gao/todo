"use client";

import { format } from "date-fns";
import type { Priority } from "@/lib/dart";
import { argbToCss } from "@/lib/dart";
import type { Task } from "@/lib/model";
import { startTaskFocus } from "@/lib/focus";
import { addDays, formatDuration, relativeDay, startOfWeek, today } from "@/lib/time";
import type { Route } from "@/shell/nav";
import { ui } from "@/shell/ui";
import {
  addSubtaskFull,
  addTask,
  captureWorkspaceSession,
  deleteTask,
  newTask,
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
  const index = state.tasks.findIndex((t) => t.id === task.id);
  const snapshot = state.tasks[index];
  if (!snapshot) return;
  if (ui.get().inspectorId === task.id) ui.closeInspector();
  deleteTask(task.id);
  toast(`Deleted “${task.title}”`, {
    label: "Undo",
    // A fresh calendar revision so the restored task never reuses a deleted event.
    run: () => {
      if (!currentSession()) return;
      addTask(
        { ...snapshot, googleEventId: null, calendarEventRevision: snapshot.calendarEventRevision + 1 },
        index,
      );
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

export function duplicateTask(task: Task) {
  if (task.milestone) return;
  const index = useWorkspace.getState().tasks.findIndex((t) => t.id === task.id);
  const copy = newTask({
    ...task,
    id: undefined as unknown as string,
    title: task.title,
    isDone: false,
    googleEventId: null,
    calendarEventRevision: 0,
    isConflictCopy: false,
    subtasks: task.subtasks.map((s) => ({ ...s, id: crypto.randomUUID(), isDone: false })),
  });
  copy.id = crypto.randomUUID();
  addTask(copy, index + 1);
  toast("Task duplicated");
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
    items.push({ separator: true }, { label: "Duplicate", onSelect: () => duplicateTask(task) });
  } else {
    items.push({ separator: true });
  }
  items.push({ label: "Delete", shortcut: "⌫", destructive: true, onSelect: () => removeTask(task) });
  return items;
}

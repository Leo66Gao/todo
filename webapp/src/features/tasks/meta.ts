"use client";

import { useMemo } from "react";
import type { Priority } from "@/lib/dart";
import { argbToCss } from "@/lib/dart";
import type { Project, Task, TaskLabel } from "@/lib/model";
import { sameDay, startOfDay } from "@/lib/time";
import { milestonesOf, useWorkspace } from "@/store/workspace";

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const priorityColor = (p: Priority) =>
  p === "none" ? "var(--ink-4)" : `var(--p-${p})`;

/** Difficulty tint, as in the original app: easy green, level 3 orange, hard red. */
export const difficultyColor = (level: number) =>
  level <= 2 ? "var(--p-low)" : level === 3 ? "var(--p-high)" : "var(--p-critical)";

export const difficultyLabel = (level: number) => (level > 1 ? `Level ${level}` : "None");

export const projectColor = (p: Project | null | undefined) => (p ? argbToCss(p.colorValue) : "var(--ink-4)");

/** Stored tasks plus the virtual milestone tasks of dated subtasks. */
export function useAllTasks(): Task[] {
  const tasks = useWorkspace((s) => s.tasks);
  return useMemo(() => [...tasks, ...milestonesOf(tasks)], [tasks]);
}

export function useProjectMap(): Map<string, Project> {
  const projects = useWorkspace((s) => s.projects);
  return useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
}

export function useLabelMap(): Map<string, TaskLabel> {
  const labels = useWorkspace((s) => s.settings.labels);
  return useMemo(() => new Map(labels.map((l) => [l.name, l])), [labels]);
}

/**
 * A day's tasks the way the Flutter app orders them: timed tasks by start
 * time, then untimed tasks in manual order, then completed ones.
 */
export function tasksForDay(all: Task[], day: Date) {
  const list = all.filter((t) => sameDay(t.date, day));
  const open = list.filter((t) => !t.isDone);
  const timed = open
    .filter((t) => t.startTime)
    .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime());
  const untimed = open.filter((t) => !t.startTime);
  const done = list.filter((t) => t.isDone);
  return { timed, untimed, done };
}

export function overdueTasks(all: Task[], reference = new Date()) {
  const cutoff = startOfDay(reference).getTime();
  return all
    .filter((t) => !t.isDone && startOfDay(t.date).getTime() < cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Minutes of work still planned on a task. */
export const workMinutes = (t: Task) => (t.remainingMinutes > 0 ? t.remainingMinutes : t.durationMinutes);

export const isAssignmentLike = (t: Task) => t.type === "assignment" || t.parentTaskId != null;

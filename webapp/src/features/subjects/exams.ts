"use client";

import type { Project, Task } from "@/lib/model";
import { addDays, daysFromToday, startOfDay } from "@/lib/time";
import { addTask, deleteTask, newTask, updateProject, useWorkspace } from "@/store/workspace";

// A subject's exam: its day lives on the subject record ("YYYY-MM-DD"), so it
// syncs and backs up with it. The countdown shows on the subject, its tile
// and, as the day nears, in Today.

const two = (n: number) => String(n).padStart(2, "0");
export const examKey = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** The exam's day, or null when none is set. */
export function examDay(project: Pick<Project, "examDate">): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(project.examDate ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Days from today to the exam: 0 on the day, negative once it has passed. */
export function examIn(project: Pick<Project, "examDate">, now = new Date()): number | null {
  const day = examDay(project);
  return day ? Math.round((day.getTime() - startOfDay(now).getTime()) / 86_400_000) : null;
}

/** "Exam today", "Exam tomorrow", "Exam in 12 days"; null once it has passed. */
export function examLabel(days: number | null): string | null {
  if (days == null || days < 0) return null;
  if (days === 0) return "Exam today";
  if (days === 1) return "Exam tomorrow";
  return `Exam in ${days} days`;
}

export function setExamDate(id: string, day: Date | null) {
  const project = useWorkspace.getState().projects.find((p) => p.id === id);
  if (!project) return;
  const next: Project = { ...project, examDate: day ? examKey(day) : undefined };
  if (!day) delete next.examDate;
  updateProject(next);
}

/** Subjects with an exam coming up within [withinDays], soonest first. */
export function upcomingExams(projects: Project[], withinDays: number, now = new Date()) {
  return projects
    .map((project) => ({ project, days: examIn(project, now) }))
    .filter((e): e is { project: Project; days: number } => e.days != null && e.days >= 0 && e.days <= withinDays)
    .sort((a, b) => a.days - b.days);
}

// Days before the exam to review on: closer together as it nears.
const REVIEW_OFFSETS = [1, 3, 6, 10, 15, 21];
const REVIEW_MINUTES = 60;

/** The review days a plan would use: future days only, ones with a review already skipped. */
export function reviewDays(project: Project, tasks: Task[], now = new Date()): Date[] {
  const exam = examDay(project);
  if (!exam) return [];
  const start = startOfDay(now);
  const hasReview = (d: Date) =>
    tasks.some((t) => t.projectId === project.id && !t.isDone && t.date.getTime() === d.getTime() && /review|revis/i.test(t.title));
  return REVIEW_OFFSETS.map((n) => addDays(exam, -n))
    .filter((d) => d.getTime() >= start.getTime() && !hasReview(d))
    .sort((a, b) => a.getTime() - b.getTime());
}

/** Adds review sessions spread before the exam; returns the new tasks' IDs (for Undo). */
export function planReviews(project: Project, now = new Date()): string[] {
  const days = reviewDays(project, useWorkspace.getState().tasks, now);
  return days.map((date, i) => {
    const last = i === days.length - 1 && daysFromToday(date) >= 0 && examIn(project, now)! - daysFromToday(date) <= 1;
    const task = newTask({
      title: last ? `${project.title} final review` : `${project.title} review`,
      date,
      projectId: project.id,
      durationMinutes: REVIEW_MINUTES,
      remainingMinutes: REVIEW_MINUTES,
      priority: last ? "high" : "medium",
    });
    addTask(task);
    return task.id;
  });
}

export function unplanReviews(ids: string[]) {
  for (const id of ids) deleteTask(id);
}

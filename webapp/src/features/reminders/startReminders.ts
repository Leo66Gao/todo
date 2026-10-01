"use client";

import { argbToHex } from "@/lib/dart";
import { startTaskFocus } from "@/lib/focus";
import { isNative } from "@/lib/native";
import * as prefs from "@/lib/prefs";
import {
  onReminderOpened,
  planReminders,
  requestReminderPermission,
  syncReminders,
  useReminderPrefs,
} from "@/lib/reminders";
import { routeHref } from "@/shell/nav";
import { ui } from "@/shell/ui";
import { workMinutes } from "@/features/tasks/meta";
import { toggleTask, useWorkspace } from "@/store/workspace";
import { toast } from "@/ui/toast";

let started = false;

function whenLoaded(): Promise<void> {
  if (!useWorkspace.getState().isLoading) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useWorkspace.subscribe((s) => {
      if (s.isLoading) return;
      stop();
      resolve();
    });
  });
}

/** Keeps the phone's reminders in step with the workspace (Android app only). */
export function startReminders() {
  if (started || !isNative()) return;
  started = true;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const plan = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const { tasks, projects, isLoading } = useWorkspace.getState();
      if (isLoading) return;
      const subjects = new Map(projects.map((p) => [p.id, { title: p.title, color: argbToHex(p.colorValue) }]));
      void syncReminders(planReminders(tasks, useReminderPrefs.getState(), new Date(), (id) => (id ? subjects.get(id) ?? null : null)));
    }, 600);
  };
  useWorkspace.subscribe((s, prev) => {
    if (s.tasks !== prev.tasks || s.projects !== prev.projects || s.isLoading !== prev.isLoading) plan();
  });
  useReminderPrefs.subscribe(plan);
  plan();

  void import("@capacitor/app").then(({ App }) => App.addListener("resume", plan));

  // Tapping a reminder opens its day, and the task if it has one. Its buttons
  // tick the task off or start a focus session on it.
  void onReminderOpened((taskId, day, action) => {
    ui.set({ day });
    // (Next picks up history changes, as the app's own navigation relies on.)
    if (window.location.pathname !== "/") window.history.pushState(null, "", routeHref({ view: "today" }));
    if (!taskId) return;
    if (action === "open") {
      ui.inspect(taskId);
      return;
    }
    // A button can open the app from cold: wait for the workspace first.
    void whenLoaded().then(() => {
      const task = useWorkspace.getState().tasks.find((t) => t.id === taskId);
      if (!task) {
        toast("That task was deleted or moved to another account.");
      } else if (action === "done") {
        if (!task.isDone) toggleTask(task.id);
        toast(`Done: “${task.title || "Untitled task"}”`, { label: "Undo", run: () => { if (useWorkspace.getState().tasks.find((t) => t.id === task.id)?.isDone) toggleTask(task.id); } });
      } else {
        startTaskFocus(task, workMinutes(task));
      }
    });
  });

  // Ask once for permission to notify (Android 13+ requires it).
  if (!prefs.getBool("reminders.asked")) {
    prefs.setBool("reminders.asked", true);
    void requestReminderPermission().then(plan);
  }
}

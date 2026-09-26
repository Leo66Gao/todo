"use client";

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
import { useWorkspace } from "@/store/workspace";

let started = false;

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
      const names = new Map(projects.map((p) => [p.id, p.title]));
      void syncReminders(planReminders(tasks, useReminderPrefs.getState(), new Date(), (id) => (id ? names.get(id) ?? null : null)));
    }, 600);
  };
  useWorkspace.subscribe((s, prev) => {
    if (s.tasks !== prev.tasks || s.projects !== prev.projects || s.isLoading !== prev.isLoading) plan();
  });
  useReminderPrefs.subscribe(plan);
  plan();

  void import("@capacitor/app").then(({ App }) => App.addListener("resume", plan));

  // Tapping a reminder opens its day, and the task if it has one.
  void onReminderOpened((taskId, day) => {
    ui.set({ day });
    // (Next picks up history changes, as the app's own navigation relies on.)
    if (window.location.pathname !== "/") window.history.pushState(null, "", routeHref({ view: "today" }));
    if (taskId) ui.inspect(taskId);
  });

  // Ask once for permission to notify (Android 13+ requires it).
  if (!prefs.getBool("reminders.asked")) {
    prefs.setBool("reminders.asked", true);
    void requestReminderPermission().then(plan);
  }
}

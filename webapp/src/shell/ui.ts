"use client";

import { create } from "zustand";
import type { Task } from "@/lib/model";
import { getLocal, setLocal } from "@/lib/prefs";
import { addDays, sameDay, today } from "@/lib/time";
import { useWorkspace } from "@/store/workspace";

export type EditorState =
  | { mode: "new"; defaults: Partial<Task>; nonce: number }
  | { mode: "edit"; taskId: string; nonce: number }
  | null;

let nonce = 0;

interface UIState {
  /** Today's date: moves on at midnight, or when the app comes back after one. */
  today: Date;
  /** Day shown on the Today view. */
  day: Date;
  /** Any day inside the week shown on the Week view. */
  weekOf: Date;
  /** Selected day on the Calendar (its month is the one displayed). */
  calendarDay: Date;
  /** The Calendar shows the upcoming list instead of the month. */
  calendarList: boolean;
  /** Keyboard/selection focus in lists. */
  selectedId: string | null;
  /** Task shown in the detail panel. */
  inspectorId: string | null;
  editor: EditorState;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  /** Sidebar drawer on narrow windows / collapsed state on wide ones. */
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  /** Task ids in on-screen order, for arrow-key selection. */
  visibleOrder: string[];
  /** True while a drag is in flight or just settled (pauses layout animation). */
  dragging: boolean;
  /** Where a task dragged over the schedule would land. */
  dropSlot: { day: number; minutes: number; duration: number } | null;
}

export const useUI = create<UIState>(() => ({
  today: today(),
  day: today(),
  weekOf: today(),
  calendarDay: today(),
  calendarList: false,
  selectedId: null,
  inspectorId: null,
  editor: null,
  paletteOpen: false,
  shortcutsOpen: false,
  sidebarOpen: false,
  sidebarCollapsed: false,
  visibleOrder: [],
  dragging: false,
  dropSlot: null,
}));

export const ui = {
  set: useUI.setState,
  get: useUI.getState,
  newTask(defaults: Partial<Task> = {}) {
    useUI.setState({ editor: { mode: "new", defaults, nonce: ++nonce } });
  },
  editTask(taskId: string) {
    useUI.setState({ editor: { mode: "edit", taskId, nonce: ++nonce } });
  },
  closeEditor() {
    useUI.setState({ editor: null });
  },
  inspect(taskId: string) {
    useUI.setState({ inspectorId: taskId, selectedId: taskId });
  },
  closeInspector() {
    // Closing the panel also lets go of the task, so keys like Space
    // can't act on something that is no longer in view.
    useUI.setState({ inspectorId: null, selectedId: null });
  },
  select(taskId: string | null) {
    useUI.setState({ selectedId: taskId });
  },
  toggleSidebar() {
    const collapsed = !useUI.getState().sidebarCollapsed;
    useUI.setState({ sidebarCollapsed: collapsed });
    setLocal("sidebarCollapsed", collapsed);
  },
  restore() {
    useUI.setState({ sidebarCollapsed: getLocal("sidebarCollapsed", false), calendarList: getLocal("calendarList", false) });
  },
  setCalendarList(list: boolean) {
    useUI.setState({ calendarList: list });
    setLocal("calendarList", list);
  },
};

// Editors and selections must never reopen against a different workspace.
useWorkspace.subscribe((state, previous) => {
  if (state.user?.uid !== previous.user?.uid) {
    useUI.setState({ editor: null, inspectorId: null, selectedId: null, paletteOpen: false, visibleOrder: [], dragging: false, dropSlot: null });
  }
});

// Moving to another day, week or month drops the selection.
useUI.subscribe((state, prev) => {
  if (
    state.selectedId &&
    (state.day !== prev.day || state.weekOf !== prev.weekOf || state.calendarDay !== prev.calendarDay)
  ) {
    useUI.setState({ selectedId: null });
  }
});

/** On a new day: the new today, and the views that were showing the old one moved onto it. */
export function rollOver(s: Pick<UIState, "today" | "day" | "weekOf" | "calendarDay">, now: Date) {
  if (sameDay(now, s.today)) return null;
  const follow = (d: Date) => (sameDay(d, s.today) ? now : d);
  return { today: now, day: follow(s.day), weekOf: follow(s.weekOf), calendarDay: follow(s.calendarDay) };
}

let ticking = false;

/**
 * Keeps `today` current. The app can stay open for days (a tab, or the
 * Android app in the background), so at midnight, and whenever it comes back
 * into view, it checks the date; a view that was showing today moves on to
 * the new today rather than staying on what is now yesterday.
 */
export function startDayTicker() {
  if (ticking || typeof window === "undefined") return;
  ticking = true;
  let timer = 0;
  const check = () => {
    const now = today();
    const next = rollOver(useUI.getState(), now);
    if (next) useUI.setState(next);
    window.clearTimeout(timer);
    // Just after the next midnight; at most an hour, as timers drift while a device sleeps.
    const untilMidnight = addDays(now, 1).getTime() - Date.now() + 1000;
    timer = window.setTimeout(check, Math.min(untilMidnight, 3_600_000));
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check();
  });
  window.addEventListener("focus", check);
  check();
}

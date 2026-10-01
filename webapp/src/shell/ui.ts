"use client";

import { create } from "zustand";
import type { Task } from "@/lib/model";
import { getLocal, setLocal } from "@/lib/prefs";
import { today } from "@/lib/time";
import { useWorkspace } from "@/store/workspace";

export type EditorState =
  | { mode: "new"; defaults: Partial<Task>; nonce: number }
  | { mode: "edit"; taskId: string; nonce: number }
  | null;

let nonce = 0;

interface UIState {
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

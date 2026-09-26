"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Menu as MenuIcon } from "lucide-react";
import type { Task } from "@/lib/model";
import { restoreAppearance, useAppearance } from "@/lib/appearance";
import { addDays, relativeDay, sameDay, today } from "@/lib/time";
import { moveTask, openTask, removeTask } from "@/features/tasks/actions";
import { TaskDragPreview, type TaskDragData } from "@/features/tasks/TaskRow";
import { TaskEditorHost } from "@/features/tasks/TaskEditor";
import { InspectorPanel, InspectorSheet } from "@/features/tasks/Inspector";
import { EventSheet } from "@/features/events/EventSheet";
import { CommandPalette } from "@/features/command/CommandPalette";
import { ShortcutsSheet } from "@/features/command/ShortcutsSheet";
import { NameColorHost } from "@/features/subjects/NameColorDialog";
import { TodayView } from "@/features/today/TodayView";
import { WeekView } from "@/features/week/WeekView";
import { CalendarView } from "@/features/calendar/CalendarView";
import { AssignmentsView } from "@/features/assignments/AssignmentsView";
import { AssignmentView } from "@/features/assignments/AssignmentView";
import { SubjectsView } from "@/features/subjects/SubjectsView";
import { SubjectView } from "@/features/subjects/SubjectView";
import { NotesView } from "@/features/notes/NotesView";
import { NoteView } from "@/features/notes/NoteView";
import { SettingsView } from "@/features/settings/SettingsView";
import { milestonesOf, moveTaskBefore, patchTask, startWorkspace, toggleTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { IconButton, Spinner } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { AskHost, TooltipProvider } from "@/ui/overlay";
import { FormulaHost } from "@/ui/FormulaDialog";
import { SourcesHost } from "@/features/sources/SourcesSheet";
import { toast, ToastHost } from "@/ui/toast";
import { GlassLayer } from "@/glass/GlassLayer";
import { restoreGlassPrefs, useGlassPrefs } from "@/glass/prefs";
import { GLASS_GAP, useGlass } from "@/glass/registry";
import { routeHref, useNavigate, useRoute, type Route } from "./nav";
import { startNative } from "@/lib/native";
import { startReminders } from "@/features/reminders/startReminders";
import { startAssignmentImport } from "@/features/events/assignmentImport";
import { MobileAddButton, MobileTabBar } from "./MobileBar";
import { Sidebar } from "./Sidebar";
import { ui, useUI } from "./ui";

export function Shell() {
  const isLoading = useWorkspace((s) => s.isLoading);
  const themeMode = useAppearance((s) => s.themeMode);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    startWorkspace();
    ui.restore();
    restoreAppearance();
    restoreGlassPrefs();
    void startNative();
    startReminders();
    startAssignmentImport();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Appearance follows this device's preference, including system changes.
  useEffect(() => {
    if (!mounted) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        themeMode === "dark" || (themeMode === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode, mounted]);

  if (!mounted || isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <GlassLayer />
      <TooltipProvider delayDuration={500} skipDelayDuration={200}>
        <Workspace />
        <TaskEditorHost />
        <CommandPalette />
        <ShortcutsSheet />
        <NameColorHost />
        <AskHost />
        <FormulaHost />
        <SourcesHost />
        <ToastHost />
      </TooltipProvider>
    </MotionConfig>
  );
}

// Pointer-first collision: whatever is under the cursor wins (sidebar rows,
// day cells); fall back to overlap for sortable lists.
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

function Workspace() {
  const route = useRoute();
  const navigate = useNavigate();
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const drawer = useUI((s) => s.sidebarOpen);
  const glass = useGlassPrefs((s) => s.enabled);
  const sidebarGlass = useGlass({ level: 1, kind: "chrome" });
  const slabGlass = useGlass({ level: 1, kind: "slab" });
  const paper = route.view === "notes" || route.view === "note";
  const [dragging, setDragging] = useState<Task | null>(null);
  // Mouse drags start after a small move; on touch screens a long press starts
  // a drag so ordinary swipes keep scrolling.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
  );

  useKeyboard(route, navigate);

  // A new screen starts without a selected task (the open panel keeps its own).
  const routeKey = routeHref(route);
  useEffect(() => {
    ui.set({ selectedId: ui.get().inspectorId });
  }, [routeKey]);

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as TaskDragData | undefined;
    if (data?.type === "task") setDragging(data.task);
    ui.set({ dragging: true });
  };

  const settle = () => setTimeout(() => ui.set({ dragging: false }), 250);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    settle();
    const data = e.active.data.current as TaskDragData | undefined;
    const over = e.over;
    if (!data || !over) return;
    const task = data.task;
    const target = over.data.current as
      | { type: "day"; date: Date }
      | { type: "subject"; id: string }
      | (TaskDragData & { sortable?: { items: string[] } })
      | undefined;
    if (!target) return;
    if (target.type === "day") {
      if (!sameDay(task.date, target.date)) moveTask(task, target.date);
      return;
    }
    if (target.type === "subject") {
      if (task.milestone) return;
      const project = useWorkspace.getState().projects.find((p) => p.id === target.id);
      if (project && task.projectId !== project.id) {
        patchTask(task.id, { projectId: project.id });
        toast(`Moved to ${project.title}`);
      }
      return;
    }
    if (target.type === "task" && over.id !== task.id) {
      const overTask = target.task;
      if (!sameDay(overTask.date, task.date)) {
        moveTask(task, overTask.date, true);
        toast(`Moved to ${relativeDay(overTask.date)}`);
      }
      if (task.milestone || overTask.milestone) return;
      const items = target.sortable?.items ?? [];
      const from = items.indexOf(task.id);
      const to = items.indexOf(overTask.id);
      if (from >= 0 && from < to) {
        // Moving down: land after the target.
        moveTaskBefore(task.id, (items[to + 1] as string | undefined) ?? null);
      } else {
        moveTaskBefore(task.id, overTask.id);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        settle();
      }}
    >
      <div data-shell className="flex h-dvh overflow-hidden bg-canvas">
        {/* Docked sidebar on wide windows */}
        <motion.aside
          ref={sidebarGlass}
          data-surface="sidebar"
          initial={false}
          animate={{ width: collapsed ? 0 : 248, marginRight: glass && !collapsed ? GLASS_GAP : 0 }}
          transition={springs.panel}
          className="relative shrink-0 overflow-hidden border-r border-line max-lg:hidden"
          style={{ borderRightWidth: collapsed || glass ? 0 : 1 }}
        >
          <div className="h-full w-[248px]">
            <Sidebar />
          </div>
        </motion.aside>

        {/* Drawer on narrow windows */}
        <AnimatePresence>
          {drawer && (
            <>
              <motion.div
                className="fixed inset-0 z-30 bg-scrim lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => ui.set({ sidebarOpen: false })}
              />
              <motion.aside
                data-overlay
                data-surface="drawer"
                className="glass-overlay fixed inset-y-0 left-0 z-40 w-[280px] shadow-modal lg:hidden"
                initial={{ x: -290 }}
                animate={{ x: 0 }}
                exit={{ x: -290 }}
                transition={springs.panel}
              >
                <Sidebar onNavigate={() => ui.set({ sidebarOpen: false })} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* Notes read best on paper: a plain, solid panel instead of glass. */}
          <div
            ref={paper ? undefined : slabGlass}
            data-surface="main-slab"
            data-paper={paper || undefined}
            className="flex min-h-0 flex-1 flex-col"
          >
            <View
              key={route.view === "subject" || route.view === "assignment" || route.view === "note" ? `${route.view}:${route.id}` : route.view}
              route={route}
            />
          </div>
          <MobileAddButton route={route} navigate={navigate} />
          <MobileTabBar route={route} navigate={navigate} />
        </main>

        <InspectorPanel />
      </div>
      <InspectorSheet />
      <EventSheet />
      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" }}>
        {dragging && <TaskDragPreview task={dragging} />}
      </DragOverlay>
    </DndContext>
  );
}

function View({ route }: { route: Route }) {
  switch (route.view) {
    case "today":
      return <TodayView />;
    case "week":
      return <WeekView />;
    case "calendar":
      return <CalendarView />;
    case "assignments":
      return <AssignmentsView />;
    case "assignment":
      return <AssignmentView id={route.id} />;
    case "subjects":
      return <SubjectsView />;
    case "subject":
      return <SubjectView id={route.id} />;
    case "notes":
      return <NotesView />;
    case "note":
      return <NoteView id={route.id} />;
    case "settings":
      return <SettingsView />;
  }
}

/** Page header shared by every view: title, optional detail, actions. */
export function PageHeader({
  title,
  detail,
  leading,
  actions,
  className,
}: {
  title: ReactNode;
  detail?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  return (
    <header className={cn("flex h-[60px] shrink-0 items-center gap-3 px-6 max-sm:px-4", className)}>
      <IconButton label="Show sidebar" className="-ml-1.5 max-md:hidden lg:hidden" onClick={() => ui.set({ sidebarOpen: true })}>
        <MenuIcon className="size-[17px]" />
      </IconButton>
      {collapsed && (
        <IconButton label="Show sidebar" className="-ml-1.5 max-lg:hidden" onClick={() => ui.toggleSidebar()}>
          <MenuIcon className="size-[17px]" />
        </IconButton>
      )}
      {leading}
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate font-display text-xl font-semibold tracking-[-0.015em]">{title}</h1>
        {detail && <span className="truncate text-sm text-ink-3 max-sm:hidden">{detail}</span>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Keyboard

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

function useKeyboard(route: Route, navigate: (r: Route) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.set({ paletteOpen: !ui.get().paletteOpen });
        return;
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        ui.toggleSidebar();
        return;
      }
      if (isTyping(e.target) || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (e.altKey || (mod && e.key !== "Enter")) return;

      const state = ui.get();
      const all = useWorkspace.getState().tasks;
      // Keys only act on a selected task that is on screen right now.
      const selected =
        state.selectedId && (state.visibleOrder.includes(state.selectedId) || state.inspectorId === state.selectedId)
          ? state.selectedId
          : null;
      const findSelected = (): Task | undefined =>
        selected ? [...all, ...milestonesOf(all)].find((t) => t.id === selected) : undefined;

      switch (e.key) {
        case "n":
        case "N": {
          e.preventDefault();
          const defaults: Partial<Task> = {};
          if (route.view === "today") defaults.date = state.day;
          if (route.view === "calendar") defaults.date = state.calendarDay;
          if (route.view === "subject") defaults.projectId = route.id;
          if (route.view === "assignments") defaults.type = "assignment";
          ui.newTask(defaults);
          return;
        }
        case "?":
          ui.set({ shortcutsOpen: true });
          return;
        case "Escape":
          if (state.inspectorId) ui.closeInspector();
          else ui.select(null);
          return;
        case "t":
        case "T":
          ui.set({ day: today(), weekOf: today(), calendarDay: today() });
          if (route.view !== "today" && route.view !== "week" && route.view !== "calendar") navigate({ view: "today" });
          return;
        case "1":
          return navigate({ view: "today" });
        case "2":
          return navigate({ view: "week" });
        case "3":
          return navigate({ view: "calendar" });
        case "4":
          return navigate({ view: "assignments" });
        case "5":
          return navigate({ view: "subjects" });
        case "6":
          return navigate({ view: "notes" });
        case "ArrowLeft":
        case "ArrowRight": {
          const dir = e.key === "ArrowLeft" ? -1 : 1;
          if (route.view === "today") ui.set({ day: addDays(state.day, dir) });
          else if (route.view === "week") ui.set({ weekOf: addDays(state.weekOf, dir * 7) });
          else if (route.view === "calendar") ui.set({ calendarDay: addDays(state.calendarDay, dir) });
          else return;
          e.preventDefault();
          return;
        }
        case "ArrowDown":
        case "ArrowUp":
        case "j":
        case "k": {
          const order = state.visibleOrder;
          if (order.length === 0) return;
          e.preventDefault();
          const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : -1;
          const index = selected ? order.indexOf(selected) : -1;
          const next = order[Math.max(0, Math.min(order.length - 1, index < 0 ? (dir > 0 ? 0 : order.length - 1) : index + dir))];
          ui.select(next);
          if (state.inspectorId && !next.startsWith("milestone:")) ui.inspect(next);
          document.querySelector(`[data-task-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
          return;
        }
        case " ": {
          if (!selected) return;
          e.preventDefault();
          toggleTask(selected);
          return;
        }
        case "Enter": {
          const task = findSelected();
          if (!task) return;
          e.preventDefault();
          if (mod || state.inspectorId === task.id) ui.editTask(task.id);
          else openTask(task, navigate);
          return;
        }
        case "Backspace":
        case "Delete": {
          const task = findSelected();
          if (!task) return;
          e.preventDefault();
          removeTask(task);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [route, navigate]);
}

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { animate, AnimatePresence, motion, MotionConfig, useMotionValue } from "motion/react";
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
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Menu as MenuIcon } from "lucide-react";
import type { Task } from "@/lib/model";
import { restoreAppearance, useAppearance } from "@/lib/appearance";
import { addDays, formatClock, relativeDay, sameDay, today } from "@/lib/time";
import { duplicateTask, moveTask, openTask, removeTask } from "@/features/tasks/actions";
import { TaskDragPreview, type TaskDragData } from "@/features/tasks/TaskRow";
import { TaskEditorHost } from "@/features/tasks/TaskEditor";
import { InspectorPanel, InspectorSheet } from "@/features/tasks/Inspector";
import { EventSheet } from "@/features/events/EventSheet";
import { CommandPalette } from "@/features/command/CommandPalette";
import { AskNotesDialog, SubjectStudyDialog } from "@/features/ai/StudyAi";
import { PhotoNoteDialog } from "@/features/ai/PhotoNote";
import { ShortcutsSheet } from "@/features/command/ShortcutsSheet";
import { NameColorHost } from "@/features/subjects/NameColorDialog";
import { TodayView } from "@/features/today/TodayView";
import type { SlotDropData } from "@/features/today/ScheduleRail";
import { WeekView } from "@/features/week/WeekView";
import { CalendarView } from "@/features/calendar/CalendarView";
import { AssignmentsView } from "@/features/assignments/AssignmentsView";
import { AssignmentView } from "@/features/assignments/AssignmentView";
import { SubjectsView } from "@/features/subjects/SubjectsView";
import { SubjectView } from "@/features/subjects/SubjectView";
import { NotesView } from "@/features/notes/NotesView";
import { NoteView } from "@/features/notes/NoteView";
import { SettingsView } from "@/features/settings/SettingsView";
import { milestonesOf, moveTaskBefore, patchTask, rescheduleTask, startWorkspace, toggleTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { useMedia } from "@/ui/useMedia";
import { Button, IconButton, Spinner } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { AskHost, Tooltip, TooltipProvider } from "@/ui/overlay";
import { FormulaHost } from "@/ui/FormulaDialog";
import { SourcesHost } from "@/features/sources/SourcesSheet";
import { FocusTimer } from "@/features/focus/FocusTimer";
import { startTaskFocus } from "@/lib/focus";
import { workMinutes } from "@/features/tasks/meta";
import { toast, ToastHost } from "@/ui/toast";
import { GlassLayer } from "@/glass/GlassLayer";
import { GlassLens, LensDefs } from "@/ui/lens";
import { restoreGlassPrefs, useGlassOn } from "@/glass/prefs";
import { GLASS_GAP, useGlass } from "@/glass/registry";
import { routeHref, useNavigate, useRoute, type Route } from "./nav";
import { haptic, hideSplash, startNative } from "@/lib/native";
import { startReminders } from "@/features/reminders/startReminders";
import { startRepeats } from "@/store/repeat";
import { startFocusBridge } from "@/lib/focus";
import { startAssignmentImport } from "@/features/events/assignmentImport";
import { MobileTabBar } from "./MobileBar";
import { startOffline } from "@/lib/offline";
import { startPressFeedback } from "@/ui/press";
import { InstallHint } from "./InstallHint";
import { Sidebar } from "./Sidebar";
import { ui, useUI } from "./ui";
import { expireTrash } from "@/store/trash";

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
    startRepeats();
    startFocusBridge();
    startAssignmentImport();
    startOffline();
    startPressFeedback();
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

  useEffect(() => {
    if (!mounted || isLoading) return;
    hideSplash();
    // Recently deleted keeps things for 30 days.
    expireTrash();
  }, [mounted, isLoading]);

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
      <LensDefs />
      <TooltipProvider delayDuration={500} skipDelayDuration={200}>
        <Workspace />
        <TaskEditorHost />
        <CommandPalette />
        <AskNotesDialog />
        <SubjectStudyDialog />
        <PhotoNoteDialog />
        <ShortcutsSheet />
        <NameColorHost />
        <AskHost />
        <FormulaHost />
        <SourcesHost />
        <FocusTimer />
        <ToastHost />
        <InstallHint />
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
  // The shut drawer is hidden once it has slid away (and shown before it moves).
  const [drawerShown, setDrawerShown] = useState(false);
  const drawerSwipe = useDrawerSwipe(drawer, useCallback((open: boolean) => ui.set({ sidebarOpen: open }), []));
  if ((drawer || drawerSwipe.pulling) && !drawerShown) setDrawerShown(true);
  const glass = useGlassOn();
  const wide = useMedia("(min-width: 1024px)");
  const sidebarGlass = useGlass({ level: 1, kind: "chrome" });
  const slabGlass = useGlass({ level: 1, kind: "slab" });
  // Notes sit on the same glass as every other page (editing brings its own solid page).
  const paper = false;
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
    haptic("medium");
  };

  const settle = () => setTimeout(() => ui.set({ dragging: false }), 250);

  /** Where the pointer is, from where the drag started and how far it's gone. */
  const pointerY = (e: DragMoveEvent | DragEndEvent) => {
    const start = e.activatorEvent as PointerEvent | TouchEvent | null;
    const y = start && "touches" in start ? start.touches[0]?.clientY : (start as PointerEvent | null)?.clientY;
    return (y ?? 0) + e.delta.y;
  };
  const slotFor = (e: DragMoveEvent | DragEndEvent) => {
    const data = e.active.data.current as TaskDragData | undefined;
    const target = e.over?.data.current as SlotDropData | undefined;
    if (!data || data.task.milestone || target?.type !== "slot") return null;
    const duration = data.task.durationMinutes || 60;
    return { task: data.task, day: target.day, minutes: target.minutesAt(pointerY(e), duration), duration };
  };
  const onDragMove = (e: DragMoveEvent) => {
    const slot = slotFor(e);
    const current = ui.get().dropSlot;
    const next = slot ? { day: slot.day.getTime(), minutes: slot.minutes, duration: slot.duration } : null;
    if (next?.minutes !== current?.minutes || next?.day !== current?.day) ui.set({ dropSlot: next });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    settle();
    const slot = slotFor(e);
    ui.set({ dropSlot: null });
    if (e.over) haptic();
    if (slot) {
      // Dropped on the schedule: that day, at that time.
      const { task, day, minutes } = slot;
      const before = { date: task.date, startTime: task.startTime };
      if (!sameDay(task.date, day)) rescheduleTask(task.id, day);
      const startTime = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);
      patchTask(task.id, { startTime, durationMinutes: task.durationMinutes || 60 });
      toast(`Scheduled at ${formatClock(startTime)}`, {
        label: "Undo",
        run: () => patchTask(task.id, { ...before, durationMinutes: task.durationMinutes }),
      });
      return;
    }
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
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        ui.set({ dropSlot: null });
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
          {/* Only built where it shows: on phones it would re-render unseen. */}
          <div className="h-full w-[248px]">{wide && <Sidebar />}</div>
        </motion.aside>

        {/* Drawer on narrow windows. It stays built while shut (off screen and
            hidden), so opening it only has to slide, not assemble the sidebar. */}
        <AnimatePresence>
          {drawer && (
            <motion.div
              className="fixed inset-0 z-30 bg-scrim lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => ui.set({ sidebarOpen: false })}
            />
          )}
        </AnimatePresence>
        {!wide && (
          <motion.aside
            data-overlay={drawer || undefined}
            data-surface="drawer"
            aria-hidden={!drawer}
            inert={!drawer}
            className={cn(
              "glass-overlay fixed inset-y-0 left-0 z-40 w-[280px] shadow-modal will-change-transform lg:hidden max-md:top-[max(8px,env(safe-area-inset-top))] max-md:bottom-[max(8px,env(safe-area-inset-bottom))] max-md:left-2 max-md:w-[318px] max-md:max-w-[calc(100vw-56px)] max-md:overflow-hidden max-md:rounded-[30px] max-md:border max-md:border-line",
              !drawerShown && "invisible",
            )}
            initial={false}
            animate={drawerSwipe.pulling ? undefined : { x: drawer ? 0 : -330 }}
            transition={springs.panel}
            onAnimationComplete={() => {
              if (!ui.get().sidebarOpen) setDrawerShown(false);
            }}
            // Swipes back off to the left to close.
            {...drawerSwipe.handlers}
            style={{ x: drawerSwipe.x, touchAction: "pan-y" }}
          >
            <Sidebar onNavigate={() => ui.set({ sidebarOpen: false })} />
          </motion.aside>
        )}

        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* Notes read best on paper: a plain, solid panel instead of glass. */}
          <div
            ref={paper ? undefined : slabGlass}
            data-surface="main-slab"
            data-paper={paper || undefined}
            className="flex min-h-0 flex-1 flex-col"
          >
            {/* Each screen arrives with a short settle (phones only); pages
                opened from a list slide in from the side. */}
            <div
              key={route.view === "subject" || route.view === "assignment" || route.view === "note" ? `${route.view}:${route.id}` : route.view}
              className={cn("flex min-h-0 flex-1 flex-col", route.view === "assignment" || route.view === "note" || route.view === "subject" ? "view-push" : "view-in")}
            >
              <View route={route} />
            </div>
          </div>
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
  eyebrow,
  leading,
  actions,
  className,
}: {
  title: ReactNode;
  detail?: ReactNode;
  /** A small line above the title on phones (the detail is used otherwise). */
  eyebrow?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const sub = eyebrow ?? detail;
  return (
    // Phones: a small mono line over a large serif title, with round buttons
    // aligned to the title's baseline.
    <header
      className={cn(
        // The buttons (30px) sit 24px from the top, as far as from the side.
        "flex shrink-0 items-center gap-3 px-6 md:min-h-[64px] md:pt-6 md:pb-2.5 max-md:items-center max-md:px-5 max-md:pb-4",
        // Without the small line, the title drops to where the buttons sit on
        // pages that have one, so titles don't jump between pages.
        sub ? "max-md:pt-[calc(max(env(safe-area-inset-top),12px)+6px)]" : "max-md:pt-[calc(max(env(safe-area-inset-top),12px)+15px)]",
        className,
      )}
    >
      <IconButton label="Show sidebar" className="-ml-1.5 max-md:hidden lg:hidden" onClick={() => ui.set({ sidebarOpen: true })}>
        <MenuIcon className="size-[17px]" />
      </IconButton>
      {collapsed && (
        <IconButton label="Show sidebar" className="-ml-1.5 max-lg:hidden" onClick={() => ui.toggleSidebar()}>
          <MenuIcon className="size-[17px]" />
        </IconButton>
      )}
      {leading}
      <div className="flex min-w-0 items-baseline gap-2.5 max-md:flex-col-reverse max-md:gap-0">
        {title !== "" && (
          <h1 className="max-w-full truncate font-display max-md:relative max-md:-left-px text-xl font-semibold tracking-[-0.015em] max-md:text-[32px] max-md:leading-[1.2] max-md:font-bold max-md:tracking-[-0.025em]">
            {title}
          </h1>
        )}
        {sub && (
          <span className="max-w-full truncate text-sm text-ink-3 max-md:font-mono max-md:text-[12px] max-md:tracking-[0.08em] max-md:uppercase">
            <span className="md:hidden">{eyebrow ?? detail}</span>
            <span className="max-md:hidden">{detail}</span>
          </span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 max-md:gap-2 max-md:[&>button]:size-11 max-md:[&>button]:rounded-full max-md:[&>button]:lens-chip max-md:[&>button]:text-ink">
        {actions}
      </div>
    </header>
  );
}

/**
 * Back, a jump to the present, and forward. On phones the three share one
 * white capsule, and the jump only shows when it would go somewhere.
 */
export function Stepper({
  prev,
  next,
  onPrev,
  onNext,
  present,
  atPresent,
  onPresent,
  prevShortcut,
  nextShortcut,
}: {
  prev: string;
  next: string;
  onPrev: () => void;
  onNext: () => void;
  present: string;
  atPresent: boolean;
  onPresent: () => void;
  prevShortcut?: string[];
  nextShortcut?: string[];
}) {
  const phone = useMedia("(max-width: 767px)");
  // On wider screens the arrows and the jump back share one capsule of glass.
  const capsule = useGlass<HTMLDivElement>({ level: 2, kind: "plate", radius: "pill" });
  return (
    <div ref={phone ? undefined : capsule} className="relative mr-1 flex items-center max-md:mr-0 max-md:h-11 max-md:rounded-full md:rounded-full md:px-0.5">
      <GlassLens radius={22} bezel={15} className="lens-soft md:hidden" />
      <Tooltip label={prev} shortcut={prevShortcut}>
        <IconButton label={prev} onClick={() => { haptic(); onPrev(); }} className="relative max-md:h-[42px] max-md:w-11 max-md:rounded-full max-md:text-ink max-md:transition-colors max-md:duration-300 max-md:active:bg-fill-strong max-md:active:duration-0">
          <ChevronLeft className="size-4 max-md:size-[18px]" />
        </IconButton>
      </Tooltip>
      {phone ? (
        // The capsule widens to make room for the jump back, and closes up
        // again once you're there.
        <AnimatePresence initial={false}>
          {!atPresent && (
            <motion.button
              key="present"
              type="button"
              onClick={onPresent}
              initial={{ width: 0, opacity: 0, filter: "blur(4px)" }}
              animate={{ width: "auto", opacity: 1, filter: "blur(0px)" }}
              exit={{ width: 0, opacity: 0, filter: "blur(4px)" }}
              transition={{ width: springs.pill, opacity: { duration: 0.18 }, filter: { duration: 0.18 } }}
              className="relative h-8 overflow-hidden rounded-full text-[14px] font-medium whitespace-nowrap text-ink"
            >
              <span className="block px-2">{present}</span>
            </motion.button>
          )}
        </AnimatePresence>
      ) : (
        <Button variant="ghost" size="sm" disabled={atPresent} onClick={onPresent} className="relative">
          {present}
        </Button>
      )}
      <Tooltip label={next} shortcut={nextShortcut}>
        <IconButton label={next} onClick={() => { haptic(); onNext(); }} className="relative max-md:h-[42px] max-md:w-11 max-md:rounded-full max-md:text-ink max-md:transition-colors max-md:duration-300 max-md:active:bg-fill-strong max-md:active:duration-0">
          <ChevronRight className="size-4 max-md:size-[18px]" />
        </IconButton>
      </Tooltip>
    </div>
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
      // Escape (and the phone's Back button) puts the drawer away, even from
      // its search field.
      if (e.key === "Escape" && ui.get().sidebarOpen && !document.querySelector('[role="dialog"], [role="menu"]')) {
        ui.set({ sidebarOpen: false });
        return;
      }
      if (isTyping(e.target) || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const state = ui.get();
      if (mod && !e.altKey && !e.shiftKey && (e.key === "d" || e.key === "D")) {
        // ⌘D duplicates the selected task (instead of bookmarking the page).
        const id = state.selectedId;
        const task = id ? useWorkspace.getState().tasks.find((t) => t.id === id) : undefined;
        if (!task || !(state.visibleOrder.includes(task.id) || state.inspectorId === task.id)) return;
        e.preventDefault();
        duplicateTask(task);
        return;
      }
      if (e.altKey || (mod && e.key !== "Enter")) return;

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
        case "f":
        case "F": {
          const task = findSelected();
          if (!task || task.isDone) return;
          e.preventDefault();
          startTaskFocus(task, workMinutes(task));
          return;
        }
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

/**
 * Swiping the phone menu to the left drags it along and closes it past a
 * short distance (or on a flick); vertical movement is left to scrolling.
 */
/**
 * The phone drawer follows the finger both ways. A long rightward swipe from
 * anywhere (not starting on something that swipes sideways itself, like a
 * task row or the month grid) pulls it in; a long leftward swipe on it puts it
 * away. Short or slow flicks spring back, so it never opens by accident.
 */
const DRAWER_W = 330;

/** The nearest ancestor that scrolls sideways (a toolbar, a chip row), if any. */
function sideScroller(el: Element | null): Element | null {
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return node;
    }
  }
  return null;
}
const OPEN_AT = 150;
const CLOSE_AT = 130;

function useDrawerSwipe(open: boolean, setOpen: (open: boolean) => void) {
  const x = useMotionValue(-DRAWER_W);
  const [pulling, setPulling] = useState(false);
  const start = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);

  // Pulling it in: listens on the whole window, for touches that start while
  // the drawer is shut (it opens mid-gesture, so this mustn't depend on it).
  const isOpen = useRef(open);
  useEffect(() => {
    isOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!matchMedia("(max-width: 767px)").matches) return;
    let s: { x: number; y: number; t: number; axis: "x" | "y" | null } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      const target = e.target as Element | null;
      // Only on the page itself: not over a sheet, dialog or menu (they sit on
      // top), nor on anything that moves sideways by itself.
      const layered = document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
      const own =
        target?.closest('[data-hswipe], [data-overlay], [role="slider"], input, textarea, select, [contenteditable=true], .ql-editor') ??
        sideScroller(target);
      s =
        !isOpen.current && !layered && !own && e.touches.length === 1 && !ui.get().editor && !ui.get().inspectorId
          ? { x: t.clientX, y: t.clientY, t: performance.now(), axis: null }
          : null;
    };
    const move = (e: TouchEvent) => {
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.axis) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        // A touch that rested first is a long press: it picks a task up to
        // drag, and a drag to the right mustn't pull the menu in too.
        const held = performance.now() - s.t > 240;
        s.axis = !held && dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
        if (s.axis === "y") {
          s = null;
          return;
        }
        x.set(-DRAWER_W);
        setPulling(true);
        setOpen(true);
      }
      x.set(Math.min(0, -DRAWER_W + dx * 0.9));
    };
    const up = (e: TouchEvent) => {
      const cur = s;
      s = null;
      if (!cur || cur.axis !== "x") return;
      const dx = (e.changedTouches[0]?.clientX ?? cur.x) - cur.x;
      const speed = dx / Math.max(1, performance.now() - cur.t);
      if (dx > OPEN_AT || (dx > 90 && speed > 0.9)) {
        haptic();
        void animate(x, 0, springs.panel).then(() => setPulling(false));
      } else {
        void animate(x, -DRAWER_W, springs.panel).then(() => {
          setOpen(false);
          setPulling(false);
        });
      }
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [setOpen, x]);

  const handlers = {
    onTouchStart(e: React.TouchEvent) {
      const t = e.touches[0];
      start.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: performance.now(), axis: null } : null;
    },
    onTouchMove(e: React.TouchEvent) {
      const s = start.current;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.axis) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        s.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
      }
      if (s.axis === "x") x.set(Math.min(0, dx));
    },
    onTouchEnd(e: React.TouchEvent) {
      const s = start.current;
      start.current = null;
      if (!s || s.axis !== "x") return;
      const dx = (e.changedTouches[0]?.clientX ?? s.x) - s.x;
      const speed = dx / Math.max(1, performance.now() - s.t);
      if (dx < -CLOSE_AT || (dx < -90 && speed < -0.9)) setOpen(false);
      else void animate(x, 0, springs.panel);
    },
  };
  return { x, handlers, pulling };
}

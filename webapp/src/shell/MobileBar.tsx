"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, FileText, GraduationCap, Menu as MenuIcon, Plus, Sun } from "lucide-react";
import { createNote } from "@/features/notes/noteActions";
import { haptic } from "@/lib/native";
import { cn } from "@/ui/cn";
import { springs } from "@/ui/motion";
import { GlassLens } from "@/ui/lens";
import type { Route } from "./nav";
import { ui, useUI } from "./ui";

type Tab = { view: Route["view"]; label: string; icon: ReactNode; also?: Route["view"][] };

const TABS: Tab[] = [
  { view: "today", label: "Today", icon: <Sun /> },
  { view: "calendar", label: "Calendar", icon: <CalendarDays />, also: ["week"] },
  { view: "assignments", label: "Assignments", icon: <GraduationCap />, also: ["assignment"] },
  { view: "notes", label: "Notes", icon: <FileText />, also: ["note"] },
];

/** What the add button creates on each screen (the same as the N shortcut). */
export function createForRoute(route: Route, navigate: (r: Route) => void) {
  const state = ui.get();
  switch (route.view) {
    case "today":
      return ui.newTask({ date: state.day });
    case "week":
      return ui.newTask({ date: state.weekOf });
    case "calendar":
      return ui.newTask({ date: state.calendarDay });
    case "assignments":
      return ui.newTask({ type: "assignment", durationMinutes: 120 });
    case "subject":
      return ui.newTask({ projectId: route.id });
    case "notes":
      return createNote(navigate);
    default:
      return ui.newTask({});
  }
}

const HAS_ADD: Route["view"][] = ["today", "week", "calendar", "assignments", "subject", "notes"];

/**
 * Phone navigation: a floating capsule of icon-only tabs within thumb reach,
 * with everything else (Week, Subjects, Settings) under More, and the add
 * button as a matching drop of glass beside it. Both are a fixed, subtle
 * frosted glass (the Liquid Glass theme is desktop only). Hidden from tablet
 * width up.
 *
 * The geometry is concentric: the capsule is 58 px tall with a 5 px inset,
 * so the selection inside it (48 px) shares its centre of curvature, and the
 * add button is a 58 px circle.
 */
export function MobileTabBar({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  const drawer = useUI((s) => s.sidebarOpen);
  const hidden = useUI((s) => s.sidebarOpen || s.editor != null || s.inspectorId != null);
  const current = TABS.find((t) => t.view === route.view || t.also?.includes(route.view));
  // The button keeps its place while hidden (it only fades), so the bar's
  // width, and with it the glass, doesn't change as the menu slides in.
  const canAdd = HAS_ADD.includes(route.view);
  return (
    <nav className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end px-4 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden">
      <div className="pointer-events-auto relative grid h-[58px] min-w-0 flex-1 grid-cols-5 rounded-full p-[5px]">
        <GlassLens radius={29} bezel={22} className="lens-bar" />
        {TABS.map((tab) => (
          <TabButton
            key={tab.view}
            label={tab.label}
            icon={tab.icon}
            active={!drawer && current === tab}
            onClick={() => {
              if (current !== tab || drawer) haptic();
              ui.set({ sidebarOpen: false });
              navigate({ view: tab.view } as Route);
            }}
          />
        ))}
        <TabButton label="More" icon={<MenuIcon />} active={drawer || !current} onClick={() => {
            haptic();
            ui.set({ sidebarOpen: !drawer });
          }} />
      </div>
      <AnimatePresence initial={false}>
        {canAdd && (
          <motion.button
            type="button"
            aria-label={route.view === "notes" ? "New note" : "New task"}
            initial={{ width: 0, marginLeft: 0, opacity: 0, scale: 0.6 }}
            animate={{ width: 58, marginLeft: 10, opacity: hidden ? 0 : 1, scale: hidden ? 0.7 : 1 }}
            aria-hidden={hidden || undefined}
            tabIndex={hidden ? -1 : undefined}
            style={{ pointerEvents: hidden ? "none" : undefined }}
            exit={{ width: 0, marginLeft: 0, opacity: 0, scale: 0.6 }}
            whileTap={{ scale: 0.88, transition: springs.press }}
            transition={springs.panel}
            data-no-press
            onClick={() => {
              haptic("medium");
              createForRoute(route, navigate);
            }}
            className="lens-round pointer-events-auto flex h-[58px] shrink-0 items-center justify-center overflow-hidden rounded-full text-ink"
          >
            <Plus className="size-[25px] shrink-0" strokeWidth={2.1} />
          </motion.button>
        )}
      </AnimatePresence>
    </nav>
  );
}

function TabButton({ label, icon, active, onClick }: { label: string; icon: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className={cn(
        "relative flex min-w-0 items-center justify-center rounded-full transition-colors duration-200",
        active ? "text-ink" : "text-ink-3",
      )}
    >
      {active && (
        <motion.span layoutId="tab-pill" transition={springs.pill} className="absolute inset-0 rounded-full">
          <GlassLens radius={24} bezel={14} frost={0.75} className="lens-pill" />
        </motion.span>
      )}
      {/* The icon lifts a little as it becomes the current tab. */}
      <motion.span
        className={cn("relative flex [&>svg]:size-[23px] [&>svg]:transition-[stroke-width] [&>svg]:duration-200", active ? "[&>svg]:stroke-[2.1]" : "[&>svg]:stroke-[1.75]")}
        initial={false}
        animate={{ scale: active ? [0.82, 1.08, 1] : 1 }}
        transition={{ duration: 0.42, ease: [0.2, 0.9, 0.3, 1], times: [0, 0.55, 1] }}
      >
        {icon}
      </motion.span>
    </button>
  );
}

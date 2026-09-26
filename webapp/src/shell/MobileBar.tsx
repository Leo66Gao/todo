"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, FileText, GraduationCap, Menu as MenuIcon, Plus, Sun } from "lucide-react";
import { createNote } from "@/features/notes/noteActions";
import { cn } from "@/ui/cn";
import { springs } from "@/ui/motion";
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
 * Phone navigation: a bottom tab bar within thumb reach, with everything else
 * (Week, Subjects, Settings) under More. Hidden from tablet width up.
 */
export function MobileTabBar({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  const drawer = useUI((s) => s.sidebarOpen);
  const current = TABS.find((t) => t.view === route.view || t.also?.includes(route.view));
  return (
    <nav className="relative z-20 shrink-0 border-t border-line bg-canvas/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <div className="grid h-[54px] grid-cols-5">
        {TABS.map((tab) => (
          <TabButton
            key={tab.view}
            label={tab.label}
            icon={tab.icon}
            active={!drawer && current === tab}
            onClick={() => {
              ui.set({ sidebarOpen: false });
              navigate({ view: tab.view } as Route);
            }}
          />
        ))}
        <TabButton
          label="More"
          icon={<MenuIcon />}
          active={drawer || !current}
          onClick={() => ui.set({ sidebarOpen: !drawer })}
        />
      </div>
    </nav>
  );
}

function TabButton({ label, icon, active, onClick }: { label: string; icon: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-[3px] transition-[color,transform] duration-150 active:scale-[0.92]",
        active ? "text-ink" : "text-ink-3",
      )}
    >
      <span className={cn("flex [&>svg]:size-[21px]", active ? "[&>svg]:stroke-[2.1]" : "[&>svg]:stroke-[1.7]")}>{icon}</span>
      <span className={cn("text-[10.5px] leading-none", active && "font-semibold")}>{label}</span>
    </button>
  );
}

/** The add button, above the tab bar on the right, on screens that create things. */
export function MobileAddButton({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  const hidden = useUI((s) => s.sidebarOpen || s.editor != null || s.inspectorId != null);
  const show = HAS_ADD.includes(route.view) && !hidden;
  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          aria-label={route.view === "notes" ? "New note" : "New task"}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          whileTap={{ scale: 0.9 }}
          transition={springs.snappy}
          onClick={() => createForRoute(route, navigate)}
          className="absolute right-4 bottom-[calc(54px+env(safe-area-inset-bottom)+16px)] z-20 flex size-[52px] items-center justify-center rounded-full bg-ink text-on-ink shadow-[0_6px_20px_-6px_rgb(0_0_0/0.45)] md:hidden"
        >
          <Plus className="size-6" strokeWidth={2.2} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

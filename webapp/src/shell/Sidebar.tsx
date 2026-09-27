"use client";

import { useMemo, type ReactNode } from "react";
import { motion } from "motion/react";
import { useDroppable } from "@dnd-kit/core";
import {
  BookOpen,
  CalendarDays,
  Columns3,
  FileText,
  GraduationCap,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { argbToCss } from "@/lib/dart";
import type { Project } from "@/lib/model";
import { isOverdue, sameDay, today } from "@/lib/time";
import { useAllTasks } from "@/features/tasks/meta";
import { createSubject, subjectMenu } from "@/features/subjects/subjectActions";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { IconButton, Kbd } from "@/ui/controls";
import { ContextMenu, Tooltip } from "@/ui/overlay";
import { springs } from "@/ui/motion";
import { useGlassOn } from "@/glass/prefs";
import { useGlass } from "@/glass/registry";
import { useNavigate, useRoute, type Route } from "./nav";
import { ui } from "./ui";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const route = useRoute();
  const navigate = useNavigate();
  const all = useAllTasks();
  const projects = useWorkspace((s) => s.projects);
  const user = useWorkspace((s) => s.user);
  const cloudStatus = useWorkspace((s) => s.cloudStatus);
  // A save or sync problem shows here in red (details are in Settings).
  const cloudError = useWorkspace((s) => s.cloudError);
  const searchWell = useGlass<HTMLButtonElement>({ level: 2, kind: "well", interactive: true });

  const counts = useMemo(() => {
    const now = today();
    const todayOpen = all.filter((t) => !t.isDone && sameDay(t.date, now)).length;
    const overdue = all.filter((t) => isOverdue(t.date, t.isDone)).length;
    const assignments = all.filter((t) => t.type === "assignment" && !t.isDone && !t.parentTaskId).length;
    const perSubject = new Map<string, number>();
    for (const t of all) {
      if (!t.isDone && t.projectId && !t.parentTaskId) perSubject.set(t.projectId, (perSubject.get(t.projectId) ?? 0) + 1);
    }
    return { todayOpen, overdue, assignments, perSubject };
  }, [all]);

  const go = (r: Route) => {
    navigate(r);
    onNavigate?.();
  };
  const active = (view: Route["view"]) =>
    route.view === view ||
    (view === "assignments" && route.view === "assignment") ||
    (view === "notes" && route.view === "note");

  return (
    <nav className="flex h-full w-full flex-col bg-sidebar">
      <div className="flex h-[52px] shrink-0 items-center gap-2 pr-2.5 pl-4 max-md:h-auto max-md:pt-[max(18px,env(safe-area-inset-top))] max-md:pb-3 max-md:pl-5">
        <span className="flex size-[22px] items-center justify-center rounded-[6px] bg-ink">
          <svg viewBox="0 0 16 16" className="size-3.5">
            <path d="M4 8.4l2.6 2.6L12 5.4" fill="none" stroke="var(--on-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-sm font-semibold tracking-[-0.005em] max-md:text-[17px]">Todo</span>
        <Tooltip label="Hide sidebar" shortcut={["⌘", "\\"]}>
          <IconButton label="Hide sidebar" size="sm" className="ml-auto max-lg:hidden" onClick={() => ui.toggleSidebar()}>
            <PanelLeft className="size-4" />
          </IconButton>
        </Tooltip>
      </div>

      <div className="px-2.5 pb-2 max-md:px-4 max-md:pb-3">
        <button
          ref={searchWell}
          type="button"
          onClick={() => {
            ui.set({ paletteOpen: true });
            onNavigate?.();
          }}
          className="flex h-[30px] w-full items-center gap-2 rounded-ctl bg-card/80 px-2.5 text-sm text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-canvas hover:text-ink-2 max-md:h-10 max-md:rounded-full max-md:bg-card max-md:px-3.5 max-md:text-[15px] max-md:shadow-card dark:bg-fill/50"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <div className="scroll-area flex-1 px-2.5 pb-3 max-md:px-3">
        <div className="space-y-px">
          <DayDrop>
            <NavItem icon={<Sun />} label="Today" count={counts.todayOpen} active={active("today")} onClick={() => go({ view: "today" })} />
          </DayDrop>
          <NavItem icon={<Columns3 />} label="Week" active={active("week")} onClick={() => go({ view: "week" })} />
          <NavItem icon={<CalendarDays />} label="Calendar" active={active("calendar")} onClick={() => go({ view: "calendar" })} />
          <NavItem
            icon={<GraduationCap />}
            label="Assignments"
            count={counts.assignments}
            active={active("assignments")}
            onClick={() => go({ view: "assignments" })}
          />
          <NavItem icon={<BookOpen />} label="Subjects" active={active("subjects")} onClick={() => go({ view: "subjects" })} />
          <NavItem icon={<FileText />} label="Notes" active={active("notes")} onClick={() => go({ view: "notes" })} />
        </div>

        {counts.overdue > 0 && (
          <button
            type="button"
            onClick={() => go({ view: "today" })}
            className="mt-2 flex h-7 w-full items-center gap-2 rounded-ctl px-2.5 text-xs text-danger transition-colors hover:bg-danger-soft max-md:h-10 max-md:px-3 max-md:text-[14px]"
          >
            <span className="size-1.5 rounded-full bg-danger" />
            {counts.overdue} overdue
          </button>
        )}

        <div className="mt-5 flex h-7 items-center justify-between pr-1 pl-2.5 max-md:mt-6 max-md:pl-3">
          <span className="text-xs font-medium text-ink-3 max-md:text-[13.5px]">Subjects</span>
          <Tooltip label="New subject">
            <IconButton label="New subject" size="sm" onClick={() => void createSubject()}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
        </div>
        <div className="space-y-px">
          {projects.map((p) => (
            <SubjectItem
              key={p.id}
              project={p}
              count={counts.perSubject.get(p.id) ?? 0}
              active={route.view === "subject" && route.id === p.id}
              onClick={() => go({ view: "subject", id: p.id })}
            />
          ))}
          {projects.length === 0 && (
            <button
              type="button"
              onClick={() => void createSubject()}
              className="flex h-[30px] w-full items-center rounded-ctl px-2.5 text-sm text-ink-3 hover:bg-fill hover:text-ink-2"
            >
              Add a subject
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-line p-2.5 max-md:px-3 max-md:pb-[max(10px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => go({ view: "settings" })}
          className={cn(
            "flex h-10 w-full items-center gap-2.5 rounded-ctl px-2 text-left transition-colors hover:bg-fill max-md:h-14 max-md:gap-3 max-md:rounded-[14px] max-md:px-2.5",
            route.view === "settings" && "bg-fill",
          )}
        >
          <Avatar name={user?.displayName ?? user?.email ?? null} photo={user?.photoURL ?? null} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium max-md:text-[15px]">{user ? (user.displayName ?? user.email) : "On this device"}</span>
            <span className="flex items-center gap-1.5 truncate text-2xs text-ink-3">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", !user && !cloudError && "bg-ink-4")}
                style={{
                  background: cloudError
                    ? "var(--danger)"
                    : !user
                      ? undefined
                      : cloudStatus === "Synced"
                        ? "var(--p-low)"
                        : "var(--p-medium)",
                }}
              />
              <span className={cn("truncate", cloudError && "text-danger")}>
                {cloudError ? "Needs attention" : user ? cloudStatus : "Not signed in"}
              </span>
            </span>
          </span>
          <Settings className="size-4 shrink-0 text-ink-3" />
        </button>
      </div>
    </nav>
  );
}

function Avatar({ name, photo }: { name: string | null; photo: string | null }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" referrerPolicy="no-referrer" className="size-7 shrink-0 rounded-full" />;
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-strong text-xs font-semibold text-ink-2">
      {name ? name.trim()[0]?.toUpperCase() : "·"}
    </span>
  );
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  dropping,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  dropping?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label.length > 24 ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-[30px] w-full min-w-0 items-center gap-2.5 rounded-ctl px-2.5 text-sm transition-colors duration-100 max-md:h-11 max-md:gap-3.5 max-md:rounded-[12px] max-md:px-3 max-md:text-[16px]",
        active ? "font-medium text-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
        dropping && "bg-accent-soft text-accent",
      )}
    >
      {active && <ActivePill />}
      <span className={cn("relative flex shrink-0 [&>svg]:size-4 max-md:[&>svg]:size-5", active ? "text-ink" : "text-ink-3")}>{icon}</span>
      <span className="relative min-w-0 flex-1 truncate text-left">{label}</span>
      {count != null && count > 0 && <span className="relative shrink-0 text-xs text-ink-3 tnum max-md:text-[14px]">{count}</span>}
    </button>
  );
}

/** The current page's highlight; in Liquid Glass it is a glass lens that glides between items. */
function ActivePill() {
  const glass = useGlassOn();
  const pill = useGlass<HTMLSpanElement>({ level: 2, kind: "control", interactive: true, inScroll: true });
  return (
    <motion.span
      ref={pill}
      layoutId={glass ? "nav-pill" : undefined}
      transition={springs.snappy}
      className="absolute inset-0 rounded-[inherit] bg-card shadow-card"
    />
  );
}

function DayDrop({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "sidebar-today", data: { type: "day", date: today() } });
  return (
    <div ref={setNodeRef} className={cn("rounded-ctl transition-shadow", isOver && "shadow-[inset_0_0_0_1.5px_var(--accent-line)]")}>
      {children}
    </div>
  );
}

function SubjectItem({
  project,
  count,
  active,
  onClick,
}: {
  project: Project;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const navigate = useNavigate();
  const { setNodeRef, isOver } = useDroppable({ id: `subject-${project.id}`, data: { type: "subject", id: project.id } });
  return (
    <ContextMenu items={() => subjectMenu(project, navigate)}>
      <div ref={setNodeRef} className={cn("rounded-ctl transition-shadow", isOver && "shadow-[inset_0_0_0_1.5px_var(--accent-line)]")}>
        <NavItem
          icon={
            <span className="flex size-4 items-center justify-center max-md:size-5">
              <span className="size-2 rounded-full max-md:size-2.5" style={{ background: argbToCss(project.colorValue) }} />
            </span>
          }
          label={project.title}
          count={count}
          active={active}
          onClick={onClick}
        />
      </div>
    </ContextMenu>
  );
}

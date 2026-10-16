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
  User,
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
  const searchWell = useGlass<HTMLButtonElement>({ level: 2, kind: "plate", interactive: true });
  const glass = useGlassOn();
  // In Liquid Glass the profile sits on its own raised box of glass.
  const profilePlate = useGlass<HTMLButtonElement>({ level: 2, kind: "plate", interactive: true });

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

  // The drawer starts closing first; the next page follows a frame later,
  // so its first render doesn't hold up the drawer's first frames.
  const go = (r: Route) => {
    onNavigate?.();
    if (onNavigate) requestAnimationFrame(() => navigate(r));
    else navigate(r);
  };
  const active = (view: Route["view"]) =>
    route.view === view ||
    (view === "assignments" && route.view === "assignment") ||
    (view === "notes" && route.view === "note");

  return (
    <nav className="flex h-full w-full flex-col bg-sidebar max-md:px-1">
      <div className="flex h-[52px] shrink-0 items-center gap-2 pr-2.5 pl-4 max-md:h-auto max-md:gap-3 max-md:pt-12 max-md:pb-1 max-md:pl-[18px]">
        <span className="flex size-[22px] items-center justify-center rounded-[6px] bg-ink max-md:size-[34px] max-md:rounded-[10px]">
          <svg viewBox="0 0 16 16" className="size-3.5 max-md:size-5">
            <path d="M4 8.4l2.6 2.6L12 5.4" fill="none" stroke="var(--on-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-sm font-semibold tracking-[-0.005em] max-md:font-display max-md:text-[24px] max-md:leading-none max-md:font-bold max-md:tracking-[-0.02em]">Todo</span>
        <Tooltip label="Hide sidebar" shortcut={["⌘", "\\"]}>
          <IconButton label="Hide sidebar" size="sm" className="ml-auto max-lg:hidden" onClick={() => ui.toggleSidebar()}>
            <PanelLeft className="size-4" />
          </IconButton>
        </Tooltip>
      </div>

      <div className="px-2.5 pb-2 max-md:pt-4 max-md:pb-3">
        <button
          ref={searchWell}
          type="button"
          onClick={() => {
            ui.set({ paletteOpen: true });
            onNavigate?.();
          }}
          className="flex h-[30px] w-full items-center gap-2 rounded-ctl bg-card/80 px-2.5 text-sm text-ink-3 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-canvas hover:text-ink-2 dark:bg-fill/50 max-md:h-[46px] max-md:gap-2.5 max-md:rounded-full max-md:px-3.5 max-md:text-[15px]"
        >
          <Search className="size-3.5 max-md:size-[18px]" />
          <span className="flex-1 text-left">Search</span>
          <Kbd className="max-md:hidden">⌘K</Kbd>
        </button>
      </div>

      <div className="scroll-area flex-1 px-2.5 pb-3">
        <div className="space-y-px max-md:space-y-0.5">
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
            className="mt-2 flex h-7 w-full items-center gap-2 rounded-ctl px-2.5 text-xs text-danger transition-colors hover:bg-danger-soft max-md:h-9 max-md:gap-3.5 max-md:px-3 max-md:text-[13px]"
          >
            <span className="size-1.5 rounded-full bg-danger max-md:mx-[7px]" />
            {counts.overdue} overdue
          </button>
        )}

        <div className="mt-5 flex h-7 items-center justify-between pr-1 pl-2.5 max-md:mx-1 max-md:mt-4 max-md:h-auto max-md:border-t max-md:border-line max-md:pt-2 max-md:pl-2">
          <span className="text-xs font-medium text-ink-3 max-md:font-mono max-md:text-[11px] max-md:font-normal max-md:tracking-[0.08em] max-md:uppercase">Subjects</span>
          <Tooltip label="New subject">
            <IconButton label="New subject" size="sm" onClick={() => void createSubject()}>
              <Plus className="size-3.5" />
            </IconButton>
          </Tooltip>
        </div>
        <div className="space-y-px max-md:space-y-0.5">
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

      <div className={cn("shrink-0 border-t border-line p-2.5 max-md:border-t-0 max-md:px-1.5 max-md:pb-3.5", glass && "border-t-0")}>
        <button
          ref={profilePlate}
          type="button"
          onClick={() => go({ view: "settings" })}
          className={cn(
            "flex w-full items-center gap-2.5 text-left transition-colors hover:bg-fill max-md:h-auto max-md:gap-3 max-md:rounded-[22px] max-md:border max-md:border-line max-md:bg-fill/50 max-md:py-2.5 max-md:pr-3 max-md:pl-3",
            // On glass, concentric with the sidebar's corners: its radius less the 10px gap.
            glass ? "h-13 rounded-[calc(var(--glass-radius,22px)_-_10px)] px-2.5" : "h-10 rounded-ctl px-2",
            route.view === "settings" && "bg-fill",
          )}
        >
          <Avatar name={user?.displayName ?? user?.email ?? null} photo={user?.photoURL ?? null} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium max-md:text-[14px]">{user ? (user.displayName ?? user.email) : "On this device"}</span>
            <span className="flex items-center gap-1.5 truncate text-2xs text-ink-3 max-md:mt-0.5 max-md:text-[12px]">
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
          {!user && (
            <span className="flex h-9 shrink-0 items-center rounded-full bg-ink px-3.5 text-[13px] font-semibold text-on-ink md:hidden">Sign in</span>
          )}
          <Settings className={cn("size-4 shrink-0 text-ink-3 max-md:size-[18px]", !user && "max-md:hidden")} />
        </button>
      </div>
    </nav>
  );
}

function Avatar({ name, photo }: { name: string | null; photo: string | null }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" referrerPolicy="no-referrer" className="size-7 shrink-0 rounded-full max-md:size-10" />;
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-strong text-xs font-semibold text-ink-2 max-md:size-10 max-md:text-sm">
      {name ? name.trim()[0]?.toUpperCase() : <User className="size-3.5 max-md:size-[18px]" />}
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
        "relative flex h-[30px] w-full min-w-0 items-center gap-2.5 rounded-ctl px-2.5 text-sm transition-colors duration-100 max-md:h-[46px] max-md:gap-3.5 max-md:rounded-[15px] max-md:px-3 max-md:text-[15px] max-md:font-medium",
        active ? "font-medium text-ink" : "text-ink-2 hover:bg-fill hover:text-ink max-md:text-ink",
        dropping && "bg-accent-soft text-accent",
      )}
    >
      {active && <ActivePill />}
      <span className={cn("relative flex shrink-0 [&>svg]:size-4 max-md:[&>svg]:size-5 max-md:[&>svg]:stroke-[1.75]", active ? "text-ink" : "text-ink-3 max-md:text-ink-2")}>{icon}</span>
      <span className="relative min-w-0 flex-1 truncate text-left">{label}</span>
      {count != null && count > 0 && <span className="relative shrink-0 text-xs text-ink-3 tnum max-md:font-mono max-md:text-[12px]">{count}</span>}
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
      className="absolute inset-0 rounded-ctl bg-card shadow-card max-md:rounded-[15px] max-md:bg-fill max-md:shadow-none"
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
            <span className="flex size-4 items-center justify-center max-md:w-5">
              <span
                className="size-2 rounded-full max-md:size-[9px] max-md:shadow-[0_0_0_3px_color-mix(in_srgb,var(--dot)_18%,transparent)]"
                style={{ background: argbToCss(project.colorValue), ["--dot" as string]: argbToCss(project.colorValue) }}
              />
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

"use client";

import type { ReactNode } from "react";
import { format } from "date-fns";
import { motion } from "motion/react";
import { ChevronLeft, MoreHorizontal, Pencil } from "lucide-react";
import { daysFromToday, formatDuration, isOverdue } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui } from "@/shell/ui";
import { taskMenu } from "@/features/tasks/actions";
import { TaskDetail } from "@/features/tasks/Inspector";
import { difficultyColor, workMinutes } from "@/features/tasks/meta";
import { hasExplicitDifficulty, type Task } from "@/lib/model";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { Menu, Tooltip } from "@/ui/overlay";

/**
 * An assignment's own page, laid out like the phone app's: a quiet top row
 * (back, edit, more), the due date and difficulty, the title, a status card,
 * and then the fields, subtasks and notes.
 */
export function AssignmentView({ id }: { id: string }) {
  const task = useWorkspace((s) => s.tasks.find((t) => t.id === id));
  const navigate = useNavigate();
  const back = (
    <button
      type="button"
      aria-label="Back to assignments"
      onClick={() => navigate({ view: "assignments" })}
      className="-ml-1 flex h-9 items-center gap-1 rounded-full pr-3 pl-1.5 text-sm text-ink-3 transition-colors hover:bg-fill hover:text-ink max-md:ml-0 max-md:size-11 max-md:justify-center max-md:border max-md:border-line max-md:bg-card max-md:p-0 max-md:text-ink max-md:shadow-card"
    >
      <ChevronLeft className="size-[18px] max-md:size-5" />
      <span className="max-md:hidden">Assignments</span>
    </button>
  );
  if (!task) {
    return (
      <>
        <PageHeader title="" leading={back} />
        <p className="px-6 py-10 text-sm text-ink-3">This assignment was deleted or hasn’t synced to this device yet.</p>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title=""
        leading={back}
        actions={
          <>
            <Tooltip label="Edit all fields">
              <IconButton label="Edit assignment" onClick={() => ui.editTask(task.id)}>
                <Pencil className="size-[15px] max-md:size-[17px]" />
              </IconButton>
            </Tooltip>
            <Menu
              align="end"
              trigger={
                <IconButton label="More">
                  <MoreHorizontal className="size-4 max-md:size-5" />
                </IconButton>
              }
              items={taskMenu(task, navigate)
                .filter((i) => !("label" in i) || (i.label !== "Open" && i.label !== "Open assignment" && i.label !== "Edit…"))
                .map((i) =>
                  "label" in i && i.label === "Delete"
                    ? { ...i, onSelect: () => {
                        i.onSelect?.();
                        navigate({ view: "assignments" });
                      } }
                    : i,
                )}
            />
          </>
        }
      />
      <div className="scroll-area flex-1 pb-bar">
        <div className="mx-auto w-full max-w-[720px] px-6 pt-3 max-md:px-5 max-md:pt-4">
          <DueRow task={task} />
          <TaskDetail taskId={task.id} variant="page" summary={<StatusCard task={task} />} />
        </div>
      </div>
    </>
  );
}

function DueRow({ task }: { task: Task }) {
  const overdue = isOverdue(task.date, task.isDone);
  const days = daysFromToday(task.date);
  const countdown = task.isDone
    ? "Completed"
    : overdue
      ? `${-days} ${days === -1 ? "day" : "days"} overdue`
      : days === 0
        ? "Due today"
        : days === 1
          ? "Due tomorrow"
          : `${days} days left`;
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="flex h-7 items-center rounded-full bg-ink px-3 font-mono text-[12px] text-on-ink tnum">{format(task.date, "EEE, MMM d")}</span>
      <span className={cn("text-[13px]", overdue ? "font-medium text-danger" : "text-ink-3")}>{countdown}</span>
      {hasExplicitDifficulty(task) && (
        <span className="ml-auto flex h-7 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] text-ink-2">
          <span className="size-[7px] rounded-full" style={{ background: difficultyColor(task.difficulty) }} />
          Level {task.difficulty}
        </span>
      )}
    </div>
  );
}

function StatusCard({ task }: { task: Task }) {
  const done = task.subtasks.filter((s) => s.isDone).length;
  const total = task.subtasks.length;
  const ratio = task.isDone ? 1 : total > 0 ? done / total : 0;
  const minutes = task.isDone ? 0 : workMinutes(task);
  const days = daysFromToday(task.date);
  const overdue = isOverdue(task.date, task.isDone);
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="mt-4 flex items-center gap-5 rounded-[22px] border border-line bg-card px-5 py-4 shadow-card md:rounded-card">
      <div className="relative size-16 shrink-0">
        <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" className="stroke-fill-strong" />
          <motion.circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            className="stroke-accent"
            strokeDasharray={c}
            initial={false}
            animate={{ strokeDashoffset: c * (1 - ratio) }}
            transition={springs.panel}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[13px] font-medium tnum">{Math.round(ratio * 100)}%</span>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-3 gap-3">
        <Figure value={minutes > 0 ? formatDuration(minutes) : "—"} label="Work left" />
        <Figure
          value={task.isDone ? "Done" : overdue ? `${-days}d` : days === 0 ? "Today" : `${days}d`}
          label={task.isDone ? "Status" : overdue ? "Overdue" : "To due"}
          danger={overdue}
        />
        <Figure value={total > 0 ? `${done}/${total}` : "—"} label="Subtasks" />
      </div>
    </div>
  );
}

function Figure({ value, label, danger }: { value: ReactNode; label: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={cn("truncate text-[19px] leading-none font-semibold tracking-[-0.02em] tnum", danger && "text-danger", value === "—" && "text-ink-4")}>
        {value}
      </div>
      <div className="mt-1.5 truncate text-[11.5px] text-ink-3">{label}</div>
    </div>
  );
}

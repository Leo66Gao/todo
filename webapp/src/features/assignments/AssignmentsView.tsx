"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { format } from "date-fns";
import { Plus, Timer } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { hasExplicitDifficulty, type Task } from "@/lib/model";
import { addDays, daysFromToday, dueLabel, formatDuration, isOverdue, today } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui } from "@/shell/ui";
import { taskMenu } from "@/features/tasks/actions";
import { priorityColor, useProjectMap, workMinutes, difficultyColor } from "@/features/tasks/meta";
import { TaskCheck } from "@/features/tasks/TaskCheck";
import { toggleTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, Segmented } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { ContextMenu } from "@/ui/overlay";

type Filter = "open" | "done" | "all";

export function AssignmentsView() {
  const tasks = useWorkspace((s) => s.tasks);
  const [filter, setFilter] = useState<Filter>("open");
  const assignments = useMemo(
    () => tasks.filter((t) => t.type === "assignment").sort((a, b) => a.date.getTime() - b.date.getTime()),
    [tasks],
  );
  const shown = assignments.filter((t) => (filter === "open" ? !t.isDone : filter === "done" ? t.isDone : true));
  const open = assignments.filter((t) => !t.isDone);

  const stats = useMemo(() => {
    const start = today().getTime();
    const weekEnd = addDays(today(), 7).getTime();
    // Overdue ones have their own group; "the next 7 days" starts today.
    const dueSoon = open.filter((t) => t.date.getTime() >= start && t.date.getTime() < weekEnd).length;
    const work = open.reduce((s, t) => s + workMinutes(t), 0);
    const subs = open.flatMap((t) => t.subtasks);
    return { dueSoon, work, subsDone: subs.filter((s) => s.isDone).length, subsTotal: subs.length };
  }, [open]);

  const groups = useMemo(() => {
    const out: { title: string; items: Task[] }[] = [];
    for (const t of shown) {
      const title = isOverdue(t.date, t.isDone) ? "Overdue" : format(t.date, t.date.getFullYear() === today().getFullYear() ? "MMMM" : "MMMM yyyy");
      const last = out[out.length - 1];
      if (last?.title === title) last.items.push(t);
      else out.push({ title, items: [t] });
    }
    return out;
  }, [shown]);

  useEffect(() => {
    ui.set({ visibleOrder: shown.map((t) => t.id) });
  }, [shown]);

  return (
    <>
      <PageHeader
        title="Assignments"
        detail={open.length > 0 ? `${open.length} open` : undefined}
        eyebrow={open.length > 0 ? `${open.length} open` : " "}
        actions={
          <>
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              className="mr-1 max-sm:hidden"
              options={[
                { value: "open", label: "Open" },
                { value: "done", label: "Completed" },
                { value: "all", label: "All" },
              ]}
            />
            <Button variant="primary" className="max-md:hidden" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ type: "assignment", durationMinutes: 120 })}>
              <span className="max-sm:hidden">New assignment</span>
            </Button>
          </>
        }
      />
      <div className="scroll-area flex-1 pb-bar">
        <div className="mx-auto w-full max-w-[820px] px-6 max-md:px-4 max-md:pt-3">
          {open.length > 0 && (
            <div className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-[18px] border border-line bg-card shadow-card">
              <Stat value={String(stats.dueSoon)} label="Due in 7 days" />
              <Stat value={stats.work > 0 ? formatDuration(stats.work) : "—"} label="Work left" />
              <Stat value={stats.subsTotal > 0 ? `${stats.subsDone}/${stats.subsTotal}` : "—"} label="Subtasks done" />
            </div>
          )}
          {shown.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <p className="text-sm font-medium">
                {filter === "done" ? "No completed assignments yet" : "No open assignments"}
              </p>
              <p className="mt-1 text-xs text-ink-3">Assignments collect subtasks, milestones and notes in one place.</p>
              <Button className="mt-4" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ type: "assignment", durationMinutes: 120 })}>
                New assignment
              </Button>
            </div>
          ) : (
            groups.map((group) => (
              <motion.section key={group.title} layout="position" transition={springs.layout} className="mt-6">
                <h2 className="flex items-baseline gap-2 px-1 pb-2.5">
                  <span className={cn("text-[11px] font-semibold tracking-[0.11em] uppercase", group.title === "Overdue" ? "text-danger" : "text-ink-3")}>
                    {group.title}
                  </span>
                  <span className="text-[11px] font-semibold text-ink-3/70 tnum">{group.items.length}</span>
                </h2>
                <AnimatePresence initial={false}>
                  {group.items.map((t) => (
                    <motion.div
                      key={t.id}
                      layout="position"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={springs.layout}
                    >
                      <AssignmentRow task={t} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.section>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3.5 py-2.5">
      <div className={cn("truncate text-[19px] leading-none font-semibold tracking-[-0.02em] tnum", value === "—" && "text-ink-4")}>{value}</div>
      <div className="truncate text-[11.5px] leading-tight text-ink-3">{label}</div>
    </div>
  );
}

function AssignmentRow({ task }: { task: Task }) {
  const navigate = useNavigate();
  const projects = useProjectMap();
  const project = task.projectId ? projects.get(task.projectId) : undefined;
  const done = task.subtasks.filter((s) => s.isDone).length;
  const total = task.subtasks.length;
  const days = daysFromToday(task.date);
  const overdue = isOverdue(task.date, task.isDone);
  const minutes = workMinutes(task);
  return (
    <ContextMenu items={() => taskMenu(task, navigate)}>
      <div
        role="button"
        tabIndex={-1}
        data-task-id={task.id}
        onClick={() => navigate({ view: "assignment", id: task.id })}
        className={cn(
          "group relative mb-2.5 rounded-[22px] border border-line bg-card pt-2.5 pr-[18px] pb-4 pl-1.5 shadow-card transition-[background-color,opacity] hover:bg-[image:linear-gradient(var(--row-hover),var(--row-hover))] md:rounded-card",
          task.isDone && "opacity-70",
        )}
      >
        <div className="flex items-center gap-1">
          <span className="flex size-11 shrink-0 items-center justify-center">
            <TaskCheck
              size={22}
              checked={task.isDone}
              color={task.priority !== "none" ? priorityColor(task.priority) : undefined}
              onToggle={() => toggleTask(task.id)}
            />
          </span>
          <span
            className={cn(
              "line-clamp-2 min-w-0 flex-1 text-[17px] leading-snug font-medium tracking-[-0.01em] break-words [overflow-wrap:anywhere]",
              task.isDone && "text-ink-3 line-through decoration-ink-4",
            )}
          >
            {task.title}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-[10px] px-2.5 py-[5px] text-[12px] font-medium whitespace-nowrap",
              task.isDone
                ? "bg-fill text-ink-3"
                : overdue
                  ? "bg-danger-soft text-danger"
                  : days <= 1
                    ? "bg-accent-soft text-accent"
                    : "bg-fill text-ink-2",
            )}
          >
            {dueLabel(task.date, task.isDone)}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 pl-[50px] text-ink-3">
          <span className="font-mono text-[12px] tnum">{format(task.date, "EEE d MMM")}</span>
          {minutes > 0 && (
            <span className="flex items-center gap-1 font-mono text-[12px]">
              <Timer className="size-3" />
              {formatDuration(minutes)}
            </span>
          )}
          {project && (
            <span className="flex min-w-0 items-center gap-1.5 text-xs">
              <span className="size-[7px] shrink-0 rounded-full" style={{ background: argbToCss(project.colorValue) }} />
              <span className="truncate">{project.title}</span>
            </span>
          )}
          {hasExplicitDifficulty(task) && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="size-[7px] rounded-full" style={{ background: difficultyColor(task.difficulty) }} />
              Level {task.difficulty}
            </span>
          )}
        </div>
        <div className="mt-3.5 flex flex-col gap-2 pl-[50px]">
          <div className="relative h-1 overflow-hidden rounded-full bg-fill-strong">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-accent"
              initial={false}
              animate={{ width: total > 0 ? `${(done / total) * 100}%` : "0%" }}
              transition={springs.panel}
            />
          </div>
          <div className="flex justify-between text-[12px] text-ink-3">
            <span>{total === 0 ? "No subtasks yet" : done === total ? "All subtasks done" : `${total - done} ${total - done === 1 ? "subtask" : "subtasks"} to go`}</span>
            <span className="font-mono tnum">
              {done}/{total}
            </span>
          </div>
        </div>
      </div>
    </ContextMenu>
  );
}

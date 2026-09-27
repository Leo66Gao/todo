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
        <div className="mx-auto w-full max-w-[820px] px-6 max-sm:px-3">
          {open.length > 0 && (
            <div className="card grid grid-cols-3 divide-x divide-line overflow-hidden">
              <Stat value={String(stats.dueSoon)} label="due in the next 7 days" />
              <Stat value={stats.work > 0 ? formatDuration(stats.work) : "—"} label="of work left" />
              <Stat value={stats.subsTotal > 0 ? `${stats.subsDone}/${stats.subsTotal}` : "—"} label="subtasks done" />
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
                <h2 className={cn("px-2 pb-2 text-xs font-semibold", group.title === "Overdue" ? "text-danger" : "text-ink-2")}>
                  {group.title}
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
    <div className="min-w-0 px-4 py-3 max-sm:px-3">
      <div className="truncate text-base font-semibold tnum">{value}</div>
      <div className="text-xs text-ink-3">{label}</div>
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
          "card group relative mb-2.5 flex items-start gap-2 py-3 pr-3.5 pl-2 transition-[background-color,opacity] hover:bg-[image:linear-gradient(var(--row-hover),var(--row-hover))]",
          task.isDone && "opacity-70",
        )}
      >
        {/* The blue edge that marks an assignment everywhere. */}
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1.25px_var(--accent-line)]" />
        <TaskCheck
          checked={task.isDone}
          color={task.priority !== "none" ? priorityColor(task.priority) : undefined}
          onToggle={() => toggleTask(task.id)}
          className="-my-0.5"
        />
        <div className="min-w-0 flex-1 pt-[3px]">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "line-clamp-2 min-w-0 flex-1 text-sm font-semibold break-words [overflow-wrap:anywhere]",
                task.isDone && "text-ink-3 line-through decoration-ink-4",
              )}
            >
              {task.title}
            </span>
            <span
              className={cn(
                "mt-px shrink-0 rounded-full px-2 py-px text-2xs font-medium whitespace-nowrap",
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
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
            <span className="tnum">{format(task.date, "EEE d MMM")}</span>
            {minutes > 0 && (
              <span className="flex items-center gap-1">
                <Timer className="size-3" />
                {formatDuration(minutes)}
              </span>
            )}
            {project && (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-[7px] shrink-0 rounded-full" style={{ background: argbToCss(project.colorValue) }} />
                <span className="truncate">{project.title}</span>
              </span>
            )}
            {total > 0 && (
              <span className="flex items-center gap-2">
                <span className="relative h-[3px] w-12 overflow-hidden rounded-full bg-fill-strong">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${(done / total) * 100}%` }} />
                </span>
                <span className="tnum">
                  {done}/{total}
                </span>
              </span>
            )}
            {hasExplicitDifficulty(task) && (
              <span className="flex items-center gap-1.5">
                <span className="size-[7px] rounded-full" style={{ background: difficultyColor(task.difficulty) }} />
                Level {task.difficulty}
              </span>
            )}
          </div>
        </div>
      </div>
    </ContextMenu>
  );
}

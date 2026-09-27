"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { format } from "date-fns";
import { Check, Plus } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { hasExplicitDifficulty, type Task } from "@/lib/model";
import { addDays, daysFromToday, dueLabel, formatDuration, isOverdue, today } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui } from "@/shell/ui";
import { taskMenu } from "@/features/tasks/actions";
import { useProjectMap, workMinutes } from "@/features/tasks/meta";
import { useWorkspace } from "@/store/workspace";
import { Numeral } from "@/ui/Numeral";
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
      <Numeral value={value} className="truncate text-[22px] leading-none font-semibold tracking-[-0.03em]" />
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
          "group relative mb-2.5 rounded-[22px] border border-line bg-card px-[18px] pt-4 pb-[18px] transition-[background-color,opacity] hover:bg-[image:linear-gradient(var(--row-hover),var(--row-hover))] md:rounded-card",
          task.isDone && "opacity-60",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium text-ink-2">
            {project && (
              <>
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: argbToCss(project.colorValue), boxShadow: `0 0 0 3px color-mix(in srgb, ${argbToCss(project.colorValue)} 16%, transparent)` }}
                />
                <span className="truncate">{project.title}</span>
              </>
            )}
          </span>
          <span
            className={cn(
              "flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold tracking-[-0.005em] whitespace-nowrap",
              task.isDone
                ? "bg-fill text-ink-2"
                : overdue
                  ? "bg-danger-soft text-danger"
                  : days <= 2
                    ? "bg-accent-soft text-accent"
                    : "bg-fill text-ink-2",
            )}
          >
            {task.isDone ? <Check className="size-3.5" strokeWidth={2.4} /> : <span className="size-1.5 rounded-full bg-current" />}
            {task.isDone ? "Done" : dueLabel(task.date)}
          </span>
        </div>
        <h3
          className={cn(
            "mt-2.5 line-clamp-2 text-[18px] leading-snug font-semibold tracking-[-0.015em] break-words [overflow-wrap:anywhere]",
            task.isDone && "text-ink-3",
          )}
        >
          {task.title}
        </h3>
        <p className="mt-1 truncate text-[13px] text-ink-3">
          {[
            `Due ${format(task.date, "EEE d MMM")}`,
            minutes > 0 && !task.isDone ? `${formatDuration(minutes)} of work` : null,
            hasExplicitDifficulty(task) ? `Level ${task.difficulty}` : null,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
        {total > 0 ? (
          <div className="mt-4 flex items-center gap-3">
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fill-strong">
              <motion.div
                className={cn("absolute inset-y-0 left-0 rounded-full", done === total ? "bg-[var(--p-low)]" : "bg-accent")}
                initial={false}
                animate={{ width: `${(done / total) * 100}%` }}
                transition={springs.panel}
              />
            </div>
            <span className="shrink-0 text-[13px] font-semibold text-ink-2 tnum">
              {done}
              <span className="font-medium text-ink-3">/{total}</span>
            </span>
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-ink-3">No subtasks yet</p>
        )}
      </div>
    </ContextMenu>
  );
}

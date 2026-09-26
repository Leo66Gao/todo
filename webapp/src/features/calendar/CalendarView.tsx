"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import type { Project, Task } from "@/lib/model";
import { addDays, dayKey, formatClock, relativeDay, sameDay, startOfWeek, today } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui, useUI } from "@/shell/ui";
import { openTask, taskMenu } from "@/features/tasks/actions";
import { tasksForDay, useAllTasks, useProjectMap } from "@/features/tasks/meta";
import { Section, TaskList } from "@/features/tasks/TaskList";
import type { TaskDragData } from "@/features/tasks/TaskRow";
import { cn } from "@/ui/cn";
import { Button, IconButton } from "@/ui/controls";
import { ContextMenu, Popover } from "@/ui/overlay";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarView() {
  const selected = useUI((s) => s.calendarDay);
  const all = useAllTasks();
  const month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const monthKey = month.getTime();
  const [direction, setDirection] = useState(0);
  const days = useMemo(() => {
    const first = startOfWeek(new Date(monthKey));
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [monthKey]);
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of all) {
      const key = dayKey(t.date);
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    for (const [key, list] of map) {
      const { timed, untimed, done } = tasksForDay(list, list[0].date);
      map.set(key, [...timed, ...untimed, ...done]);
    }
    return map;
  }, [all]);

  const setMonth = (offset: number) => {
    setDirection(offset);
    const target = new Date(selected.getFullYear(), selected.getMonth() + offset, 1);
    ui.set({ calendarDay: target });
  };
  const pick = (d: Date) => {
    if (d.getMonth() !== selected.getMonth()) setDirection(d.getTime() > selected.getTime() ? 1 : -1);
    ui.set({ calendarDay: d });
  };

  return (
    <>
      <PageHeader
        title={<MonthPicker month={month} onPick={(m) => pick(m)} />}
        actions={
          <>
            <div className="mr-1 flex items-center">
              <IconButton label="Previous month" onClick={() => setMonth(-1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <Button variant="ghost" size="sm" disabled={sameDay(selected, today())} onClick={() => pick(today())}>
                Today
              </Button>
              <IconButton label="Next month" onClick={() => setMonth(1)}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
            <Button variant="primary" className="max-md:hidden" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ date: selected })}>
              <span className="max-sm:hidden">New task</span>
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 border-t border-line max-xl:flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col max-xl:min-h-[520px] max-md:min-h-0 max-md:flex-none">
          <div className="grid shrink-0 grid-cols-7 border-b border-line">
            {WEEKDAYS.map((d) => (
              <span key={d} className="px-2.5 py-2 text-2xs font-medium text-ink-3">
                {d}
              </span>
            ))}
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden max-md:h-[300px] max-md:flex-none">
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <motion.div
                key={month.getTime()}
                custom={direction}
                initial={{ opacity: 0, y: direction * 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: direction * -18, transition: { duration: 0.12 } }}
                transition={{ type: "spring", stiffness: 420, damping: 40 }}
                className="grid h-full grid-cols-7 grid-rows-6"
              >
                {days.map((d) => (
                  <MonthCell
                    key={d.getTime()}
                    date={d}
                    inMonth={d.getMonth() === month.getMonth()}
                    selected={sameDay(d, selected)}
                    tasks={byDay.get(dayKey(d)) ?? []}
                    onPick={() => pick(d)}
                  />
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <Agenda day={selected} all={all} />
      </div>
    </>
  );
}

function MonthPicker({ month, onPick }: { month: Date; onPick: (d: Date) => void }) {
  const [year, setYear] = useState(month.getFullYear());
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setYear(month.getFullYear());
      }}
      trigger={
        <button type="button" className="-mx-1.5 flex items-center gap-1.5 rounded-ctl px-1.5 transition-colors hover:bg-fill">
          {format(month, "MMMM")}
          <span className="font-normal text-ink-3 max-sm:hidden">{month.getFullYear()}</span>
          <ChevronDown className="size-4 text-ink-3" />
        </button>
      }
    >
      <div className="w-[248px] p-2">
        <div className="flex items-center justify-between pb-2 pl-2">
          <span className="text-sm font-semibold tnum">{year}</span>
          <div className="flex">
            <IconButton label="Previous year" size="sm" onClick={() => setYear(year - 1)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton label="Next year" size="sm" onClick={() => setYear(year + 1)}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, m) => {
            const current = year === month.getFullYear() && m === month.getMonth();
            const isNow = year === today().getFullYear() && m === today().getMonth();
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onPick(new Date(year, m, 1));
                  setOpen(false);
                }}
                className={cn(
                  "h-8 rounded-[7px] text-sm transition-colors",
                  current ? "bg-ink font-medium text-on-ink" : isNow ? "text-accent hover:bg-fill" : "hover:bg-fill",
                )}
              >
                {format(new Date(year, m, 1), "MMM")}
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

function MonthCell({
  date,
  inMonth,
  selected,
  tasks,
  onPick,
}: {
  date: Date;
  inMonth: boolean;
  selected: boolean;
  tasks: Task[];
  onPick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cal-${date.getTime()}`, data: { type: "day", date } });
  const projects = useProjectMap();
  const lastClick = useRef(0);
  const isToday = sameDay(date, today());
  const visible = tasks.slice(0, 3);
  const more = tasks.length - visible.length;
  return (
    <div
      ref={setNodeRef}
      onClick={() => {
        const now = performance.now();
        if (now - lastClick.current < 320) ui.newTask({ date });
        lastClick.current = now;
        onPick();
      }}
      className={cn(
        "relative flex min-h-0 flex-col gap-px overflow-hidden border-r border-b border-line px-1 pt-1 pb-1 transition-colors duration-100 [&:nth-child(7n)]:border-r-0 max-md:gap-0.5 max-md:border-r-0 max-md:border-b-0 max-md:pt-0.5",
        !inMonth && "bg-fill/35",
        isOver ? "bg-accent-soft" : selected ? "bg-fill/70" : "hover:bg-fill/40",
      )}
    >
      <div className="flex h-6 shrink-0 items-center px-1 max-md:h-8 max-md:justify-center max-md:px-0">
        <span
          className={cn(
            "flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-xs font-medium tnum max-md:size-7 max-md:px-0 max-md:text-sm",
            isToday ? "bg-accent text-white" : selected ? "bg-ink text-on-ink" : inMonth ? "text-ink-2" : "text-ink-4",
          )}
        >
          <span className="max-md:hidden">{date.getDate() === 1 ? format(date, "d MMM") : date.getDate()}</span>
          <span className="md:hidden">{date.getDate()}</span>
        </span>
      </div>
      {/* Phones: a dot per task (up to three); the agenda below lists them. */}
      <div className="flex h-1.5 justify-center gap-[3px] md:hidden">
        {tasks.slice(0, 3).map((t) => (
          <span
            key={t.id}
            className={cn("size-[5px] rounded-full", t.isDone ? "bg-ink-4" : "bg-ink-2")}
            style={t.isDone ? undefined : { background: dotColor(t, projects) }}
          />
        ))}
      </div>
      <div className="contents max-md:hidden">
        {visible.map((t) => (
          <CalendarChip key={t.id} task={t} />
        ))}
        {more > 0 && <span className="px-1.5 text-2xs text-ink-3">{more} more</span>}
      </div>
    </div>
  );
}

function dotColor(task: Task, projects: Map<string, Project>) {
  if (task.type === "assignment") return "var(--accent)";
  const project = task.projectId ? projects.get(task.projectId) : undefined;
  return project ? argbToCss(project.colorValue) : "var(--ink-3)";
}

function CalendarChip({ task }: { task: Task }) {
  const navigate = useNavigate();
  const projects = useProjectMap();
  const project = task.projectId ? projects.get(task.projectId) : undefined;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip-${task.id}`,
    data: { type: "task", task } satisfies TaskDragData,
  });
  return (
    <ContextMenu items={() => taskMenu(task, navigate)}>
      <button
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          ui.set({ calendarDay: task.date });
          openTask(task, navigate);
        }}
        className={cn(
          "flex h-[19px] min-w-0 shrink-0 items-center gap-1.5 rounded-[5px] px-1.5 text-left text-2xs transition-colors hover:bg-fill-strong",
          task.isDone ? "text-ink-3 line-through decoration-ink-4" : "text-ink",
          isDragging && "opacity-40",
        )}
      >
        <span
          className="size-[6px] shrink-0 rounded-full"
          style={{
            background: task.type === "assignment" ? "var(--accent)" : project ? argbToCss(project.colorValue) : "var(--ink-4)",
          }}
        />
        {task.startTime && <span className="shrink-0 text-ink-3 tnum">{formatClock(task.startTime)}</span>}
        <span className="truncate">{task.title}</span>
      </button>
    </ContextMenu>
  );
}

function Agenda({ day, all }: { day: Date; all: Task[] }) {
  const { timed, untimed, done } = useMemo(() => tasksForDay(all, day), [all, day]);
  useEffect(() => {
    ui.set({ visibleOrder: [...timed, ...untimed, ...done].map((t) => t.id) });
  }, [timed, untimed, done]);
  const empty = timed.length + untimed.length + done.length === 0;
  return (
    <aside className="scroll-area w-[320px] shrink-0 border-l border-line px-3 pt-4 pb-10 max-xl:w-full max-xl:border-t max-xl:border-l-0">
      <div className="flex items-baseline justify-between px-2 pb-3">
        <h2 className="text-base font-semibold">{relativeDay(day)}</h2>
        <span className="text-xs text-ink-3">{format(day, "d MMMM")}</span>
      </div>
      {empty ? (
        <p className="px-2 py-6 text-sm text-ink-3">Nothing planned.</p>
      ) : (
        <>
          {timed.length > 0 && (
            <Section title="Scheduled" count={timed.length}>
              <TaskList tasks={timed} />
            </Section>
          )}
          {untimed.length > 0 && (
            <Section title="Tasks" count={untimed.length}>
              <TaskList tasks={untimed} sortable id="calendar-untimed" />
            </Section>
          )}
          {done.length > 0 && (
            <Section
              key={day.getTime()}
              title="Completed"
              count={done.length}
              collapsible
              defaultOpen={day.getTime() < today().getTime()}
            >
              <TaskList tasks={done} />
            </Section>
          )}
        </>
      )}
      <button
        type="button"
        onClick={() => ui.newTask({ date: day })}
        className="mt-2 flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-sm text-ink-3 transition-colors hover:bg-fill/70 hover:text-ink-2"
      >
        <Plus className="size-4" />
        Add a task
      </button>
    </aside>
  );
}

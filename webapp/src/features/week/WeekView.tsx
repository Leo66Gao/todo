"use client";

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useGlass, useMergedRefs } from "@/glass/registry";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, CornerDownRight, GraduationCap, Plus } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import type { Task } from "@/lib/model";
import { addDays, formatClock, formatDuration, sameDay, startOfWeek, today } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui, useUI } from "@/shell/ui";
import { openTask, taskMenu } from "@/features/tasks/actions";
import { priorityColor, tasksForDay, useAllTasks, useProjectMap, workMinutes } from "@/features/tasks/meta";
import { TaskCheck } from "@/features/tasks/TaskCheck";
import type { TaskDragData } from "@/features/tasks/TaskRow";
import { toggleTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { ContextMenu } from "@/ui/overlay";
import { eventsOnDay, useEvents, type GEvent } from "@/lib/googleEvents";
import { EventRow } from "@/features/events/EventSheet";

function weekTitle(start: Date) {
  const diff = Math.round((start.getTime() - startOfWeek(today()).getTime()) / (7 * 864e5));
  if (diff === 0) return "This week";
  if (diff === 1) return "Next week";
  if (diff === -1) return "Last week";
  return `Week of ${format(start, "d MMM")}`;
}

export function WeekView() {
  const weekOf = useUI((s) => s.weekOf);
  const startKey = startOfWeek(weekOf).getTime();
  const all = useAllTasks();
  const columns = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => addDays(new Date(startKey), i)).map((d) => {
        const { timed, untimed, done } = tasksForDay(all, d);
        return { date: d, tasks: [...timed, ...untimed, ...done] };
      }),
    [all, startKey],
  );
  const events = useEvents(new Date(startKey), addDays(new Date(startKey), 7));
  const stats = useMemo(() => {
    const list = columns.flatMap((c) => c.tasks);
    const done = list.filter((t) => t.isDone).length;
    const planned = list.filter((t) => !t.isDone).reduce((s, t) => s + workMinutes(t), 0);
    return { total: list.length, done, open: list.length - done, planned };
  }, [columns]);

  useEffect(() => {
    ui.set({ visibleOrder: columns.flatMap((c) => c.tasks.map((t) => t.id)) });
  }, [columns]);

  const start = new Date(startKey);
  const end = addDays(start, 6);
  return (
    <>
      <PageHeader
        title={weekTitle(start)}
        detail={`${format(start, "d MMM")} – ${format(end, start.getMonth() === end.getMonth() ? "d" : "d MMM")}${start.getMonth() === end.getMonth() ? format(end, " MMMM") : ""}`}
        actions={
          <>
            <div className="mr-1 flex items-center">
              <IconButton label="Previous week" onClick={() => ui.set({ weekOf: addDays(start, -7) })}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <Button variant="ghost" size="sm" disabled={sameDay(start, startOfWeek(today()))} onClick={() => ui.set({ weekOf: today() })}>
                This week
              </Button>
              <IconButton label="Next week" onClick={() => ui.set({ weekOf: addDays(start, 7) })}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
            <Button variant="primary" className="max-md:hidden" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ date: sameDay(start, startOfWeek(today())) ? today() : start })}>
              <span className="max-sm:hidden">New task</span>
            </Button>
          </>
        }
      />
      <div className="flex items-center gap-5 px-6 pb-3 text-xs whitespace-nowrap text-ink-3 max-sm:gap-4 max-sm:px-4">
        <span>
          <span className="font-semibold text-ink tnum">{stats.open}</span> open
        </span>
        {stats.planned > 0 && (
          <span>
            <span className="font-semibold text-ink tnum">{formatDuration(stats.planned)}</span> planned
          </span>
        )}
        {stats.total > 0 && (
          <span className="ml-auto flex items-center gap-2.5">
            <span className="relative h-1 w-24 overflow-hidden rounded-full bg-fill-strong max-sm:w-12">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full bg-ink"
                initial={false}
                animate={{ width: `${(stats.done / stats.total) * 100}%` }}
                transition={springs.panel}
              />
            </span>
            <span className="tnum">
              {stats.done} of {stats.total} done
            </span>
          </span>
        )}
      </div>
      <div className="scroll-area flex min-h-0 flex-1 gap-2 px-4 pt-1 pb-4 max-md:flex-col max-md:gap-2.5 max-md:overflow-y-auto max-md:px-3 max-md:pb-bar">
        {columns.map((col) => (
          <DayColumn key={col.date.getTime()} date={col.date} tasks={col.tasks} events={events} />
        ))}
      </div>
    </>
  );
}

function DayColumn({ date, tasks, events }: { date: Date; tasks: Task[]; events: GEvent[] }) {
  const dayEvents = useMemo(() => {
    const { allDay, timed } = eventsOnDay(events, date);
    return [...allDay, ...timed];
  }, [events, date]);
  const { setNodeRef, isOver } = useDroppable({ id: `week-${date.getTime()}`, data: { type: "day", date } });
  const isToday = sameDay(date, today());
  const open = tasks.filter((t) => !t.isDone).length;
  const past = date.getTime() < today().getTime();
  const sortableIds = tasks.filter((t) => !t.milestone && !t.isDone && !t.startTime).map((t) => t.id);
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "card group/col flex min-w-[124px] flex-1 flex-col transition-[outline-color] duration-150 max-md:flex-none",
        // Today, and a day a task is dragged over, get a blue edge.
        (isOver || isToday) && "outline -outline-offset-[1.25px] outline-[1.25px]",
        isOver ? "outline-accent" : isToday && "outline-accent-line",
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-1.5 px-3 pt-0.5">
        <span className={cn("text-xs font-medium", isToday ? "text-accent" : past ? "text-ink-3" : "text-ink-2")}>
          {format(date, "EEE")}
        </span>
        <span
          className={cn(
            "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-semibold tnum",
            isToday ? "bg-accent text-white" : past ? "text-ink-3" : "text-ink",
          )}
        >
          {date.getDate()}
        </span>
        {open > 0 && <span className="ml-auto text-2xs text-ink-3 tnum">{open}</span>}
      </header>
      <div className="scroll-area flex-1 px-1.5 pb-2 max-md:flex-none max-md:overflow-visible">
        {dayEvents.length > 0 && (
          <div className="mb-1 space-y-px">
            {dayEvents.map((e) => (
              <EventRow key={e.key} event={e} compact />
            ))}
          </div>
        )}
        <SortableContext id={`week-${date.getTime()}`} items={sortableIds} strategy={verticalListSortingStrategy}>
          <AnimatePresence initial={false}>
            {tasks.map((task) => (
              <motion.div
                key={task.id}
                layout="position"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
                transition={springs.layout}
              >
                <WeekCard task={task} sortable={sortableIds.includes(task.id)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </SortableContext>
        <button
          type="button"
          onClick={() => ui.newTask({ date })}
          className="mt-0.5 flex h-8 w-full items-center gap-1.5 rounded-[8px] px-2 text-xs text-ink-3 opacity-0 transition-[opacity,background-color] group-hover/col:opacity-100 hover:bg-fill hover:text-ink-2 focus-visible:opacity-100 max-md:opacity-100"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>
    </section>
  );
}

function WeekCard({ task, sortable }: { task: Task; sortable: boolean }) {
  const navigate = useNavigate();
  const projects = useProjectMap();
  const selected = useUI((s) => s.selectedId === task.id || s.inspectorId === task.id);
  const showPriority = useWorkspace((s) => s.settings.showPriority);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", task } satisfies TaskDragData,
    disabled: { draggable: false, droppable: !sortable },
  });
  const project = task.projectId ? projects.get(task.projectId) : undefined;
  const cardGlass = useGlass<HTMLDivElement>({ level: 2, kind: "card", interactive: true, inScroll: true });
  const cardRef = useMergedRefs(setNodeRef, cardGlass);
  return (
    <div
      ref={cardRef}
      style={{ transform: sortable ? CSS.Translate.toString(transform) : undefined, transition }}
      data-task-card={task.isDone ? "done" : ""}
      className={cn(isDragging && "opacity-40")}
    >
      <ContextMenu items={() => taskMenu(task, navigate)}>
        <div
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={-1}
          data-task-id={task.id}
          onClick={() => {
            ui.select(task.id);
            openTask(task, navigate);
          }}
          onDoubleClick={() => !task.milestone && ui.editTask(task.id)}
          className={cn(
            "mb-1 flex gap-1 rounded-[calc(var(--radius-ctl)_+_1px)] py-1.5 pr-2 pl-0.5 transition-colors duration-100",
            selected ? "bg-accent-soft" : "hover:bg-fill",
          )}
        >
          <TaskCheck
            size={15}
            checked={task.isDone}
            color={showPriority && task.priority !== "none" ? priorityColor(task.priority) : undefined}
            onToggle={() => toggleTask(task.id)}
            className="-mt-[3px]"
          />
          <div className="min-w-0 flex-1">
            <p className={cn("line-clamp-2 text-xs leading-[17px] font-medium", task.isDone ? "text-ink-3 line-through decoration-ink-4" : "text-ink")}>
              {task.title}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-ink-3">
              {task.startTime && <span className="tnum">{formatClock(task.startTime)}</span>}
              {task.type === "assignment" && <GraduationCap className="size-3 text-accent" />}
              {task.parentTaskId && <CornerDownRight className="size-3" />}
              {project && (
                <span className="flex min-w-0 items-center gap-1">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: argbToCss(project.colorValue) }} />
                  <span className="truncate">{project.title}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </ContextMenu>
    </div>
  );
}

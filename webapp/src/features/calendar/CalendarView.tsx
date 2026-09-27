"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import type { Project, Task } from "@/lib/model";
import { addDays, dayKey, daysFromToday, formatClock, relativeDay, sameDay, startOfWeek, today } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui, useUI } from "@/shell/ui";
import { openTask, taskMenu } from "@/features/tasks/actions";
import { tasksForDay, useAllTasks, useProjectMap } from "@/features/tasks/meta";
import { Section, TaskList } from "@/features/tasks/TaskList";
import type { TaskDragData } from "@/features/tasks/TaskRow";
import { cn } from "@/ui/cn";
import { Button, IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { ContextMenu, Popover } from "@/ui/overlay";
import { useMedia } from "@/ui/useMedia";
import { eventsOnDay, useEvents, type GEvent } from "@/lib/googleEvents";
import { EventRow, openEvent } from "@/features/events/EventSheet";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Phone layout: a compact month of dots over the selected day's agenda. */
const PHONE = "(max-width: 767px)";

/** Weeks the month spans (4 to 6); only those rows are drawn. */
function weeksIn(month: Date) {
  const first = startOfWeek(month);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return Math.round((startOfWeek(last).getTime() - first.getTime()) / (7 * 864e5)) + 1;
}

export function CalendarView() {
  const selected = useUI((s) => s.calendarDay);
  const all = useAllTasks();
  const phone = useMedia(PHONE);
  const month = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const monthKey = month.getTime();
  const [direction, setDirection] = useState(0);
  // Phones: tapping the selected day again opens it on its own (the month
  // folds away and the arrows step by day), as in the original app.
  const [dayOnly, setDayOnly] = useState(false);
  const weeks = weeksIn(month);
  const days = useMemo(() => {
    const first = startOfWeek(new Date(monthKey));
    return Array.from({ length: weeksIn(new Date(monthKey)) * 7 }, (_, i) => addDays(first, i));
  }, [monthKey]);
  const events = useEvents(days[0], addDays(days[0], days.length));
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

  const pick = (d: Date) => {
    if (d.getMonth() !== selected.getMonth() || d.getFullYear() !== selected.getFullYear()) {
      setDirection(d.getTime() > selected.getTime() ? 1 : -1);
    }
    ui.set({ calendarDay: d });
  };
  const setMonth = (offset: number) => {
    setDirection(offset);
    const target = new Date(selected.getFullYear(), selected.getMonth() + offset, 1);
    // Landing on this month selects today rather than the 1st.
    ui.set({ calendarDay: sameDay(startOfMonth(today()), target) ? today() : target });
  };
  const step = (offset: number) => (dayOnly && phone ? pick(addDays(selected, offset)) : setMonth(offset));
  const tapDay = (d: Date, touch: boolean) => {
    if (touch && phone && sameDay(d, selected)) {
      setDayOnly((v) => !v);
      return;
    }
    setDayOnly(false);
    pick(d);
  };

  const showDayOnly = dayOnly && phone;
  const isToday = sameDay(selected, today());
  const prevLabel = showDayOnly ? "Previous day" : "Previous month";
  const nextLabel = showDayOnly ? "Next day" : "Next month";

  return (
    <>
      <PageHeader
        title={<MonthPicker month={month} onPick={(m) => pick(sameDay(startOfMonth(today()), m) ? today() : m)} />}
        actions={
          <>
            <div className="mr-1 flex items-center">
              <IconButton label={prevLabel} onClick={() => step(-1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <Button
                variant="ghost"
                size="sm"
                disabled={isToday}
                onClick={() => {
                  setDayOnly(false);
                  pick(today());
                }}
              >
                Today
              </Button>
              <IconButton label={nextLabel} onClick={() => step(1)}>
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
            <Button variant="primary" className="max-md:hidden" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ date: selected })}>
              <span className="max-sm:hidden">New task</span>
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4 max-xl:flex-col max-md:gap-0 max-md:px-3 max-md:pb-0">
        <AnimatePresence initial={false}>
          {!showDayOnly && (
            <motion.div
              key="month"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.panel}
              className="flex min-h-0 min-w-0 flex-col md:!h-auto md:flex-1 max-xl:md:min-h-[480px] max-md:shrink-0 max-md:overflow-hidden"
            >
              <MonthCard
                month={month}
                days={days}
                weeks={weeks}
                direction={direction}
                selected={selected}
                byDay={byDay}
                events={events}
                phone={phone}
                onTap={tapDay}
                onSwipe={(dir) => setMonth(dir)}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <Agenda
          day={selected}
          all={all}
          events={events}
          dayOnly={showDayOnly}
          onShowMonth={() => setDayOnly(false)}
        />
      </div>
    </>
  );
}

/** "In 12 days", "3 days ago" (with the year when it isn't this one). */
function distance(day: Date) {
  const n = daysFromToday(day);
  const text = n > 0 ? `In ${n} days` : `${-n} days ago`;
  return day.getFullYear() === today().getFullYear() ? text : `${text}, ${day.getFullYear()}`;
}

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

function MonthCard({
  month,
  days,
  weeks,
  direction,
  selected,
  byDay,
  events,
  phone,
  onTap,
  onSwipe,
}: {
  month: Date;
  days: Date[];
  weeks: number;
  direction: number;
  selected: Date;
  byDay: Map<string, Task[]>;
  events: GEvent[];
  phone: boolean;
  onTap: (d: Date, touch: boolean) => void;
  onSwipe: (dir: 1 | -1) => void;
}) {
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (Math.abs(offset.x) < Math.abs(offset.y)) return;
    if (offset.x < -56 || velocity.x < -450) onSwipe(1);
    else if (offset.x > 56 || velocity.x > 450) onSwipe(-1);
  };
  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden p-2 max-md:p-1.5">
      <div className="grid shrink-0 grid-cols-7 pb-1">
        {WEEKDAYS.map((d) => (
          <span
            key={d}
            className="py-1.5 text-2xs font-medium text-ink-3 max-md:text-center md:px-2.5"
          >
            {d}
          </span>
        ))}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={month.getTime()}
            custom={direction}
            initial={{ opacity: 0, x: direction * 48 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -48, transition: { duration: 0.14 } }}
            transition={springs.layout}
            // Phones switch months with a sideways swipe.
            drag={phone ? "x" : false}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.22}
            dragSnapToOrigin
            onDragEnd={onDragEnd}
            className={cn("grid h-full grid-cols-7 gap-1 max-md:gap-[3px]", phone && "touch-pan-y")}
            style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
          >
            {days.map((d) => (
              <MonthCell
                key={d.getTime()}
                date={d}
                inMonth={d.getMonth() === month.getMonth()}
                selected={sameDay(d, selected)}
                tasks={byDay.get(dayKey(d)) ?? []}
                events={events}
                phone={phone}
                onTap={(touch) => onTap(d, touch)}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function MonthPicker({ month, onPick }: { month: Date; onPick: (d: Date) => void }) {
  const [year, setYear] = useState(month.getFullYear());
  const [open, setOpen] = useState(false);
  const now = today();
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setYear(month.getFullYear());
      }}
      trigger={
        <button type="button" className="-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-ctl px-1.5 transition-colors hover:bg-fill">
          <span className="truncate">{format(month, "MMMM")}</span>
          {month.getFullYear() !== now.getFullYear() && <span className="font-normal text-ink-3">{month.getFullYear()}</span>}
          <ChevronDown className="size-4 shrink-0 text-ink-3" />
        </button>
      }
    >
      <div className="w-[264px] p-2.5">
        <div className="flex items-center justify-between pb-2 pl-1.5">
          <div className="flex items-center">
            <IconButton label="Previous year" size="sm" onClick={() => setYear(year - 1)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span className="w-12 text-center text-sm font-semibold tnum">{year}</span>
            <IconButton label="Next year" size="sm" onClick={() => setYear(year + 1)}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              onPick(startOfMonth(now));
              setOpen(false);
            }}
          >
            This month
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 12 }, (_, m) => {
            const current = year === month.getFullYear() && m === month.getMonth();
            const isNow = year === now.getFullYear() && m === now.getMonth();
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onPick(new Date(year, m, 1));
                  setOpen(false);
                }}
                className={cn(
                  "h-9 rounded-ctl text-sm transition-[background-color,transform] active:scale-[0.96]",
                  current ? "bg-ink font-medium text-on-ink" : isNow ? "bg-fill font-medium text-accent" : "bg-fill/60 hover:bg-fill",
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
  events,
  phone,
  onTap,
}: {
  date: Date;
  inMonth: boolean;
  selected: boolean;
  tasks: Task[];
  events: GEvent[];
  phone: boolean;
  onTap: (touch: boolean) => void;
}) {
  const dayEvents = useMemo(() => {
    const { allDay, timed } = eventsOnDay(events, date);
    return [...allDay, ...timed];
  }, [events, date]);
  const { setNodeRef, isOver } = useDroppable({ id: `cal-${date.getTime()}`, data: { type: "day", date } });
  const projects = useProjectMap();
  const lastClick = useRef(0);
  const pointer = useRef<string>("mouse");
  const isToday = sameDay(date, today());
  const weekend = date.getDay() === 0 || date.getDay() === 6;

  const onClick = () => {
    const touch = pointer.current === "touch";
    const now = performance.now();
    // A double click (mouse) creates a task on that day.
    if (!touch && now - lastClick.current < 320) ui.newTask({ date });
    lastClick.current = now;
    onTap(touch);
  };

  if (phone) {
    // Up to three dots: events, then open tasks. Milestones are rings.
    const open = tasks.filter((t) => !t.isDone);
    const dots = [
      ...dayEvents.slice(0, 3).map((e) => ({ key: e.key, color: e.color, ring: false })),
      ...open.slice(0, Math.max(0, 3 - dayEvents.length)).map((t) => ({ key: t.id, color: dotColor(t, projects), ring: t.parentTaskId != null })),
    ];
    return (
      <button
        ref={setNodeRef}
        type="button"
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={onClick}
        aria-label={format(date, "EEEE d MMMM")}
        aria-pressed={selected}
        className={cn(
          "relative flex min-h-[42px] flex-col items-center justify-center gap-[5px] rounded-[12px] transition-[background-color,transform] duration-150 active:scale-[0.94]",
          !inMonth && "opacity-45",
          selected
            ? isToday
              ? "bg-accent text-white"
              : "bg-ink text-on-ink"
            : isOver
              ? "bg-accent-soft"
              : inMonth
                ? "bg-fill/55"
                : "",
          isToday && !selected && "shadow-[inset_0_0_0_1.5px_var(--accent)]",
        )}
      >
        <span
          className={cn(
            "text-sm leading-none tnum",
            selected ? "font-semibold" : isToday ? "font-semibold text-accent" : weekend ? "text-ink-2" : "text-ink",
          )}
        >
          {date.getDate()}
        </span>
        <span className="flex h-[5px] items-center gap-[3px]">
          {dots.map((d) => (
            <span
              key={d.key}
              className="size-[5px] rounded-full"
              style={
                d.ring
                  ? { boxShadow: `inset 0 0 0 1.3px ${selected ? lighten(d.color) : d.color}` }
                  : { background: selected ? lighten(d.color) : d.color }
              }
            />
          ))}
        </span>
      </button>
    );
  }

  // Wide screens: events and tasks as chips, as many as fit.
  const shownEvents = dayEvents.slice(0, 3);
  const visible = tasks.slice(0, Math.max(0, 4 - shownEvents.length));
  const more = tasks.length + dayEvents.length - visible.length - shownEvents.length;
  return (
    <div
      ref={setNodeRef}
      onPointerDown={(e) => (pointer.current = e.pointerType)}
      onClick={onClick}
      className={cn(
        "relative flex min-h-0 flex-col gap-px overflow-hidden rounded-[12px] px-1 pt-1 pb-1 transition-[background-color,box-shadow] duration-150",
        isOver
          ? "bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--accent)]"
          : selected
            ? "bg-card shadow-[inset_0_0_0_1.5px_var(--ink)]"
            : inMonth
              ? "bg-fill/45 hover:bg-fill"
              : "hover:bg-fill/45",
      )}
    >
      <div className="flex h-6 shrink-0 items-center px-0.5">
        <span
          className={cn(
            "flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-xs font-medium tnum",
            isToday ? "bg-accent text-white" : selected ? "text-ink" : inMonth ? (weekend ? "text-ink-3" : "text-ink-2") : "text-ink-4",
          )}
        >
          {date.getDate() === 1 ? format(date, "d MMM") : date.getDate()}
        </span>
      </div>
      <div className={cn("flex min-h-0 flex-col gap-px", !inMonth && "opacity-60")}>
        {shownEvents.map((e) => (
          <button
            key={e.key}
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              openEvent(e);
            }}
            className="flex h-[19px] min-w-0 shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-left text-2xs transition-colors hover:brightness-95"
            style={{ background: `color-mix(in srgb, ${e.color} 16%, var(--card))` }}
          >
            {!e.allDay && <span className="shrink-0 text-ink-3 tnum">{formatClock(e.start)}</span>}
            <span className="truncate">{e.title}</span>
          </button>
        ))}
        {visible.map((t) => (
          <CalendarChip key={t.id} task={t} />
        ))}
        {more > 0 && <span className="truncate px-1.5 text-2xs text-ink-3">{more} more</span>}
      </div>
    </div>
  );
}

/** A task's dot: its subject's colour, else blue for assignments and grey for the rest. */
function dotColor(task: Task, projects: Map<string, Project>) {
  const project = task.projectId ? projects.get(task.projectId) : undefined;
  if (project) return argbToCss(project.colorValue);
  return task.type === "assignment" || task.parentTaskId ? "var(--accent)" : "var(--ink-3)";
}
/** Keeps a dot readable on the selected (ink) day. */
const lighten = (color: string) => `color-mix(in srgb, ${color} 62%, white)`;

function CalendarChip({ task }: { task: Task }) {
  const navigate = useNavigate();
  const projects = useProjectMap();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `chip-${task.id}`,
    data: { type: "task", task } satisfies TaskDragData,
  });
  const isAssignment = task.type === "assignment";
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
          "flex h-[19px] min-w-0 shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-left text-2xs transition-colors hover:bg-fill-strong",
          task.isDone ? "text-ink-3 line-through decoration-ink-4" : "text-ink",
          isAssignment && !task.isDone && "bg-accent-soft font-medium",
          isDragging && "opacity-40",
        )}
      >
        <span
          className="size-[6px] shrink-0 rounded-full"
          style={task.parentTaskId ? { boxShadow: `inset 0 0 0 1.3px ${dotColor(task, projects)}` } : { background: task.isDone ? "var(--ink-4)" : dotColor(task, projects) }}
        />
        {task.startTime && <span className="shrink-0 text-ink-3 tnum">{formatClock(task.startTime)}</span>}
        <span className="truncate">{task.title}</span>
      </button>
    </ContextMenu>
  );
}

function Agenda({
  day,
  all,
  events,
  dayOnly,
  onShowMonth,
}: {
  day: Date;
  all: Task[];
  events: GEvent[];
  dayOnly: boolean;
  onShowMonth: () => void;
}) {
  const { timed, untimed, done } = useMemo(() => tasksForDay(all, day), [all, day]);
  const dayEvents = useMemo(() => {
    const { allDay, timed: timedEvents } = eventsOnDay(events, day);
    return [...allDay, ...timedEvents];
  }, [events, day]);
  useEffect(() => {
    ui.set({ visibleOrder: [...timed, ...untimed, ...done].map((t) => t.id) });
  }, [timed, untimed, done]);
  const empty = timed.length + untimed.length + done.length + dayEvents.length === 0;
  const isToday = sameDay(day, today());
  const relative = relativeDay(day);
  const near = relative === "Today" || relative === "Tomorrow" || relative === "Yesterday";
  return (
    <aside className="scroll-area min-h-0 w-[340px] shrink-0 max-xl:w-full max-xl:flex-1 max-md:pb-bar">
      <div className="flex min-w-0 items-center gap-3 px-2 pt-2 pb-2.5 max-md:pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{near ? relative : format(day, "EEEE d MMMM")}</h2>
          <p className="truncate text-xs text-ink-3">{near ? format(day, "EEEE d MMMM") : distance(day)}</p>
        </div>
        {dayOnly && (
          <Button size="sm" variant="secondary" icon={<CalendarDays className="size-3.5" />} onClick={onShowMonth}>
            Month
          </Button>
        )}
      </div>
      {/* The day's contents slide in when another day is picked. */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={day.getTime()}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={springs.layout}
        >
          {empty ? (
            <div className="card flex flex-col items-center px-4 py-8 text-center">
              <p className="text-sm text-ink-2">{isToday ? "Nothing planned for today" : `Nothing on ${format(day, "d MMM")}`}</p>
              <Button className="mt-3" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ date: day })}>
                Add a task
              </Button>
            </div>
          ) : (
            <>
              {dayEvents.length > 0 && (
                <Section title="Calendar" count={dayEvents.length}>
                  <div className="card mb-2 space-y-px p-1">
                    {dayEvents.map((e) => (
                      <EventRow key={e.key} event={e} />
                    ))}
                  </div>
                </Section>
              )}
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
              <button
                type="button"
                onClick={() => ui.newTask({ date: day })}
                className="mt-1 flex h-11 w-full items-center gap-2.5 rounded-card px-3.5 text-sm text-ink-3 transition-colors hover:bg-card hover:text-ink-2"
              >
                <Plus className="size-4" />
                Add a task
              </button>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

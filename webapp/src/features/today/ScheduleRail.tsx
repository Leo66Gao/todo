"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useDroppable } from "@dnd-kit/core";
import { argbToCss } from "@/lib/dart";
import type { Task } from "@/lib/model";
import { formatClock, sameDay } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { ui, useUI } from "@/shell/ui";
import { openTask, taskMenu } from "@/features/tasks/actions";
import { useProjectMap } from "@/features/tasks/meta";
import { patchTask } from "@/store/workspace";
import { useGlass, useMergedRefs } from "@/glass/registry";
import { cn } from "@/ui/cn";
import { springs } from "@/ui/motion";
import { ContextMenu } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { eventsOnDay, updateEvent, type GEvent } from "@/lib/googleEvents";
import { openEvent } from "@/features/events/EventSheet";

const HOUR = 44;
const SNAP = 15;
const MIN_BLOCK = 30;

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** A task dropped on the schedule: a time slot on a day. */
export interface SlotDropData {
  type: "slot";
  day: Date;
  /** The snapped start (minutes after midnight) for a pointer position. */
  minutesAt: (clientY: number, duration: number) => number;
}
const atMinutes = (day: Date, m: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);

type Item = { kind: "task"; task: Task } | { kind: "event"; event: GEvent };
type Placed = { item: Item; start: number; end: number; lane: number; lanes: number };

/** Greedy lane assignment so overlapping blocks sit side by side. */
function place(tasks: Task[], events: GEvent[], day: Date): Placed[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const items: Placed[] = [
    ...tasks.map((task) => {
      const start = minutesOf(task.startTime!);
      return { item: { kind: "task" as const, task }, start, end: start + Math.max(MIN_BLOCK, task.durationMinutes), lane: 0, lanes: 1 };
    }),
    ...events.map((event) => {
      // An event running over midnight shows the part on this day.
      const start = Math.max(0, Math.round((event.start.getTime() - dayStart) / 60000));
      const end = Math.min(24 * 60, Math.round((event.end.getTime() - dayStart) / 60000));
      return { item: { kind: "event" as const, event }, start, end: Math.max(end, start + MIN_BLOCK), lane: 0, lanes: 1 };
    }),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  let group: Placed[] = [];
  let groupEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((p) => p.lane + 1));
    for (const p of group) p.lanes = lanes;
    group = [];
  };
  for (const item of items) {
    if (item.start >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    const used = new Set(group.filter((p) => p.end > item.start).map((p) => p.lane));
    while (used.has(item.lane)) item.lane++;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();
  return items;
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The day on a timeline. Timed tasks appear as blocks sized by their
 * duration; drag a block to move it, or click an empty slot to plan a task
 * at that time.
 */
export function ScheduleRail({ day, tasks, events = [] }: { day: Date; tasks: Task[]; events?: GEvent[] }) {
  const now = useNow();
  const isToday = sameDay(day, now);
  const timed = useMemo(() => tasks.filter((t) => t.startTime && sameDay(t.date, day)), [tasks, day]);
  const timedEvents = useMemo(() => eventsOnDay(events, day).timed, [events, day]);
  const placed = useMemo(() => place(timed, timedEvents, day), [timed, timedEvents, day]);

  const first = Math.min(8, ...(isToday ? [now.getHours()] : []), ...placed.map((p) => Math.floor(p.start / 60)));
  const nowHour = isToday ? Math.ceil((minutesOf(now) + 1) / 60) : 0;
  const last = Math.min(24, Math.max(22, nowHour, ...placed.map((p) => Math.ceil(p.end / 60))));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const top = (m: number) => ((m - first * 60) / 60) * HOUR;

  const scroller = useRef<HTMLDivElement>(null);
  // The schedule sits on its own plate of glass (it scrolls inside it).
  const plate = useGlass<HTMLDivElement>({ level: 2, kind: "plate", inScroll: true });
  const scrollerRef = useMergedRefs(scroller, plate);
  const dayKey = day.getTime();
  useEffect(() => {
    // Bring the current hour (or the first block) into view when the day changes.
    const el = scroller.current;
    if (!el) return;
    const focus = isToday ? minutesOf(new Date()) - 60 : (placed[0]?.start ?? 9 * 60) - 30;
    el.scrollTo({ top: Math.max(0, ((focus - first * 60) / 60) * HOUR) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  const [hover, setHover] = useState<number | null>(null);
  const timeline = useRef<HTMLDivElement | null>(null);
  const { setNodeRef: dropRef } = useDroppable({
    id: `rail-${dayKey}`,
    data: {
      type: "slot",
      day,
      minutesAt: (clientY: number, duration: number) => {
        const rect = timeline.current?.getBoundingClientRect();
        if (!rect) return first * 60;
        // The block is held by its top third, so it lands where it's drawn.
        const m = first * 60 + ((clientY - rect.top) / HOUR) * 60 - Math.min(duration, 60) / 3;
        return Math.max(first * 60, Math.min(last * 60 - Math.max(MIN_BLOCK, duration), Math.round(m / SNAP) * SNAP));
      },
    } satisfies SlotDropData,
  });
  const dropSlot = useUI((s) => (s.dropSlot?.day === dayKey ? s.dropSlot : null));
  const slotAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = first * 60 + ((e.clientY - rect.top) / HOUR) * 60;
    return Math.max(first * 60, Math.min(last * 60 - 30, Math.floor(m / 30) * 30));
  };

  return (
    <aside className="flex min-h-0 w-[280px] shrink-0 flex-col">
      <div className="flex h-7 items-center px-2">
        <span className="text-xs font-semibold text-ink-2">Schedule</span>
      </div>
      <div ref={scrollerRef} className="card scroll-area relative mt-1 min-h-0 flex-1">
        <div
          ref={(el) => {
            timeline.current = el;
            dropRef(el);
          }}
          className="relative my-3"
          style={{ height: hours.length * HOUR }}
        >
          {hours.map((h) => (
            <div key={h} className="absolute inset-x-0 flex items-start" style={{ top: (h - first) * HOUR }}>
              <span
                className={cn(
                  "w-12 -translate-y-1/2 pr-2 text-right text-2xs text-ink-3 tnum transition-opacity duration-300",
                  // Make room for the current-time label (a label's height is ~20 min).
                  isToday && Math.abs(h * 60 - minutesOf(now)) < 20 && "opacity-0",
                )}
              >
                {h === 24 ? "" : `${String(h).padStart(2, "0")}.00`}
              </span>
              <span className="mr-3 h-px flex-1 bg-line" />
            </div>
          ))}

          <div
            className="absolute inset-y-0 right-3 left-12"
            onPointerMove={(e) => e.target === e.currentTarget && setHover(slotAt(e))}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              if (e.target !== e.currentTarget) return;
              ui.newTask({ date: day, startTime: atMinutes(day, slotAt(e)) });
            }}
          >
            <AnimatePresence>
              {dropSlot && (
                <motion.div
                  key="drop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, top: top(dropSlot.minutes) + 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={springs.snappy}
                  className="pointer-events-none absolute inset-x-1 z-20 flex items-start rounded-[7px] border border-dashed border-accent bg-[color-mix(in_srgb,var(--accent)_12%,var(--raised))] px-2 py-1 text-2xs font-medium text-accent tnum"
                  style={{ height: (Math.max(MIN_BLOCK, dropSlot.duration) / 60) * HOUR - 2 }}
                >
                  {formatClock(atMinutes(day, dropSlot.minutes))}–{formatClock(atMinutes(day, dropSlot.minutes + Math.max(dropSlot.duration, SNAP)))}
                </motion.div>
              )}
            </AnimatePresence>
            {hover != null && !dropSlot && (
              <div
                className="pointer-events-none absolute inset-x-1 flex items-center rounded-[7px] border border-dashed border-line-strong px-2 text-2xs text-ink-3"
                style={{ top: top(hover) + 1, height: HOUR / 2 - 2 }}
              >
                New task at {formatClock(atMinutes(day, hover))}
              </div>
            )}
            {placed.map((p) =>
              p.item.kind === "task" ? (
                <Block key={p.item.task.id} placed={p} task={p.item.task} top={top} bounds={[first * 60, last * 60]} />
              ) : (
                <EventBlock key={p.item.event.key} placed={p} event={p.item.event} top={top} bounds={[first * 60, last * 60]} />
              ),
            )}
          </div>

          {isToday && minutesOf(now) >= first * 60 && minutesOf(now) <= last * 60 && (
            <div className="pointer-events-none absolute inset-x-0 flex items-center" style={{ top: top(minutesOf(now)) }}>
              <span className="w-12 -translate-y-px pr-1.5 text-right text-2xs font-semibold text-danger tnum">
                {formatClock(now)}
              </span>
              <span className="relative mr-3 h-px flex-1 bg-danger">
                <span className="absolute -top-[3px] -left-[3px] size-[7px] rounded-full bg-danger" />
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

type BlockProps = { placed: Placed; top: (m: number) => number; bounds: [number, number] };

/** Vertical drag with 15-minute snapping; a press without movement is a tap. */
function useBlockDrag(start: number, end: number, bounds: [number, number], onMove: (minutes: number) => void, onTap: () => void) {
  const [shift, setShift] = useState(0);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const delta = Math.round(((shift / HOUR) * 60) / SNAP) * SNAP;
  const clamped = Math.max(bounds[0] - start, Math.min(bounds[1] - end, delta));
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, moved: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      const dy = e.clientY - drag.current.y;
      if (Math.abs(dy) > 3) drag.current.moved = true;
      if (drag.current.moved) setShift(dy);
    },
    onPointerUp: () => {
      const moved = drag.current?.moved;
      drag.current = null;
      setShift(0);
      if (!moved) onTap();
      else if (clamped !== 0) onMove(clamped);
    },
    onPointerCancel: () => {
      drag.current = null;
      setShift(0);
    },
  };
  return { shift, clamped, handlers };
}

function EventBlock({ placed, event, top, bounds }: BlockProps & { event: GEvent }) {
  const { start, end, lane, lanes } = placed;
  const { shift, clamped, handlers } = useBlockDrag(
    start,
    end,
    event.writable ? bounds : [start, end],
    (minutes) => {
      const ms = minutes * 60000;
      updateEvent(event, { start: new Date(event.start.getTime() + ms), end: new Date(event.end.getTime() + ms) }).catch((error) =>
        toast(`Couldn’t move the event: ${error instanceof Error ? error.message : String(error)}`),
      );
    },
    () => openEvent(event),
  );
  const shown = start + clamped;
  const height = ((end - start) / 60) * HOUR;
  const compact = height < 40;
  return (
    <motion.div
      layout={shift === 0 ? "position" : false}
      transition={springs.layout}
      role="button"
      tabIndex={-1}
      {...handlers}
      className={cn(
        "absolute flex cursor-default touch-none flex-col overflow-hidden rounded-[7px] px-2 select-none",
        compact ? "justify-center py-0" : "py-1",
        shift !== 0 && "z-10 shadow-[0_4px_14px_-6px_rgb(0_0_0/0.25)]",
      )}
      style={{
        top: top(shown) + 1,
        height: height - 2,
        left: `calc(${(lane / lanes) * 100}% + 4px)`,
        width: `calc(${100 / lanes}% - 6px)`,
        // The calendar's own colour, softly: events read apart from tasks.
        background: `color-mix(in srgb, ${event.color} 18%, transparent)`,
        boxShadow: `inset 2px 0 0 ${event.color}`,
      }}
    >
      <span className="truncate text-xs leading-4 font-medium">{event.title}</span>
      {!compact && (
        <span className="truncate text-2xs leading-4 text-ink-3 tnum">
          {formatClock(new Date(event.start.getTime() + clamped * 60000))}–{formatClock(new Date(event.end.getTime() + clamped * 60000))}
        </span>
      )}
    </motion.div>
  );
}

function Block({ placed, task, top, bounds }: BlockProps & { task: Task }) {
  const { start, end, lane, lanes } = placed;
  const navigate = useNavigate();
  const projects = useProjectMap();
  const selected = useUI((s) => s.selectedId === task.id || s.inspectorId === task.id);
  const project = task.projectId ? projects.get(task.projectId) : undefined;
  const { shift, clamped, handlers } = useBlockDrag(
    start,
    end,
    bounds,
    (minutes) => patchTask(task.id, { startTime: new Date(task.startTime!.getTime() + minutes * 60000) }),
    () => {
      ui.select(task.id);
      openTask(task, navigate);
    },
  );
  const shown = start + clamped;
  const height = ((end - start) / 60) * HOUR;
  const compact = height < 40;

  return (
    <ContextMenu items={() => taskMenu(task, navigate)}>
      <motion.div
        layout={shift === 0 ? "position" : false}
        transition={springs.layout}
        role="button"
        tabIndex={-1}
        data-task-id={task.id}
        {...handlers}
        className={cn(
          "absolute flex cursor-default touch-none flex-col overflow-hidden rounded-[7px] border-l-2 px-2 select-none",
          compact ? "justify-center py-0" : "py-1",
          selected ? "bg-accent-soft" : "bg-fill hover:bg-fill-strong",
          task.isDone && "opacity-55",
          shift !== 0 && "z-10 shadow-[0_4px_14px_-6px_rgb(0_0_0/0.25)]",
        )}
        style={{
          top: top(shown) + 1,
          height: height - 2,
          left: `calc(${(lane / lanes) * 100}% + 4px)`,
          width: `calc(${100 / lanes}% - 6px)`,
          borderLeftColor: project ? argbToCss(project.colorValue) : "var(--ink-4)",
        }}
      >
        <span className={cn("truncate text-xs leading-4 font-medium", task.isDone && "text-ink-3 line-through decoration-ink-4")}>
          {task.title}
        </span>
        {!compact && (
          <span className="truncate text-2xs leading-4 text-ink-3 tnum">
            {formatClock(atMinutes(task.date, shown))}
            {task.durationMinutes > 0 && `–${formatClock(atMinutes(task.date, shown + task.durationMinutes))}`}
          </span>
        )}
      </motion.div>
    </ContextMenu>
  );
}

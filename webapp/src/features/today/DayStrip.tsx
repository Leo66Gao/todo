"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useDroppable } from "@dnd-kit/core";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Task } from "@/lib/model";
import { addDays, dayKey, sameDay, startOfWeek, today } from "@/lib/time";
import { cn } from "@/ui/cn";
import { useGlass } from "@/glass/registry";
import { IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { workMinutes } from "@/features/tasks/meta";
import { useMedia } from "@/ui/useMedia";

/**
 * Two weeks of days. Under each date a hairline shows how much work is
 * planned (a full bar is four hours), so heavy days stand out at a glance.
 * Days accept dropped tasks.
 */
export function DayStrip({
  day,
  onPick,
  tasks,
}: {
  day: Date;
  onPick: (date: Date) => void;
  tasks: Task[];
}) {
  const phone = useMedia("(max-width: 767px)");
  const startKey = startOfWeek(day).getTime();
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(new Date(startKey), i)), [startKey]);
  const load = useMemo(() => {
    const map = new Map<string, { minutes: number; open: number; done: number }>();
    for (const t of tasks) {
      const key = dayKey(t.date);
      const entry = map.get(key) ?? { minutes: 0, open: 0, done: 0 };
      if (t.isDone) entry.done++;
      else {
        entry.open++;
        entry.minutes += workMinutes(t);
      }
      map.set(key, entry);
    }
    return map;
  }, [tasks]);

  return (
    <div className="flex items-center gap-1">
      <IconButton label="Previous week" size="sm" className="max-md:hidden" onClick={() => onPick(addDays(day, -7))}>
        <ChevronLeft className="size-4" />
      </IconButton>
      {/* Phones change week with a sideways swipe. */}
      <motion.div
        onPanEnd={(_, info) => {
          if (!phone || Math.abs(info.offset.x) < Math.abs(info.offset.y) * 1.2) return;
          if (info.offset.x < -40 || info.velocity.x < -400) onPick(addDays(day, 7));
          else if (info.offset.x > 40 || info.velocity.x > 400) onPick(addDays(day, -7));
        }}
        className="grid flex-1 touch-pan-y grid-cols-14 gap-0.5 max-md:grid-cols-7 max-md:gap-0"
      >
        {days.map((d, i) => (
          <DayCell
            key={d.getTime()}
            date={d}
            selected={sameDay(d, day)}
            info={load.get(dayKey(d))}
            onPick={onPick}
            phone={phone}
            className={i >= 7 ? "max-md:hidden" : undefined}
          />
        ))}
      </motion.div>
      <IconButton label="Next week" size="sm" className="max-md:hidden" onClick={() => onPick(addDays(day, 7))}>
        <ChevronRight className="size-4" />
      </IconButton>
    </div>
  );
}

function DayCell({
  date,
  selected,
  info,
  onPick,
  phone,
  className,
}: {
  date: Date;
  selected: boolean;
  info?: { minutes: number; open: number; done: number };
  onPick: (date: Date) => void;
  phone: boolean;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `strip-${date.getTime()}`, data: { type: "day", date } });
  const isToday = sameDay(date, today());
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  const fill = info ? Math.min(1, info.minutes / 240) : 0;
  const hasOpen = (info?.open ?? 0) > 0;
  if (phone) {
    // The weekday's letter over its date; the selected date sits in a
    // graphite circle, today's is blue, and a dot marks days with work.
    return (
      <button
        ref={setNodeRef}
        type="button"
        onClick={() => onPick(date)}
        aria-label={format(date, "EEEE d MMMM")}
        aria-pressed={selected}
        className={cn("flex flex-col items-center gap-1 py-1 active:scale-[0.94] transition-transform duration-150", className)}
      >
        <span className={cn("text-[12px] font-medium", isToday ? "text-accent" : weekend ? "text-ink-4" : "text-ink-3")}>
          {format(date, "EEEEE")}
        </span>
        <span className="relative flex size-[38px] items-center justify-center">
          {selected && <SelectedDay round />}
          {isOver && !selected && <span className="absolute inset-0 rounded-full bg-accent-soft" />}
          <span
            className={cn(
              "relative text-[18px] leading-none font-semibold tnum",
              selected ? "text-on-ink" : isToday ? "text-accent" : "text-ink",
            )}
          >
            {date.getDate()}
          </span>
        </span>
        <span className={cn("size-[5px] rounded-full", hasOpen ? (selected ? "bg-ink" : "bg-ink-4") : "bg-transparent")} />
      </button>
    );
  }
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onPick(date)}
      className={cn(
        "relative flex h-[58px] flex-col items-center justify-center gap-[3px] rounded-[calc(var(--radius-ctl)_+_2px)] transition-colors duration-100",
        !selected && "hover:bg-fill",
        isOver && !selected && "bg-accent-soft",
        className,
      )}
    >
      {selected && <SelectedDay />}
      <span
        className={cn(
          "relative text-2xs font-medium",
          selected ? "text-on-ink/70" : isToday ? "text-accent" : weekend ? "text-ink-4" : "text-ink-3",
        )}
      >
        {format(date, "EEE")}
      </span>
      <span
        className={cn(
          "relative text-base font-semibold leading-none tnum",
          selected ? "text-on-ink" : isToday ? "text-accent" : "text-ink",
        )}
      >
        {date.getDate()}
      </span>
      <span className={cn("relative mt-[3px] h-[2px] w-5 overflow-hidden rounded-full", selected ? "bg-on-ink/20" : "bg-fill-strong", !hasOpen && "opacity-0")}>
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", selected ? "bg-on-ink/80" : "bg-ink-3")}
          style={{ width: `${Math.max(fill, hasOpen ? 0.18 : 0) * 100}%` }}
        />
      </span>
    </button>
  );
}

/** The selected day's block; ink glass in the Liquid Glass theme. */
function SelectedDay({ round }: { round?: boolean }) {
  const glass = useGlass<HTMLSpanElement>({ level: 2, kind: "ink" });
  return (
    <motion.span
      ref={glass}
      layoutId="day-strip-selected"
      transition={springs.snappy}
      className={cn("absolute inset-0 bg-ink", round ? "rounded-full" : "rounded-[calc(var(--radius-ctl)_+_2px)]")}
    />
  );
}

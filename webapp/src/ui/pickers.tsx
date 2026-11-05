"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, sameDay, startOfDay, startOfWeek, today } from "@/lib/time";
import { parseTimeToken, type ClockTime } from "@/lib/timeParse";
import { cn } from "./cn";
import { IconButton } from "./controls";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function MiniCalendar({
  value,
  onPick,
  marks,
}: {
  value: Date | null;
  onPick: (date: Date) => void;
  /** Days that carry work get a small dot. */
  marks?: (date: Date) => boolean;
}) {
  const [month, setMonth] = useState(() => {
    const base = value ?? today();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [direction, setDirection] = useState(0);
  const days = useMemo(() => {
    const first = startOfWeek(month);
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);
  const now = today();
  const shift = (n: number) => {
    setDirection(n);
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  };

  return (
    <div className="w-[252px] select-none">
      <div className="flex items-center justify-between pb-1.5 pl-2">
        <span className="text-sm font-semibold">{format(month, "MMMM yyyy")}</span>
        <div className="flex">
          <IconButton label="Previous month" size="sm" onClick={() => shift(-1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Next month" size="sm" onClick={() => shift(1)}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-7 pb-1">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-center text-2xs font-medium text-ink-3">
            {d}
          </span>
        ))}
      </div>
      <div className="relative overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={month.toISOString()}
            custom={direction}
            initial={{ x: direction * 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction * -24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 42 }}
            className="grid grid-cols-7 gap-y-0.5"
          >
            {days.map((day) => {
              const inMonth = day.getMonth() === month.getMonth();
              const selected = value != null && sameDay(day, value);
              const isToday = sameDay(day, now);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => onPick(day)}
                  className={cn(
                    "relative mx-auto flex size-8 items-center justify-center rounded-full text-xs tnum transition-colors duration-100",
                    selected
                      ? "bg-ink font-semibold text-on-ink"
                      : isToday
                        ? "font-semibold text-accent hover:bg-fill"
                        : inMonth
                          ? "text-ink hover:bg-fill"
                          : "text-ink-4 hover:bg-fill",
                  )}
                >
                  {day.getDate()}
                  {marks?.(day) && !selected && (
                    <span className="absolute bottom-[3px] size-[3px] rounded-full bg-ink-3" />
                  )}
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function QuickRow({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[28px] w-full items-center justify-between rounded-[6px] px-2 text-sm transition-colors hover:bg-fill"
    >
      <span>{label}</span>
      <span className="text-2xs text-ink-3">{hint}</span>
    </button>
  );
}

/** Date picker body: quick choices above a month grid. */
export function DatePanel({
  value,
  onPick,
  onClear,
  clearLabel = "No date",
  marks,
}: {
  value: Date | null;
  onPick: (date: Date) => void;
  onClear?: () => void;
  clearLabel?: string;
  marks?: (date: Date) => boolean;
}) {
  const now = today();
  const nextMonday = addDays(startOfWeek(now), 7);
  const weekend = addDays(startOfWeek(now), 5);
  return (
    <div className="p-2">
      <div className="pb-2">
        <QuickRow label="Today" hint={format(now, "EEE")} onClick={() => onPick(now)} />
        <QuickRow label="Tomorrow" hint={format(addDays(now, 1), "EEE")} onClick={() => onPick(addDays(now, 1))} />
        {weekend > now && (
          <QuickRow label="This weekend" hint={format(weekend, "EEE d")} onClick={() => onPick(weekend)} />
        )}
        <QuickRow label="Next week" hint={format(nextMonday, "EEE d")} onClick={() => onPick(nextMonday)} />
        {onClear && <QuickRow label={clearLabel} hint="" onClick={onClear} />}
      </div>
      <div className="border-t border-line px-0.5 pt-2.5">
        <MiniCalendar value={value} onPick={(d) => onPick(startOfDay(d))} marks={marks} />
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
export const clockLabel = (t: ClockTime) => `${pad(t.hour)}.${pad(t.minute)}`;

/** Time picker body: type a time or pick a half-hour slot. */
export function TimePanel({
  value,
  onPick,
  onClear,
}: {
  value: ClockTime | null;
  onPick: (time: ClockTime) => void;
  onClear?: () => void;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const parsed = parseTimeToken(text);
  const slots = useMemo(
    () => Array.from({ length: 48 }, (_, i) => ({ hour: Math.floor(i / 2), minute: (i % 2) * 30 })),
    [],
  );
  useEffect(() => {
    const target = value ?? { hour: new Date().getHours() + 1, minute: 0 };
    const index = Math.min(47, target.hour * 2 + (target.minute >= 30 ? 1 : 0));
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    if (el && listRef.current) listRef.current.scrollTop = el.offsetTop - 64;
  }, [value]);

  return (
    <div className="w-[176px] p-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) onPick(parsed);
        }}
      >
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a time…"
          className={cn(
            "h-8 w-full rounded-[7px] border bg-card px-2.5 text-sm outline-none transition-[border-color,box-shadow]",
            text && !parsed ? "border-danger/50" : "border-line-strong focus:border-accent focus:ring-3 focus:ring-accent-soft",
          )}
        />
      </form>
      <div ref={listRef} className="scroll-area relative mt-2 max-h-[208px] overflow-y-auto">
        {slots.map((slot) => {
          const selected = value?.hour === slot.hour && value?.minute === slot.minute;
          return (
            <button
              key={slot.hour * 60 + slot.minute}
              type="button"
              onClick={() => onPick(slot)}
              className={cn(
                "flex h-[28px] w-full items-center rounded-[6px] px-2 text-sm tnum transition-colors",
                selected ? "bg-ink font-medium text-on-ink" : "hover:bg-fill",
              )}
            >
              {clockLabel(slot)}
            </button>
          );
        })}
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 flex h-[28px] w-full items-center rounded-[6px] border-t border-line px-2 pt-px text-sm text-ink-2 transition-colors hover:bg-fill"
        >
          No time
        </button>
      )}
    </div>
  );
}

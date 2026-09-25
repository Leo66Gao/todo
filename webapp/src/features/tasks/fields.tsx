"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { CalendarDays, Check, Clock, Folder, X } from "lucide-react";
import { argbToCss, PRIORITIES, type Priority } from "@/lib/dart";
import type { Project, TaskLabel } from "@/lib/model";
import { daysFromToday, relativeDay } from "@/lib/time";
import type { ClockTime } from "@/lib/timeParse";
import { cn } from "@/ui/cn";
import { Segmented, Slider } from "@/ui/controls";
import { Menu, Popover } from "@/ui/overlay";
import { clockLabel, DatePanel, TimePanel } from "@/ui/pickers";
import { PRIORITY_LABEL, priorityColor } from "./meta";

/** A quiet, fill-backed button that shows a property's current value. */
export const FieldButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactNode;
    muted?: boolean;
    /** Transparent until hovered, for property lists. */
    plain?: boolean;
    onClear?: () => void;
  }
>(function FieldButton({ icon, muted, plain, onClear, className, children, ...rest }, ref) {
  return (
    <span className={cn("group/field relative inline-flex", className)}>
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex h-8 w-full items-center gap-2 rounded-ctl text-sm transition-[background-color,transform] duration-150 active:scale-[0.98]",
          plain
            ? "px-2 hover:bg-fill data-[state=open]:bg-fill"
            : "bg-fill px-2.5 hover:bg-fill-strong data-[state=open]:bg-fill-strong",
          muted ? "text-ink-3" : "text-ink",
          onClear && "pr-8",
        )}
        {...rest}
      >
        {icon && <span className="flex shrink-0 text-ink-3 [&>svg]:size-[15px]">{icon}</span>}
        <span className="truncate">{children}</span>
      </button>
      {onClear && (
        <button
          type="button"
          aria-label="Clear"
          onClick={onClear}
          className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-[6px] text-ink-3 opacity-0 transition-opacity group-hover/field:opacity-100 hover:bg-line-strong/60 hover:text-ink focus-visible:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
});

export function DateField({
  value,
  onChange,
  onClear,
  marks,
  plain,
  className,
}: {
  value: Date | null;
  onChange: (date: Date) => void;
  onClear?: () => void;
  marks?: (d: Date) => boolean;
  plain?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <FieldButton icon={plain ? undefined : <CalendarDays />} plain={plain} muted={!value} className={className}>
          {value ? `${relativeDay(value)}${Math.abs(daysFromToday(value)) < 7 ? `, ${format(value, "d MMM")}` : ""}` : "No date"}
        </FieldButton>
      }
    >
      <DatePanel
        value={value}
        marks={marks}
        onPick={(d) => {
          onChange(d);
          setOpen(false);
        }}
        onClear={
          onClear
            ? () => {
                onClear();
                setOpen(false);
              }
            : undefined
        }
      />
    </Popover>
  );
}

export function TimeField({
  value,
  onChange,
  plain,
  className,
}: {
  value: ClockTime | null;
  onChange: (time: ClockTime | null) => void;
  plain?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <FieldButton
          icon={plain ? undefined : <Clock />}
          plain={plain}
          muted={!value}
          className={className}
          onClear={value ? () => onChange(null) : undefined}
        >
          {value ? clockLabel(value) : "No time"}
        </FieldButton>
      }
    >
      <TimePanel
        value={value}
        onPick={(t) => {
          onChange(t);
          setOpen(false);
        }}
        onClear={
          value
            ? () => {
                onChange(null);
                setOpen(false);
              }
            : undefined
        }
      />
    </Popover>
  );
}

export function SubjectField({
  value,
  projects,
  onChange,
  plain,
  className,
}: {
  value: string | null;
  projects: Project[];
  onChange: (id: string | null) => void;
  plain?: boolean;
  className?: string;
}) {
  const current = projects.find((p) => p.id === value);
  return (
    <Menu
      trigger={
        <FieldButton
          icon={
            current ? (
              plain ? (
                <span className="size-[7px] rounded-full" style={{ background: argbToCss(current.colorValue) }} />
              ) : (
                <span className="flex size-[15px] items-center justify-center">
                  <span className="size-2 rounded-full" style={{ background: argbToCss(current.colorValue) }} />
                </span>
              )
            ) : plain ? undefined : (
              <Folder />
            )
          }
          plain={plain}
          muted={!current}
          className={className}
        >
          {current?.title ?? (plain ? "None" : "No subject")}
        </FieldButton>
      }
      items={[
        { label: "No subject", checked: !current, onSelect: () => onChange(null) },
        ...(projects.length ? [{ separator: true as const }] : []),
        ...projects.map((p) => ({
          label: p.title,
          swatch: argbToCss(p.colorValue),
          checked: p.id === value,
          onSelect: () => onChange(p.id),
        })),
      ]}
    />
  );
}

export function PriorityField({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      className="w-full"
      options={PRIORITIES.map((p) => ({
        value: p,
        label: (
          <>
            {p !== "none" && <span className="size-[7px] rounded-full" style={{ background: priorityColor(p) }} />}
            {p === "medium" ? "Med" : p === "critical" ? "Crit" : PRIORITY_LABEL[p]}
          </>
        ),
      }))}
    />
  );
}

export function LabelField({
  value,
  labels,
  onChange,
}: {
  value: string;
  labels: TaskLabel[];
  onChange: (name: string) => void;
}) {
  const chip = (name: string, color: string | null, selected: boolean) => (
    <button
      key={name}
      type="button"
      onClick={() => onChange(name)}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-xs font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]",
        selected ? "border-ink bg-ink text-on-ink" : "border-line-strong text-ink-2 hover:border-ink-4 hover:text-ink",
      )}
    >
      {color && <span className="size-[7px] rounded-full" style={{ background: color }} />}
      {name === "General" ? "None" : name}
      {selected && name !== "General" && <Check className="size-3" />}
    </button>
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {chip("General", null, value === "General" || !labels.some((l) => l.name === value))}
      {labels.map((l) => chip(l.name, argbToCss(l.colorValue), value === l.name))}
    </div>
  );
}

export function DurationField({
  minutes,
  assignment,
  onChange,
}: {
  minutes: number;
  assignment: boolean;
  onChange: (minutes: number) => void;
}) {
  // To-dos: 0–180 min in 15-minute steps. Assignments: 1–10 hours.
  const value = assignment ? Math.min(10, Math.max(1, Math.round(minutes / 60))) : Math.min(180, Math.max(0, minutes));
  return (
    <div className="flex items-center gap-4">
      <Slider
        label="Time needed"
        min={assignment ? 1 : 0}
        max={assignment ? 10 : 180}
        step={assignment ? 1 : 15}
        value={value}
        onChange={(v) => onChange(assignment ? v * 60 : v)}
      />
      <span className="w-[62px] shrink-0 text-right text-sm font-medium tnum">
        {assignment ? `${value} ${value === 1 ? "hour" : "hours"}` : value === 0 ? "None" : `${value} min`}
      </span>
    </div>
  );
}

export function DifficultyField({
  level,
  active,
  onChange,
  onClear,
}: {
  level: number;
  active: boolean;
  onChange: (level: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <Slider
        label="Difficulty"
        min={1}
        max={5}
        step={1}
        value={active ? level : 2}
        dormant={!active}
        onChange={(v) => onChange(Math.max(2, v))}
      />
      <span className="flex w-[62px] shrink-0 items-center justify-end gap-1 text-sm tnum">
        {active ? (
          <>
            <span className="font-medium">Level {level}</span>
            <button
              type="button"
              aria-label="Clear difficulty"
              onClick={onClear}
              className="-mr-1 flex size-5 items-center justify-center rounded-[5px] text-ink-3 hover:bg-fill hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </>
        ) : (
          <span className="text-ink-3">None</span>
        )}
      </span>
    </div>
  );
}

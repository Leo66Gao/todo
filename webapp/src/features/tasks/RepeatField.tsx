"use client";

// Choosing how a task repeats: tap the exact days on a calendar ("this Sunday
// and every day next week"), or pick a rule ("every weekday") and see its days
// light up. Tapping a day while a rule is shown turns it into picked days, so
// a rule is a quick start that can then be adjusted day by day.

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Minus, Plus, Repeat as RepeatIcon } from "lucide-react";
import { dayString, describeDays, describeRepeat, MAX_PICKED, parseDay, repeatDays, ruleWeekdays, type RepeatRule, type RepeatUnit } from "@/lib/repeat";
import { addDays, sameDay, startOfDay, startOfWeek, today } from "@/lib/time";
import { cn } from "@/ui/cn";
import { Button, IconButton, Segmented } from "@/ui/controls";
import { Modal } from "@/ui/overlay";
import { DateField, FieldButton } from "./fields";

type Rule = Extract<RepeatRule, { kind: "rule" }>;

/** Monday first, as the app's weeks are. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const WEEK_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const UNIT_LABEL: Record<RepeatUnit, [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

const rule = (day: Date, patch: Partial<Rule>): Rule => ({ kind: "rule", every: 1, unit: "day", start: dayString(day), until: null, ...patch });

/** The days a choice falls on from [from] to [to] (a rule starts on [day]). */
function daysIn(value: RepeatRule | null, day: Date, from: Date, to: Date): Date[] {
  if (!value) return [];
  return repeatDays(value.kind === "rule" ? { ...value, start: dayString(day) } : value, from, to);
}

/** The repeat button for a form; opens the chooser. */
export function RepeatField({
  value,
  day,
  onChange,
  plain,
  className,
}: {
  value: RepeatRule | null;
  /** The task's own day (always part of the series). */
  day: Date;
  onChange: (value: RepeatRule | null) => void;
  plain?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const shown = value?.kind === "rule" ? { ...value, start: dayString(day) } : value;
  return (
    <>
      <FieldButton icon={plain ? undefined : <RepeatIcon />} plain={plain} muted={!value} className={className} onClick={() => setOpen(true)}>
        {describeRepeat(shown)}
      </FieldButton>
      <Modal open={open} onOpenChange={setOpen} width={420} label="Repeat" initialFocus={(e) => e.preventDefault()}>
        {open && (
          <RepeatChooser
            value={value}
            day={day}
            onDone={(next) => {
              onChange(next);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}

function RepeatChooser({ value, day, onDone, onCancel }: { value: RepeatRule | null; day: Date; onDone: (value: RepeatRule | null) => void; onCancel: () => void }) {
  const anchor = startOfDay(day);
  const now = today();
  const [draft, setDraft] = useState<RepeatRule | null>(value);
  const [month, setMonth] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(month), i)), [month]);
  const lit = useMemo(() => new Set(daysIn(draft, anchor, cells[0], cells[41]).map(dayString)), [draft, anchor, cells]);

  const setPicked = (days: Iterable<string>) => {
    const list = [...new Set([...days, dayString(anchor)])].sort().slice(0, MAX_PICKED);
    setDraft(list.length > 1 ? { kind: "days", days: list } : { kind: "days", days: [dayString(anchor)] });
  };
  /** Picked days so far: a rule's days (up to the end of the month shown) become picked ones. */
  const asPicked = (): Set<string> => {
    if (draft?.kind === "days") return new Set(draft.days);
    if (draft?.kind === "rule") return new Set(daysIn(draft, anchor, now < anchor ? now : anchor, cells[41]).map(dayString));
    return new Set([dayString(anchor)]);
  };
  const toggle = (d: Date) => {
    if (sameDay(d, anchor)) return;
    const days = asPicked();
    const key = dayString(d);
    if (days.has(key)) days.delete(key);
    else days.add(key);
    setPicked(days);
  };
  const addRange = (from: Date, count: number, weekdaysOnly = false) => {
    const days = asPicked();
    for (let i = 0; i < count; i++) {
      const d = addDays(from, i);
      if (d < now && !sameDay(d, anchor)) continue;
      if (weekdaysOnly && (d.getDay() === 0 || d.getDay() === 6)) continue;
      days.add(dayString(d));
    }
    setPicked(days);
  };

  const thisWeek = startOfWeek(now);
  const nextWeek = addDays(thisWeek, 7);
  /** Today to Sunday. */
  const restOfWeek = 7 - ((now.getDay() + 6) % 7);
  const presets: { label: string; value: RepeatRule | null; active: boolean }[] = [
    { label: "Never", value: null, active: !draft || (draft.kind === "days" && draft.days.length <= 1) },
    { label: "Every day", value: rule(anchor, { unit: "day" }), active: draft?.kind === "rule" && draft.unit === "day" && draft.every === 1 },
    {
      label: "Weekdays",
      value: rule(anchor, { unit: "week", weekdays: [1, 2, 3, 4, 5] }),
      active: draft?.kind === "rule" && draft.unit === "week" && draft.every === 1 && describeRepeat({ ...draft, start: dayString(anchor) }).startsWith("Every weekday"),
    },
    {
      label: `Every ${format(anchor, "EEEE")}`,
      value: rule(anchor, { unit: "week", weekdays: [anchor.getDay()] }),
      active: draft?.kind === "rule" && draft.unit === "week" && draft.every === 1 && ruleWeekdays({ ...draft, start: dayString(anchor) }).join() === String(anchor.getDay()),
    },
    { label: "Every month", value: rule(anchor, { unit: "month" }), active: draft?.kind === "rule" && draft.unit === "month" && draft.every === 1 },
  ];
  const custom = draft?.kind === "rule" && !presets.some((p) => p.active);
  const pickedDays = draft?.kind === "days" ? draft.days.map(parseDay).filter((d): d is Date => d != null) : [];

  return (
    <div className="scroll-area flex max-h-[min(84dvh,760px)] min-h-0 flex-col px-5 pt-4 pb-5 max-sm:px-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <RepeatIcon className="size-4 text-ink-3" />
        Repeat
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <Chip key={p.label} active={p.active} onClick={() => setDraft(p.value)}>
            {p.label}
          </Chip>
        ))}
        <Chip active={custom} onClick={() => setDraft(draft?.kind === "rule" ? draft : rule(anchor, { unit: "week", every: 2, weekdays: [anchor.getDay()] }))}>
          Custom
        </Chip>
        <Chip active={draft?.kind === "days" && draft.days.length > 1} onClick={() => draft?.kind !== "days" && setPicked(asPicked())}>
          Pick days
        </Chip>
      </div>

      {draft?.kind === "rule" && <RuleControls value={draft} anchor={anchor} onChange={setDraft} />}

      {(draft?.kind !== "rule") && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {restOfWeek > 1 && <Quick onClick={() => addRange(now, restOfWeek)}>Rest of this week</Quick>}
          <Quick onClick={() => addRange(nextWeek, 7)}>Next week</Quick>
          <Quick onClick={() => addRange(nextWeek, 7, true)}>Weekdays next week</Quick>
          <Quick onClick={() => addRange(now, 7)}>Next 7 days</Quick>
          <Quick onClick={() => addRange(now, 14)}>Next 14 days</Quick>
          {pickedDays.length > 1 && (
            <button type="button" onClick={() => setPicked([])} className="h-7 rounded-full px-2.5 text-xs font-medium text-ink-3 transition-colors hover:bg-fill hover:text-ink">
              Clear
            </button>
          )}
        </div>
      )}

      <div className="mt-4 select-none">
        <div className="flex items-center justify-between pb-1.5 pl-1">
          <span className="text-sm font-semibold">{format(month, "MMMM yyyy")}</span>
          <div className="flex">
            <IconButton label="Previous month" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton label="Next month" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
        </div>
        <div className="grid grid-cols-7 pb-1">
          {WEEK.map((d) => (
            <span key={d} className="text-center text-2xs font-medium text-ink-3">
              {WEEK_LETTER[d]}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((d) => {
            const key = dayString(d);
            const own = sameDay(d, anchor);
            const on = own || lit.has(key);
            const past = d < now && !own;
            const inMonth = d.getMonth() === month.getMonth();
            return (
              <button
                key={key}
                type="button"
                disabled={past || own}
                aria-pressed={on}
                aria-label={`${format(d, "EEEE d MMMM")}${own ? ", this task’s day" : on ? ", repeats" : ""}`}
                onClick={() => toggle(d)}
                className={cn(
                  "relative mx-auto flex size-9 items-center justify-center rounded-full text-[13px] tnum transition-colors duration-100",
                  own
                    ? "bg-accent font-semibold text-white ring-2 ring-ink ring-offset-2 ring-offset-raised"
                    : on
                      ? "bg-accent font-semibold text-white"
                      : past
                        ? "text-ink-4"
                        : inMonth
                          ? "text-ink hover:bg-fill"
                          : "text-ink-3 hover:bg-fill",
                  sameDay(d, now) && !on && "font-semibold text-accent",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-3">
          {draft ? "Tap days to add or remove them." : "Tap days to repeat the task on them."} The ringed day is this task’s own.
        </p>
      </div>

      <div className="mt-4 rounded-[10px] bg-fill px-3 py-2 text-sm">
        {draft?.kind === "days" && pickedDays.length > 1 ? (
          <>
            <span className="font-medium">{pickedDays.length} days</span>
            <span className="text-ink-2">: {describeDays(pickedDays, 4)}</span>
          </>
        ) : (
          <span className={cn(draft ? "font-medium" : "text-ink-3")}>{describeRepeat(draft?.kind === "rule" ? { ...draft, start: dayString(anchor) } : draft)}</span>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onDone(draft && !(draft.kind === "days" && draft.days.length <= 1) ? draft : null)}>
          Done
        </Button>
      </div>
    </div>
  );
}

function RuleControls({ value, anchor, onChange }: { value: Rule; anchor: Date; onChange: (value: Rule) => void }) {
  const weekdays = ruleWeekdays({ ...value, start: dayString(anchor) });
  const until = parseDay(value.until);
  return (
    <div className="mt-3 space-y-2.5 rounded-[12px] bg-fill px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-2">Every</span>
        <span className="inline-flex items-center rounded-ctl bg-card">
          <IconButton label="Fewer" size="sm" disabled={value.every <= 1} onClick={() => onChange({ ...value, every: value.every - 1 })}>
            <Minus className="size-3.5" />
          </IconButton>
          <span className="w-6 text-center font-medium tnum">{value.every}</span>
          <IconButton label="More" size="sm" disabled={value.every >= 99} onClick={() => onChange({ ...value, every: value.every + 1 })}>
            <Plus className="size-3.5" />
          </IconButton>
        </span>
        <Segmented
          size="sm"
          value={value.unit}
          onChange={(unit) => onChange({ ...value, unit, weekdays: unit === "week" ? weekdays : undefined })}
          options={(["day", "week", "month", "year"] as RepeatUnit[]).map((u) => ({ value: u, label: UNIT_LABEL[u][value.every === 1 ? 0 : 1] }))}
        />
      </div>
      {value.unit === "week" && (
        <div className="flex items-center gap-1">
          {WEEK.map((d) => {
            const on = weekdays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={format(addDays(startOfWeek(anchor), (d + 6) % 7), "EEEE")}
                onClick={() => {
                  const next = on ? weekdays.filter((x) => x !== d) : [...weekdays, d];
                  if (next.length) onChange({ ...value, weekdays: next.sort() });
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  on ? "bg-accent text-white" : "bg-card text-ink-2 hover:bg-fill-strong",
                )}
              >
                {WEEK_LETTER[d]}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-2">Until</span>
        <DateField
          value={until}
          onChange={(d) => onChange({ ...value, until: dayString(d < anchor ? anchor : d) })}
          onClear={until ? () => onChange({ ...value, until: null }) : undefined}
          className="w-[180px]"
        />
        {!until && <span className="text-xs text-ink-3">(no end)</span>}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full border px-3 text-sm transition-colors",
        active ? "border-transparent bg-ink font-medium text-on-ink" : "border-line-strong text-ink-2 hover:bg-fill",
      )}
    >
      {children}
    </button>
  );
}

function Quick({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-7 rounded-full bg-accent-soft px-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20">
      + {children}
    </button>
  );
}

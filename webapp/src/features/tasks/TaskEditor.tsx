"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Camera, CalendarDays, Clock, Flag, Hourglass, Sparkles, X } from "lucide-react";
import { smartAdd, tasksFromPhoto } from "@/lib/aiCapture";
import { format } from "date-fns";
import { argbToCss } from "@/lib/dart";
import { parseQuickAdd, type TokenKind } from "@/lib/quickAdd";
import type { Priority, TaskType } from "@/lib/dart";
import { hasExplicitDifficulty, isFieldVisible, type FieldId, type Task } from "@/lib/model";
import { formatClock, formatDuration, relativeDay, sameDay, startOfDay, today } from "@/lib/time";
import { clockOf, withClock, type ClockTime } from "@/lib/timeParse";
import { ui, useUI, type EditorState } from "@/shell/ui";
import { addTask, applyDominoShift, captureWorkspaceSession, newTask, undoDominoShift, updateTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, Kbd, Segmented } from "@/ui/controls";
import { confirmDialog, Modal, useAutoFocus } from "@/ui/overlay";
import { RichText } from "@/ui/RichText";
import { springs } from "@/ui/motion";
import { toast } from "@/ui/toast";
import { useAllTasks } from "./meta";
import { RepeatField } from "./RepeatField";
import { dayString, readRepeat, type RepeatRule } from "@/lib/repeat";
import { applyToUpcoming, changesShared, repeatSummary, setRepeat, upcomingOf } from "@/store/repeat";
import {
  DateField,
  DifficultyField,
  DurationField,
  LabelField,
  PriorityField,
  SubjectField,
  TimeField,
} from "./fields";

export function TaskEditorHost() {
  const editor = useUI((s) => s.editor);
  // Keep rendering the last editor while the sheet animates out.
  const [shown, setShown] = useState<EditorState>(editor);
  if (editor && editor !== shown) setShown(editor);
  return (
    <Modal
      open={editor != null}
      onOpenChange={(open) => !open && ui.closeEditor()}
      width={560}
      label={shown?.mode === "edit" ? "Edit task" : "New task"}
    >
      {shown && <TaskEditor key={shown.nonce} editor={shown} />}
    </Modal>
  );
}

function TaskEditor({ editor }: { editor: NonNullable<EditorState> }) {
  const [editorSession] = useState(() => captureWorkspaceSession());
  const tasks = useWorkspace((s) => s.tasks);
  const settings = useWorkspace((s) => s.settings);
  const projects = useWorkspace((s) => s.projects);
  const allTasks = useAllTasks();
  const existing = editor.mode === "edit" ? tasks.find((t) => t.id === editor.taskId) : undefined;
  const defaults = editor.mode === "new" ? editor.defaults : {};

  const [title, setTitle] = useState(existing?.title ?? defaults.title ?? "");
  const [type, setType] = useState<TaskType>(existing?.type ?? defaults.type ?? "todo");
  const [date, setDate] = useState<Date>(startOfDay(existing?.date ?? defaults.date ?? today()));
  const [time, setTime] = useState<ClockTime | null>(() => {
    const start = existing?.startTime ?? defaults.startTime;
    return start ? clockOf(start) : null;
  });
  const [notes, setNotes] = useState(existing?.notes ?? defaults.notes ?? "");
  const [minutes, setMinutes] = useState(() => {
    if (existing) return existing.durationMinutes;
    if (defaults.durationMinutes != null) return defaults.durationMinutes;
    return (defaults.type ?? "todo") === "assignment" ? 120 : 30;
  });
  const [difficulty, setDifficulty] = useState(existing?.difficulty ?? 1);
  const [difficultyActive, setDifficultyActive] = useState(existing ? hasExplicitDifficulty(existing) : false);
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? defaults.priority ?? "none");
  const [projectId, setProjectId] = useState<string | null>(
    existing?.projectId ?? defaults.projectId ?? null,
  );
  const [category, setCategory] = useState(existing?.category ?? defaults.category ?? "General");
  const [repeat, setRepeatDraft] = useState<RepeatRule | null>(() => (existing ? (readRepeat(existing)?.rule ?? null) : null));
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const titleFocus = useAutoFocus();

  // Words in the title can set the other fields ("essay due fri 3pm 2h").
  // A field set by hand, or a suggestion dismissed, stops being read.
  const [ignored, setIgnored] = useState<TokenKind[]>([]);
  const ignore = (kind: TokenKind) => setIgnored((list) => (list.includes(kind) ? list : [...list, kind]));
  const reading = !existing || title !== existing.title;
  const parsed = useMemo(
    () =>
      parseQuickAdd(title, {
        now: new Date(),
        projects,
        ignore: [
          ...ignored,
          ...(!reading ? (["date", "time", "duration", "subject", "priority"] as TokenKind[]) : []),
          ...(!settings.showTime ? (["time"] as TokenKind[]) : []),
          ...(!isFieldVisible(settings, "duration") ? (["duration"] as TokenKind[]) : []),
          ...(!isFieldVisible(settings, "priority") ? (["priority"] as TokenKind[]) : []),
          ...(projects.length === 0 || !isFieldVisible(settings, "subject") ? (["subject"] as TokenKind[]) : []),
        ],
      }),
    [title, projects, ignored, reading, settings],
  );
  const effectiveTime = parsed.time ?? time;
  const effectiveDate = parsed.date ?? date;
  const effectiveMinutes = parsed.minutes ?? minutes;
  const effectiveProject = parsed.projectId ?? projectId;
  const effectivePriority = parsed.priority ?? priority;
  const effectiveType: TaskType = parsed.due && !existing && !ignored.includes("date") ? "assignment" : type;
  const canSave = parsed.title.trim().length > 0;

  const changeType = (next: TaskType) => {
    setType(next);
    ignore("date");
    // Same defaults as the phone app when switching kinds.
    if (!parsed.minutes) setMinutes(next === "assignment" ? 120 : 30);
  };

  const hasWork = (d: Date) => allTasks.some((t) => !t.isDone && sameDay(t.date, d));
  const pickDate = (d: Date) => {
    setDate(d);
    ignore("date");
  };
  const pickTime = (t: ClockTime | null) => {
    setTime(t);
    ignore("time");
  };

  // What the title set, shown under it; each can be dismissed.
  const subject = projects.find((p) => p.id === parsed.projectId);
  const chips: { kind: TokenKind; icon: ReactNode; label: string }[] = [];
  for (const token of parsed.tokens) {
    if (chips.some((c) => c.kind === token.kind)) continue;
    if (token.kind === "date" && parsed.date)
      chips.push({
        kind: "date",
        icon: <CalendarDays />,
        label: `${parsed.due ? "Due " : ""}${Math.abs(parsed.date.getTime() - today().getTime()) < 2 * 86400000 ? relativeDay(parsed.date) : format(parsed.date, "EEE d MMM")}`,
      });
    if (token.kind === "time" && parsed.time) chips.push({ kind: "time", icon: <Clock />, label: formatClock(withClock(effectiveDate, parsed.time)) });
    if (token.kind === "duration" && parsed.minutes) chips.push({ kind: "duration", icon: <Hourglass />, label: formatDuration(parsed.minutes) });
    if (token.kind === "priority" && parsed.priority)
      chips.push({ kind: "priority", icon: <Flag />, label: `${parsed.priority[0].toUpperCase()}${parsed.priority.slice(1)} priority` });
    if (token.kind === "subject" && subject)
      chips.push({
        kind: "subject",
        icon: <span className="m-[3px] size-2 rounded-full" style={{ background: argbToCss(subject.colorValue) }} />,
        label: subject.title,
      });
  }

  const save = async () => {
    const currentSession = editorSession;
    if (!currentSession()) return;
    if (!canSave) {
      titleRef.current?.focus();
      return;
    }
    const finalTitle = parsed.title.trim();
    const finalMinutes = !settings.showDuration && existing ? existing.durationMinutes : effectiveMinutes;
    const startTime = effectiveTime ? withClock(effectiveDate, effectiveTime) : null;
    const extra = { ...(existing?.extra ?? defaults.extra) };
    if (difficultyActive && difficulty === 1) extra.difficultySelected = true;
    else delete extra.difficultySelected;
    const fields = {
      title: finalTitle,
      notes,
      date: startTime ? startOfDay(startTime) : effectiveDate,
      startTime,
      type: effectiveType,
      difficulty: difficultyActive ? difficulty : 1,
      priority: effectivePriority,
      projectId: effectiveProject,
      durationMinutes: finalMinutes,
      category,
      extra: Object.keys(extra).length ? extra : undefined,
    };
    // Picked days always include the task's own day.
    const finalRepeat: RepeatRule | null =
      repeat?.kind === "days" ? { kind: "days", days: [...new Set([...repeat.days, dayString(fields.date)])].sort() } : repeat;
    if (!existing) {
      const task = newTask({ ...defaults, ...fields, remainingMinutes: finalMinutes });
      addTask(task);
      ui.closeEditor();
      if (finalRepeat) {
        const { added } = setRepeat(task.id, finalRepeat);
        toast(added ? `Added to ${added + 1} days` : "Added. It repeats.");
        return;
      }
      if (!sameDay(fields.date, ui.get().day)) {
        const when = fields.date;
        toast(`Added to ${when.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}`);
      }
      return;
    }
    const updated: Task = {
      ...existing,
      ...fields,
      remainingMinutes: existing.durationMinutes === finalMinutes ? existing.remainingMinutes : finalMinutes,
    };
    let domino = false;
    if (
      startTime &&
      existing.startTime &&
      sameDay(effectiveDate, existing.date) &&
      (existing.startTime.getHours() !== startTime.getHours() ||
        existing.startTime.getMinutes() !== startTime.getMinutes())
    ) {
      domino = await askDomino(existing, startTime);
    }
    if (!currentSession()) return;
    // A repeating task: the change can go to the upcoming ones too.
    const upcoming = upcomingOf(existing);
    const everyUpcoming =
      upcoming.length > 0 &&
      changesShared(existing, updated) &&
      (await confirmDialog({
        title: "Change the upcoming ones too?",
        message: `This task repeats. Apply the changes to the ${upcoming.length === 1 ? "next one" : `${upcoming.length} upcoming ones`} as well?`,
        confirmLabel: "This and upcoming",
        cancelLabel: "Only this one",
      }));
    if (!currentSession()) return;
    updateTask(updated);
    if (everyUpcoming) applyToUpcoming(updated);
    if (sameRule(readRepeat(existing)?.rule ?? null, finalRepeat) === false) {
      const { added, removed } = setRepeat(updated.id, finalRepeat);
      const summary = repeatSummary({ added, removed });
      if (summary) toast(summary);
      else if (!finalRepeat) toast("Stopped repeating");
    }
    if (domino) {
      const delta = startTime!.getTime() - existing.startTime!.getTime();
      const shift = applyDominoShift(updated.id, existing.date, existing.startTime!, delta);
      if (shift.length > 0) {
        const n = shift.length === 1 ? "1 later task" : `${shift.length} later tasks`;
        toast(`Moved ${n} ${formatShift(delta)} ${delta > 0 ? "later" : "earlier"}`, {
          label: "Undo",
          run: () => undoDominoShift(shift),
        });
      }
    }
    ui.closeEditor();
  };

  const askDomino = async (task: Task, newStart: Date) => {
    const oldStart = task.startTime!;
    // Completed tasks stay where they were done; only open ones shift.
    const timedSameDay = tasks.filter((t) => !t.isDone && t.startTime && sameDay(t.date, task.date));
    if (timedSameDay.length < 3) return false;
    const affected = timedSameDay
      .filter((t) => t.id !== task.id && t.startTime!.getTime() > oldStart.getTime())
      .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime());
    if (affected.length === 0) return false;
    const delta = newStart.getTime() - oldStart.getTime();
    const shift = formatShift(delta);
    return confirmDialog({
      title: "Shift later tasks too?",
      message: (
        <div>
          <p>
            Tasks after this one would move {shift} {delta > 0 ? "later" : "earlier"}.
          </p>
          <ul className="mt-3 space-y-1.5">
            {affected.slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-ink">
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-xs text-ink-3 tnum">{formatClock(t.startTime!)}</span>
                <ArrowRight className="size-3 text-ink-3" />
                <span className="text-xs font-medium tnum">
                  {formatClock(new Date(t.startTime!.getTime() + delta))}
                </span>
              </li>
            ))}
          </ul>
          {affected.length > 6 && <p className="mt-1.5 text-xs text-ink-3">and {affected.length - 6} more</p>}
        </div>
      ),
      confirmLabel: "Shift all",
      cancelLabel: "Only this task",
    });
  };

  const renderField = (id: FieldId): ReactNode => {
    switch (id) {
      case "type":
        return (
          <Row label="Type">
            <Segmented
              value={effectiveType}
              onChange={changeType}
              className="w-[220px]"
              options={[
                { value: "todo", label: "To-do" },
                { value: "assignment", label: "Assignment" },
              ]}
            />
          </Row>
        );
      case "date":
        return (
          <Row label={effectiveType === "assignment" ? "Due" : "Date"}>
            <DateField value={effectiveDate} onChange={pickDate} marks={hasWork} className="w-[200px]" />
          </Row>
        );
      case "time":
        return (
          <Row label="Time">
            <TimeField value={effectiveTime} onChange={pickTime} className="w-[140px]" />
          </Row>
        );
      case "notes":
        return (
          <Row label="Notes" top>
            <div className="rounded-ctl bg-fill px-3 py-2 transition-colors focus-within:bg-fill-strong/60">
              <RichText value={notes} onChange={setNotes} placeholder="Add notes" minHeight={40} />
            </div>
          </Row>
        );
      case "duration":
        return (
          <Row label="Time needed">
            <DurationField
              minutes={effectiveMinutes}
              assignment={effectiveType === "assignment"}
              onChange={(m) => {
                setMinutes(m);
                ignore("duration");
              }}
            />
          </Row>
        );
      case "difficulty":
        return (
          <Row label="Difficulty">
            <DifficultyField
              level={difficulty}
              active={difficultyActive}
              onChange={(v) => {
                setDifficultyActive(true);
                setDifficulty(v);
              }}
              onClear={() => {
                setDifficultyActive(false);
                setDifficulty(1);
              }}
            />
          </Row>
        );
      case "priority":
        return (
          <Row label="Priority">
            <PriorityField
              value={effectivePriority}
              onChange={(p) => {
                setPriority(p);
                ignore("priority");
              }}
            />
          </Row>
        );
      case "subject":
        if (projects.length === 0) return null;
        return (
          <Row label="Subject">
            <SubjectField
              value={effectiveProject}
              projects={projects}
              onChange={(id) => {
                setProjectId(id);
                ignore("subject");
              }}
              className="w-[240px]"
            />
          </Row>
        );
      case "labels":
        if (settings.labels.length === 0) return null;
        return (
          <Row label="Label" top>
            <LabelField value={category} labels={settings.labels} onChange={setCategory} />
          </Row>
        );
    }
  };

  const repeatRow = (
    <Row key="repeat" label="Repeat">
      <RepeatField value={repeat} day={effectiveDate} onChange={setRepeatDraft} className="w-[240px] max-w-full" />
    </Row>
  );

  // Date and time share a row when they sit next to each other in the order.
  const order = settings.fieldOrder.filter((id) => isFieldVisible(settings, id));
  const rows: ReactNode[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const next = order[i + 1];
    if ((id === "date" && next === "time") || (id === "time" && next === "date")) {
      rows.push(
        <Row key="when" label={effectiveType === "assignment" ? "Due" : "When"}>
          <div className="flex gap-2">
            {(id === "date" ? ["date", "time"] : ["time", "date"]).map((f) =>
              f === "date" ? (
                <DateField key="d" value={effectiveDate} onChange={pickDate} marks={hasWork} className="w-[200px]" />
              ) : (
                <TimeField key="t" value={effectiveTime} onChange={pickTime} className="w-[128px]" />
              ),
            )}
          </div>
        </Row>,
      );
      i++;
      rows.push(repeatRow);
      continue;
    }
    const row = renderField(id);
    if (row) rows.push(<div key={id}>{row}</div>);
    if (id === "date") rows.push(repeatRow);
  }
  if (!rows.includes(repeatRow)) rows.push(repeatRow);

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="px-5 pt-5 pb-3">
        <div className="mb-2 text-xs font-medium text-ink-3">{existing ? "Edit task" : "New task"}</div>
        <textarea
          ref={titleRef}
          {...titleFocus}
          // Editing starts at the end of the title, ready to add to it.
          onFocus={(e) => {
            const end = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(end, end);
          }}
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={existing ? "What needs to be done?" : "What needs to be done? Try “physics review fri 18-20 urgent”"}
          className="field-sizing-content block max-h-28 w-full resize-none bg-transparent text-lg font-medium outline-none placeholder:text-ink-4"
        />
        <motion.div
          initial={false}
          animate={{ height: chips.length ? "auto" : 0, opacity: chips.length ? 1 : 0 }}
          transition={springs.layout}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap gap-1.5 pt-2">
            <AnimatePresence initial={false} mode="popLayout">
              {chips.map((chip) => (
                <motion.span
                  key={chip.kind}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }}
                  transition={springs.snappy}
                  className="flex h-6 items-center gap-1 rounded-full bg-accent-soft pr-0.5 pl-2 text-xs font-medium text-accent [&>svg]:size-3.5"
                >
                  {chip.icon}
                  {chip.label}
                  <button
                    type="button"
                    aria-label={`Don’t use “${chip.label}”`}
                    onClick={() => {
                      ignore(chip.kind);
                      titleRef.current?.focus();
                    }}
                    className="ml-0.5 flex size-5 items-center justify-center rounded-full text-accent/70 transition-colors hover:bg-accent/15 hover:text-accent"
                  >
                    <X className="size-3" />
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
      <div className="scroll-area min-h-0 flex-1 space-y-3.5 border-t border-line px-5 py-4">{rows}</div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        {existing ? (
          <span className="hover-only flex items-center gap-1 text-2xs text-ink-3 max-sm:hidden">
            <Kbd>⌘</Kbd>
            <Kbd>↩</Kbd>
            <span className="ml-1">to save</span>
          </span>
        ) : (
          // AI only runs when asked: the task is added straight away and the
          // AI fills it in afterwards.
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              className="max-sm:h-11 max-sm:px-3"
              icon={<Sparkles className="size-4" />}
              disabled={!title.trim()}
              title="Let AI read what you typed and set the date, time, length and the rest"
              onClick={() => {
                if (smartAdd(title, { ...defaults, type: effectiveType, category })) ui.closeEditor();
              }}
            >
              <span className="max-sm:hidden">Smart add</span>
            </Button>
            <label
              title="Add tasks from a photo of an assignment sheet or whiteboard"
              className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-sm font-medium text-ink-2 transition-colors hover:bg-fill max-sm:h-11 max-sm:px-3"
            >
              <Camera className="size-4" />
              <span className="max-sm:hidden">Photo</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file && tasksFromPhoto(file, { ...defaults, category })) ui.closeEditor();
                }}
              />
            </label>
          </div>
        )}
        {/* On phones the buttons share the width, within reach of a thumb. */}
        <div className="ml-auto flex gap-2 max-sm:flex-1">
          <Button variant="ghost" className="max-sm:h-11 max-sm:flex-1" onClick={() => ui.closeEditor()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="max-sm:h-11 max-sm:flex-[2]" disabled={!canSave}>
            {existing ? "Save changes" : "Create task"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Whether two repeat choices are the same (a rule's start follows the task's day). */
function sameRule(a: RepeatRule | null, b: RepeatRule | null) {
  const plain = (r: RepeatRule | null) => (r?.kind === "rule" ? { ...r, start: "", until: r.until ?? null, weekdays: r.weekdays ?? [] } : r);
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

function Row({ label, children, top }: { label: string; children: ReactNode; top?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[96px_1fr] gap-3 max-sm:grid-cols-1 max-sm:gap-1.5", top ? "items-start" : "items-center")}>
      <span className={cn("text-xs font-medium text-ink-2", top && "pt-2")}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** "30m", "1h", "1h 15m": how far a domino shift moves tasks. */
function formatShift(deltaMs: number) {
  const mins = Math.round(Math.abs(deltaMs) / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
}

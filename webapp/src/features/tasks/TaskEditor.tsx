"use client";

import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Clock } from "lucide-react";
import type { Priority, TaskType } from "@/lib/dart";
import { hasExplicitDifficulty, isFieldVisible, type FieldId, type Task } from "@/lib/model";
import { formatClock, sameDay, startOfDay, today } from "@/lib/time";
import { clockOf, parseTimeFromTitle, withClock, type ClockTime } from "@/lib/timeParse";
import { ui, useUI, type EditorState } from "@/shell/ui";
import { addTask, applyDominoShift, newTask, updateTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, Kbd, Segmented } from "@/ui/controls";
import { confirmDialog, Modal } from "@/ui/overlay";
import { RichText } from "@/ui/RichText";
import { toast } from "@/ui/toast";
import { useAllTasks } from "./meta";
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
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const parsed = settings.showTime ? parseTimeFromTitle(title) : { title: title.trim(), time: null };
  const effectiveTime = parsed.time ?? time;
  const canSave = parsed.title.trim().length > 0;

  const changeType = (next: TaskType) => {
    setType(next);
    // Same defaults as the phone app when switching kinds.
    setMinutes(next === "assignment" ? 120 : 30);
  };

  const hasWork = (d: Date) => allTasks.some((t) => !t.isDone && sameDay(t.date, d));

  const save = async () => {
    if (!canSave) {
      titleRef.current?.focus();
      return;
    }
    const finalTitle = parsed.title.trim();
    const finalMinutes = !settings.showDuration && existing ? existing.durationMinutes : minutes;
    const startTime = effectiveTime ? withClock(date, effectiveTime) : null;
    const extra = { ...(existing?.extra ?? defaults.extra) };
    if (difficultyActive && difficulty === 1) extra.difficultySelected = true;
    else delete extra.difficultySelected;
    const fields = {
      title: finalTitle,
      notes,
      date: startTime ? startOfDay(startTime) : date,
      startTime,
      type,
      difficulty: difficultyActive ? difficulty : 1,
      priority,
      projectId,
      durationMinutes: finalMinutes,
      category,
      extra: Object.keys(extra).length ? extra : undefined,
    };
    if (!existing) {
      addTask(newTask({ ...defaults, ...fields, remainingMinutes: finalMinutes }));
      ui.closeEditor();
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
      sameDay(date, existing.date) &&
      (existing.startTime.getHours() !== startTime.getHours() ||
        existing.startTime.getMinutes() !== startTime.getMinutes())
    ) {
      domino = await askDomino(existing, startTime);
    }
    updateTask(updated);
    if (domino) {
      applyDominoShift(updated.id, existing.date, existing.startTime!, startTime!.getTime() - existing.startTime!.getTime());
    }
    ui.closeEditor();
  };

  const askDomino = async (task: Task, newStart: Date) => {
    const oldStart = task.startTime!;
    const timedSameDay = tasks.filter((t) => t.startTime && sameDay(t.date, task.date));
    if (timedSameDay.length < 3) return false;
    const affected = timedSameDay
      .filter((t) => t.id !== task.id && t.startTime!.getTime() > oldStart.getTime())
      .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime());
    if (affected.length === 0) return false;
    const delta = newStart.getTime() - oldStart.getTime();
    const mins = Math.round(Math.abs(delta) / 60000);
    const shift = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
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
              value={type}
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
          <Row label={type === "assignment" ? "Due" : "Date"}>
            <DateField value={date} onChange={setDate} marks={hasWork} className="w-[200px]" />
          </Row>
        );
      case "time":
        return (
          <Row label="Time">
            <TimeField value={effectiveTime} onChange={setTime} className="w-[140px]" />
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
            <DurationField minutes={minutes} assignment={type === "assignment"} onChange={setMinutes} />
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
            <PriorityField value={priority} onChange={setPriority} />
          </Row>
        );
      case "subject":
        if (projects.length === 0) return null;
        return (
          <Row label="Subject">
            <SubjectField value={projectId} projects={projects} onChange={setProjectId} className="w-[240px]" />
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

  // Date and time share a row when they sit next to each other in the order.
  const order = settings.fieldOrder.filter((id) => isFieldVisible(settings, id));
  const rows: ReactNode[] = [];
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const next = order[i + 1];
    if ((id === "date" && next === "time") || (id === "time" && next === "date")) {
      rows.push(
        <Row key="when" label={type === "assignment" ? "Due" : "When"}>
          <div className="flex gap-2">
            {(id === "date" ? ["date", "time"] : ["time", "date"]).map((f) =>
              f === "date" ? (
                <DateField key="d" value={date} onChange={setDate} marks={hasWork} className="w-[200px]" />
              ) : (
                <TimeField key="t" value={effectiveTime} onChange={setTime} className="w-[128px]" />
              ),
            )}
          </div>
        </Row>,
      );
      i++;
      continue;
    }
    const row = renderField(id);
    if (row) rows.push(<div key={id}>{row}</div>);
  }

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
          autoFocus
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="What needs to be done?"
          className="field-sizing-content block max-h-28 w-full resize-none bg-transparent text-lg font-medium outline-none placeholder:text-ink-4"
        />
        <AnimatePresence initial={false}>
          {parsed.time && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 pt-1.5 text-xs text-accent">
                <Clock className="size-3.5" />
                Starts at {formatClock(withClock(date, parsed.time))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="scroll-area min-h-0 flex-1 space-y-3.5 border-t border-line px-5 py-4">{rows}</div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <span className="flex items-center gap-1 text-2xs text-ink-3 max-sm:hidden">
          <Kbd>⌘</Kbd>
          <Kbd>↩</Kbd>
          <span className="ml-1">to save</span>
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => ui.closeEditor()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {existing ? "Save changes" : "Create task"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Row({ label, children, top }: { label: string; children: ReactNode; top?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[96px_1fr] gap-3 max-sm:grid-cols-1 max-sm:gap-1.5", top ? "items-start" : "items-center")}>
      <span className={cn("text-xs font-medium text-ink-2", top && "pt-2")}>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

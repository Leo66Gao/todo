"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Plus,
  Route,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { argbToCss, PRIORITIES, type Priority } from "@/lib/dart";
import { encodeTask, hasExplicitDifficulty, recordFits, uuid, type Subtask, type Task } from "@/lib/model";
import { dueLabel, formatDuration, relativeDay, startOfDay } from "@/lib/time";
import { clockOf, withClock } from "@/lib/timeParse";
import { useNavigate } from "@/shell/nav";
import { ui, useUI } from "@/shell/ui";
import {
  addSubtaskFull,
  deleteSubtask,
  patchTask,
  toggleSubtask,
  toggleTask,
  updateSubtask,
  updateTaskNotes,
  useWorkspace,
} from "@/store/workspace";
import { cn } from "@/ui/cn";
import { PHONE, useMedia } from "@/ui/useMedia";
import { Button, IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { Menu, Modal, Popover, Tooltip, type MenuItem } from "@/ui/overlay";
import { DatePanel } from "@/ui/pickers";
import { RichText } from "@/ui/RichText";
import { toast } from "@/ui/toast";
import { taskMenu } from "./actions";
import { DateField, SubjectField, TimeField } from "./fields";
import { PRIORITY_LABEL, priorityColor, difficultyColor } from "./meta";
import { WorkBack } from "./WorkBack";
import { startFocus } from "@/lib/focus";
import { TaskCheck } from "./TaskCheck";
import { useGlassOn } from "@/glass/prefs";
import { GLASS_GAP, useGlass } from "@/glass/registry";

const PANEL_WIDTH = 384;

/** Docked detail panel on wide windows. */
export function InspectorPanel() {
  const id = useUI((s) => s.inspectorId);
  const exists = useWorkspace((s) => (id ? s.tasks.some((t) => t.id === id) : false));
  const open = id != null && exists;
  const [shown, setShown] = useState(id);
  const glass = useGlassOn();
  const panelGlass = useGlass({ level: 1, kind: "chrome" });
  if (open && id !== shown) setShown(id);
  return (
    <motion.aside
      ref={panelGlass}
      data-surface="inspector"
      initial={false}
      animate={{ width: open ? PANEL_WIDTH : 0, marginLeft: glass && open ? GLASS_GAP : 0 }}
      transition={springs.panel}
      className="relative shrink-0 overflow-hidden border-l border-line bg-card max-lg:hidden"
      style={{ borderLeftWidth: open && !glass ? 1 : 0 }}
      aria-hidden={!open}
    >
      <div className="h-full" style={{ width: PANEL_WIDTH }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {shown && (
            <motion.div
              key={shown}
              className="h-full"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              <TaskDetail taskId={shown} variant="panel" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}

/** The same detail view as a sheet on narrow windows. */
export function InspectorSheet() {
  const id = useUI((s) => s.inspectorId);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const exists = useWorkspace((s) => (id ? s.tasks.some((t) => t.id === id) : false));
  const [shown, setShown] = useState(id);
  if (id && id !== shown) setShown(id);
  return (
    <Modal
      open={narrow && id != null && exists}
      onOpenChange={(o) => !o && ui.closeInspector()}
      width={520}
      label="Task details"
      className="max-sm:bg-canvas"
    >
      {shown && (
        <div className="scroll-area max-h-[86vh]">
          <TaskDetail taskId={shown} variant="panel" />
        </div>
      )}
    </Modal>
  );
}

export function TaskDetail({ taskId, variant }: { taskId: string; variant: "panel" | "page" }) {
  const task = useWorkspace((s) => s.tasks.find((t) => t.id === taskId));
  const settings = useWorkspace((s) => s.settings);
  const projects = useWorkspace((s) => s.projects);
  const navigate = useNavigate();
  // In the phone sheet, the details sit in grouped cards like the full page.
  const phone = useMedia(PHONE);
  if (!task) return null;
  const grouped = variant === "page" || phone;

  const isAssignment = task.type === "assignment";
  const setStart = (time: { hour: number; minute: number } | null) =>
    patchTask(task.id, { startTime: time ? withClock(task.date, time) : null });

  const properties: ReactNode[] = [];
  if (settings.showTaskType) {
    properties.push(
      <Property key="type" label="Type">
        <Menu
          trigger={<ValueButton>{isAssignment ? "Assignment" : "To-do"}</ValueButton>}
          items={[
            { label: "To-do", checked: !isAssignment, onSelect: () => patchTask(task.id, { type: "todo" }) },
            { label: "Assignment", checked: isAssignment, onSelect: () => patchTask(task.id, { type: "assignment" }) },
          ]}
        />
      </Property>,
    );
  }
  if (settings.showDate) {
    properties.push(
      <Property key="date" label={isAssignment ? "Due" : "Date"}>
        <DateField
          value={task.date}
          plain
          className="w-full"
          onChange={(d) =>
            patchTask(task.id, {
              date: d,
              startTime: task.startTime ? withClock(d, clockOf(task.startTime)) : null,
            })
          }
        />
      </Property>,
    );
  }
  if (settings.showTime) {
    properties.push(
      <Property key="time" label="Time">
        <TimeField
          value={task.startTime ? clockOf(task.startTime) : null}
          onChange={setStart}
          plain
          className="w-full"
        />
      </Property>,
    );
  }
  if (settings.showDuration) {
    const options = isAssignment
      ? Array.from({ length: 10 }, (_, i) => (i + 1) * 60)
      : [0, 15, 30, 45, 60, 90, 120, 150, 180];
    properties.push(
      <Property key="duration" label="Time needed">
        <Menu
          trigger={<ValueButton muted={task.durationMinutes === 0}>{task.durationMinutes > 0 ? formatDuration(task.durationMinutes) : "None"}</ValueButton>}
          items={options.map((m) => ({
            label: m === 0 ? "None" : formatDuration(m),
            checked: task.durationMinutes === m,
            onSelect: () =>
              patchTask(task.id, {
                durationMinutes: m,
                remainingMinutes: task.durationMinutes === m ? task.remainingMinutes : m,
              }),
          }))}
        />
      </Property>,
    );
  }
  if (settings.showDifficulty) {
    const selected = hasExplicitDifficulty(task);
    const chooseDifficulty = (level: number | null) => {
      const extra = { ...task.extra };
      if (level === 1) extra.difficultySelected = true;
      else delete extra.difficultySelected;
      patchTask(task.id, {
        difficulty: level ?? 1,
        extra: Object.keys(extra).length ? extra : undefined,
      });
    };
    properties.push(
      <Property key="difficulty" label="Difficulty">
        <Menu
          trigger={
            <ValueButton muted={!selected}>
              {selected && <span className="size-[7px] shrink-0 rounded-full" style={{ background: difficultyColor(task.difficulty) }} />}
              {selected ? `Level ${task.difficulty}` : "None"}
            </ValueButton>
          }
          items={[
            { label: "None", checked: !selected, onSelect: () => chooseDifficulty(null) },
            ...[1, 2, 3, 4, 5].map((level) => ({
              label: `Level ${level}`,
              checked: selected && task.difficulty === level,
              onSelect: () => chooseDifficulty(level),
            })),
          ]}
        />
      </Property>,
    );
  }
  if (settings.showPriority) {
    properties.push(
      <Property key="priority" label="Priority">
        <Menu
          trigger={
            <ValueButton muted={task.priority === "none"}>
              {task.priority !== "none" && (
                <span className="size-[7px] rounded-full" style={{ background: priorityColor(task.priority) }} />
              )}
              {PRIORITY_LABEL[task.priority]}
            </ValueButton>
          }
          items={PRIORITIES.map((p: Priority) => ({
            label: PRIORITY_LABEL[p],
            swatch: p === "none" ? undefined : priorityColor(p),
            checked: task.priority === p,
            onSelect: () => patchTask(task.id, { priority: p }),
          }))}
        />
      </Property>,
    );
  }
  if (settings.showSubject && projects.length > 0) {
    properties.push(
      <Property key="subject" label="Subject">
        <SubjectField
          value={task.projectId}
          projects={projects}
          onChange={(id) => patchTask(task.id, { projectId: id })}
          plain
          className="w-full"
        />
      </Property>,
    );
  }
  if (settings.showLabels && settings.labels.length > 0) {
    const label = settings.labels.find((l) => l.name === task.category);
    properties.push(
      <Property key="label" label="Label">
        <Menu
          trigger={
            <ValueButton muted={!label}>
              {label && <span className="size-[7px] rounded-full" style={{ background: argbToCss(label.colorValue) }} />}
              {label?.name ?? "None"}
            </ValueButton>
          }
          items={[
            { label: "None", checked: !label, onSelect: () => patchTask(task.id, { category: "General" }) },
            { separator: true },
            ...settings.labels.map((l) => ({
              label: l.name,
              swatch: argbToCss(l.colorValue),
              checked: l.name === task.category,
              onSelect: () => patchTask(task.id, { category: l.name }),
            })),
          ]}
        />
      </Property>,
    );
  }

  return (
    <div className={cn("flex h-full flex-col", variant === "page" && "h-auto")}>
      {variant === "panel" && (
        <div className="flex h-[52px] shrink-0 items-center gap-1 px-3">
          <TaskCheck
            checked={task.isDone}
            color={task.priority !== "none" ? priorityColor(task.priority) : undefined}
            onToggle={() => toggleTask(task.id)}
          />
          <span className={cn("text-xs", task.isDone ? "text-ink-3" : isAssignment ? "text-accent" : "text-ink-3")}>
            {task.isDone ? "Completed" : isAssignment ? `Assignment due ${dueLabel(task.date).toLowerCase()}` : relativeDay(task.date)}
          </span>
          <div className="ml-auto flex items-center">
            {isAssignment && (
              <Button variant="ghost" size="sm" onClick={() => navigate({ view: "assignment", id: task.id })}>
                Open page
              </Button>
            )}
            {!task.isDone && (
              <Tooltip label="Focus for 25 minutes" shortcut={["F"]}>
                <IconButton label="Focus" onClick={() => startFocus(25, { id: task.id, title: task.title })}>
                  <Timer className="size-[15px]" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip label="Edit all fields" shortcut={["⌘", "↩"]}>
              <IconButton label="Edit task" onClick={() => ui.editTask(task.id)}>
                <Pencil className="size-[15px]" />
              </IconButton>
            </Tooltip>
            <Menu
              align="end"
              trigger={
                <IconButton label="More">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              }
              items={taskMenu(task, navigate).filter((i) => !("label" in i) || i.label !== "Open")}
            />
            <Tooltip label="Close" shortcut={["esc"]}>
              <IconButton label="Close details" onClick={() => ui.closeInspector()}>
                <X className="size-4" />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      )}
      <div className={cn(variant === "panel" && "scroll-area flex-1 px-5 pb-10")}>
        <TitleEditor task={task} large={grouped} />
        {properties.length > 0 && (
          <div className={cn("mt-3 space-y-0.5", grouped && "card mt-4 px-2 py-2 max-sm:space-y-0 max-sm:divide-y max-sm:divide-line max-sm:py-0")}>
            {properties}
          </div>
        )}

        <SubtaskSection task={task} page={grouped} />

        {settings.showNotes && (
          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold text-ink-2 max-sm:px-2 max-sm:text-[13.5px]">Notes</div>
            <NotesEditor task={task} page={grouped} />
          </div>
        )}
      </div>
    </div>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-center max-sm:min-h-11 max-sm:grid-cols-[112px_1fr]">
      <span className="text-xs text-ink-3 max-sm:pl-2 max-sm:text-[14px]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ValueButton({ children, muted, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { muted?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-ctl px-2 text-left text-sm transition-[background-color,transform] duration-150 hover:bg-fill active:scale-[0.98] data-[state=open]:bg-fill max-sm:h-10",
        muted ? "text-ink-3" : "text-ink",
      )}
    >
      {children}
    </button>
  );
}

function TitleEditor({ task, large }: { task: Task; large?: boolean }) {
  const [value, setValue] = useState(task.title);
  const [synced, setSynced] = useState(task.title);
  if (task.title !== synced) {
    setSynced(task.title);
    setValue(task.title);
  }
  const commit = () => {
    const next = value.trim();
    if (!next) setValue(task.title);
    else if (next !== task.title) patchTask(task.id, { title: next });
  };
  return (
    <textarea
      rows={1}
      value={value}
      onChange={(e) => setValue(e.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setValue(task.title);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      aria-label="Title"
      className={cn(
        "field-sizing-content -mx-2 block w-[calc(100%+16px)] resize-none rounded-ctl bg-transparent px-2 py-1 font-semibold tracking-[-0.01em] outline-none transition-colors hover:bg-fill/60 focus:bg-fill/60",
        large ? "text-xl max-sm:text-[24px] max-sm:leading-[30px] max-sm:font-bold max-sm:tracking-[-0.02em]" : "text-lg",
        task.isDone && "text-ink-3 line-through decoration-ink-4",
      )}
    />
  );
}

function NotesEditor({ task, page }: { task: Task; page?: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const content = pending.current;
    pending.current = null;
    if (content == null) return;
    if (!recordFits(encodeTask({ ...task, notes: content }))) {
      toast("Notes are too long to sync. Shorten them to save.");
      return;
    }
    updateTaskNotes(task.id, content);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      className={cn(
        "px-3.5 pt-3 pb-2 transition-colors",
        page ? "card" : "rounded-[calc(var(--radius-ctl)_+_2px)] border border-line focus-within:border-line-strong",
      )}
    >
      <RichText
        value={task.notes}
        placeholder="Write notes, links or a checklist…"
        toolbar="compact"
        minHeight={72}
        onChange={(content) => {
          pending.current = content;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 600);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subtasks and milestones

function SubtaskSection({ task, page }: { task: Task; page?: boolean }) {
  const [draft, setDraft] = useState("");
  const [planning, setPlanning] = useState(false);
  const canPlan = task.type === "assignment" && !task.isDone && startOfDay(task.date) >= startOfDay(new Date());
  const isAssignment = task.type === "assignment";
  const done = task.subtasks.filter((s) => s.isDone).length;
  const total = task.subtasks.length;
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    addSubtaskFull(task.id, { id: uuid(), title, isDone: false, date: null, priority: null, difficulty: null });
    setDraft("");
  };
  return (
    <div className="mt-6">
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-xs font-semibold text-ink-2 max-sm:pl-2 max-sm:text-[13.5px]">{isAssignment ? "Subtasks and milestones" : "Subtasks"}</span>
        {canPlan && (
          <Tooltip label="Suggest steps, dated back from the deadline">
            <Button size="sm" variant="ghost" className="-my-1 h-6 px-1.5 text-xs text-ink-3" icon={<Route className="size-3.5" />} onClick={() => setPlanning(true)}>
              Work back
            </Button>
          </Tooltip>
        )}
        {total > 0 && (
          <>
            <span className="relative ml-auto h-1 w-16 shrink-0 overflow-hidden rounded-full bg-fill-strong max-sm:w-10">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full bg-ink"
                initial={false}
                animate={{ width: `${(done / total) * 100}%` }}
                transition={springs.panel}
              />
            </span>
            <span className="text-xs text-ink-3 tnum">
              {done}/{total}
            </span>
          </>
        )}
      </div>
      <div className={cn(page && "card px-2 py-1.5")}>
        <AnimatePresence initial={false}>
          {task.subtasks.map((sub) => (
            <motion.div
              key={sub.id}
              layout="position"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={springs.layout}
            >
              <SubtaskRow task={task} sub={sub} />
            </motion.div>
          ))}
        </AnimatePresence>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex items-center gap-1.5 rounded-ctl pl-1 transition-colors focus-within:bg-fill/60"
        >
          <span className="flex size-[22px] items-center justify-center text-ink-3">
            <Plus className="size-3.5" />
          </span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={isAssignment ? "Add a subtask or milestone" : "Add a subtask"}
            className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
        </form>
      </div>
      {canPlan && <WorkBack task={task} open={planning} onOpenChange={setPlanning} />}
    </div>
  );
}

function SubtaskRow({ task, sub }: { task: Task; sub: Subtask }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sub.title);
  const [dateOpen, setDateOpen] = useState(false);
  const isAssignment = task.type === "assignment";
  const phone = useMedia("(max-width: 767px)");
  const commit = () => {
    setEditing(false);
    const title = value.trim();
    if (title && title !== sub.title) updateSubtask(task.id, { ...sub, title });
    else setValue(sub.title);
  };
  const overrides: MenuItem[] = isAssignment
    ? [
        {
          label: "Priority",
          items: [
            { label: "Same as assignment", checked: sub.priority == null, onSelect: () => updateSubtask(task.id, { ...sub, priority: null }) },
            { separator: true },
            ...PRIORITIES.map((p) => ({
              label: PRIORITY_LABEL[p],
              swatch: p === "none" ? undefined : priorityColor(p),
              checked: sub.priority === p,
              onSelect: () => updateSubtask(task.id, { ...sub, priority: p }),
            })),
          ],
        },
        {
          label: "Difficulty",
          items: [
            { label: "Same as assignment", checked: sub.difficulty == null, onSelect: () => updateSubtask(task.id, { ...sub, difficulty: null }) },
            { separator: true },
            ...[1, 2, 3, 4, 5].map((level) => ({
              label: `Level ${level}`,
              checked: sub.difficulty === level,
              onSelect: () => updateSubtask(task.id, { ...sub, difficulty: level }),
            })),
          ],
        },
        { separator: true },
      ]
    : [];
  return (
    <div className="group flex min-h-8 items-center gap-1 rounded-ctl pr-1 transition-colors hover:bg-fill/60 max-md:min-h-11 max-md:gap-1.5">
      <TaskCheck size={phone ? 19 : 15} checked={sub.isDone || task.isDone} onToggle={() => toggleSubtask(task.id, sub.id)} />
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setValue(sub.title);
              setEditing(false);
            }
          }}
          className="h-7 flex-1 bg-transparent text-sm outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn("min-w-0 flex-1 truncate py-1 text-left text-sm", sub.isDone ? "text-ink-3 line-through decoration-ink-4" : "text-ink")}
        >
          {sub.title}
        </button>
      )}
      {(isAssignment || sub.date) && (
        <Popover
          open={dateOpen}
          onOpenChange={setDateOpen}
          align="end"
          trigger={
            <button
              type="button"
              className={cn(
                "flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-xs transition-colors hover:bg-fill-strong",
                sub.date ? "text-ink-2" : "text-ink-3 hover-reveal opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100",
              )}
            >
              <CalendarDays className="size-3" />
              {sub.date ? relativeDay(sub.date) : "Milestone"}
            </button>
          }
        >
          <DatePanel
            value={sub.date}
            clearLabel="Not a milestone"
            onPick={(d) => {
              updateSubtask(task.id, { ...sub, date: startOfDay(d) });
              setDateOpen(false);
            }}
            onClear={
              sub.date
                ? () => {
                    updateSubtask(task.id, { ...sub, date: null });
                    setDateOpen(false);
                  }
                : undefined
            }
          />
        </Popover>
      )}
      <Menu
        align="end"
        trigger={
          <IconButton label="Subtask options" size="sm" className="hover-reveal opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
            <ChevronDown className="size-3.5" />
          </IconButton>
        }
        items={[
          { label: sub.isDone ? "Mark as not done" : "Mark as done", icon: <Check />, onSelect: () => toggleSubtask(task.id, sub.id) },
          { label: "Rename", icon: <Pencil />, onSelect: () => setEditing(true) },
          ...overrides,
          { label: "Delete", icon: <Trash2 />, destructive: true, onSelect: () => deleteSubtask(task.id, sub.id) },
        ]}
      />
    </div>
  );
}

"use client";

import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion, useTransform } from "motion/react";
import { useGlass, useMergedRefs } from "@/glass/registry";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Trash2, ChevronDown, CornerDownRight, FileText, GraduationCap, ListChecks, Timer } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import type { Task } from "@/lib/model";
import { dueLabel, formatClock, formatDuration, relativeDay, sameDay } from "@/lib/time";
import { isEmptyContent } from "@/lib/delta";
import { haptic } from "@/lib/native";
import { useNavigate } from "@/shell/nav";
import { ui, useUI } from "@/shell/ui";
import { toggleSubtask, toggleTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { springs } from "@/ui/motion";
import { ContextMenu } from "@/ui/overlay";
import { useMedia } from "@/ui/useMedia";
import { editTask, openTask, removeTask, taskMenu } from "./actions";
import { priorityColor, useLabelMap, useProjectMap } from "./meta";
import { TaskCheck } from "./TaskCheck";
import { useSwipe } from "./useSwipe";

export interface TaskDragData {
  type: "task";
  task: Task;
}

export interface TaskRowProps {
  task: Task;
  /** Show the task's date in the meta line (lists spanning several days). */
  showDate?: boolean;
  /** Use the sortable variant (inside a SortableContext). */
  sortable?: boolean;
  draggable?: boolean;
  trailing?: ReactNode;
  compact?: boolean;
  /** A plain row, for lists that already sit inside a card. */
  plain?: boolean;
}

export function TaskRow(props: TaskRowProps) {
  if (props.sortable) return <SortableRow {...props} />;
  if (props.draggable !== false) return <DraggableRow {...props} />;
  return <TaskRowView {...props} />;
}

function SortableRow(props: TaskRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { type: "task", task: props.task } satisfies TaskDragData,
  });
  return (
    <TaskRowView
      {...props}
      dragRef={setNodeRef}
      dragProps={{ ...attributes, ...listeners }}
      dragStyle={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
    />
  );
}

function DraggableRow(props: TaskRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.task.id,
    data: { type: "task", task: props.task } satisfies TaskDragData,
  });
  return <TaskRowView {...props} dragRef={setNodeRef} dragProps={{ ...attributes, ...listeners }} dragging={isDragging} />;
}

type ViewProps = TaskRowProps & {
  dragRef?: (el: HTMLElement | null) => void;
  dragProps?: Record<string, unknown>;
  dragStyle?: CSSProperties;
  dragging?: boolean;
};

const TaskRowView = memo(function TaskRowView({
  task,
  showDate,
  trailing,
  compact,
  plain,
  dragRef,
  dragProps,
  dragStyle,
  dragging,
}: ViewProps) {
  const navigate = useNavigate();
  const selected = useUI((s) => s.selectedId === task.id);
  const inspected = useUI((s) => s.inspectorId === task.id);
  const settings = useWorkspace((s) => s.settings);
  const parentTitle = useWorkspace((s) =>
    task.parentTaskId ? s.tasks.find((t) => t.id === task.parentTaskId)?.title : undefined,
  );
  const projects = useProjectMap();
  const labels = useLabelMap();
  const phone = useMedia("(max-width: 767px)");
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const lastClick = useRef(0);

  const project = task.projectId ? projects.get(task.projectId) : undefined;
  const label = task.category !== "General" ? labels.get(task.category) : undefined;
  const done = task.isDone || completing;
  const doneSubs = task.subtasks.filter((s) => s.isDone).length;
  const minutes = task.remainingMinutes > 0 ? task.remainingMinutes : task.durationMinutes;
  const isAssignment = task.type === "assignment";
  const isMilestone = task.parentTaskId != null;
  const check = settings.showPriority && task.priority !== "none" ? priorityColor(task.priority) : undefined;

  const toggle = () => {
    if (task.isDone || completing) {
      setCompleting(false);
      if (task.isDone) toggleTask(task.id);
      return;
    }
    // Let the tick land before the row moves to Completed.
    setCompleting(true);
    setTimeout(() => {
      toggleTask(task.id);
      setCompleting(false);
    }, 420);
  };

  // Swipe right completes; swipe left deletes (with Undo).
  const swipe = useSwipe(toggle, () => removeTask(task));
  const revealLeft = useTransform(swipe.x, (v) => Math.max(0, v));
  const revealRight = useTransform(swipe.x, (v) => Math.max(0, -v));

  // Touch: holding the row opens the editor; holding the checkbox picks the
  // task up to reorder it (the drag sensor listens there only).
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const held = useRef(false);
  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const startHold = (e: React.TouchEvent) => {
    cancelHold();
    held.current = false;
    if (e.touches.length !== 1 || (e.target as Element).closest("[data-drag-handle]")) return;
    const t = e.touches[0];
    hold.current = {
      x: t.clientX,
      y: t.clientY,
      timer: setTimeout(() => {
        hold.current = null;
        held.current = true;
        haptic("medium");
        editTask(task, navigate);
      }, 480),
    };
  };
  const moveHold = (e: React.TouchEvent) => {
    const h = hold.current;
    const t = e.touches[0];
    if (h && t && Math.hypot(t.clientX - h.x, t.clientY - h.y) > 8) cancelHold();
  };
  useEffect(() => cancelHold, []);

  // The tap that ends a drag from the checkbox mustn't also tick it.
  const dragEndedAt = useRef(0);
  useEffect(() => {
    if (!dragging) dragEndedAt.current = performance.now();
  }, [dragging]);
  const checkToggle = () => {
    if (dragging || performance.now() - dragEndedAt.current < 350) return;
    toggle();
  };

  const onClick = (e: React.MouseEvent) => {
    if (held.current) {
      held.current = false;
      return;
    }
    if (swipe.consumeSwipe()) return;
    if (e.defaultPrevented) return;
    const now = performance.now();
    if (now - lastClick.current < 320) {
      lastClick.current = 0;
      editTask(task, navigate);
      return;
    }
    lastClick.current = now;
    ui.select(task.id);
    openTask(task, navigate);
  };

  const meta: ReactNode[] = [];
  if (isMilestone) {
    meta.push(
      <span key="parent" className="flex min-w-0 items-center gap-1 text-ink-2">
        <CornerDownRight className="size-3 shrink-0" />
        <span className="truncate">{parentTitle ?? "Assignment"}</span>
      </span>,
    );
  } else if (isAssignment) {
    meta.push(
      <span key="kind" className="flex items-center gap-1 text-accent">
        <GraduationCap className="size-3.5" />
        <span>{sameDay(task.date, new Date()) || !showDate ? "Assignment" : `Due ${dueLabel(task.date).toLowerCase()}`}</span>
      </span>,
    );
  }
  if (showDate && !isAssignment) {
    meta.push(<span key="date">{relativeDay(task.date)}</span>);
  }
  if (minutes > 0 && settings.showDuration) {
    meta.push(
      <span key="dur" className="flex items-center gap-1 font-mono text-[12px]">
        <Timer className="size-3" />
        {formatDuration(minutes)}
      </span>,
    );
  }
  if (project && settings.showSubject) {
    meta.push(
      <span key="subject" className="flex min-w-0 items-center gap-1.5">
        <span className="size-[7px] shrink-0 rounded-full" style={{ background: argbToCss(project.colorValue) }} />
        <span className="truncate">{project.title}</span>
      </span>,
    );
  }
  if (label && settings.showLabels) {
    meta.push(
      <span key="label" className="flex items-center gap-1 rounded-[5px] bg-fill px-1.5 py-px text-2xs font-medium text-ink-2">
        <span className="size-[5px] rounded-full" style={{ background: argbToCss(label.colorValue) }} />
        {label.name}
      </span>,
    );
  }
  if (task.subtasks.length > 0) {
    meta.push(
      <button
        key="subs"
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          setExpanded((v) => !v);
        }}
        className="-mx-1 flex items-center gap-1 rounded-[5px] px-1 tnum transition-colors hover:bg-fill-strong hover:text-ink"
      >
        <ListChecks className="size-3" />
        {doneSubs}/{task.subtasks.length}
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={springs.snappy} className="flex">
          <ChevronDown className="size-3" />
        </motion.span>
      </button>,
    );
  }
  if (!isEmptyContent(task.notes) && settings.showNotes) {
    meta.push(<FileText key="notes" className="size-3 text-ink-3" aria-label="Has notes" />);
  }

  // Each task sits on a thin plate of glass in the Liquid Glass theme.
  const cardGlass = useGlass<HTMLDivElement>({ level: 2, kind: "card", interactive: true, inScroll: true });
  const cardRef = useMergedRefs(dragRef, cardGlass);

  const dragTouchStart = dragProps?.onTouchStart as ((e: React.TouchEvent) => void) | undefined;

  return (
    <div
      ref={cardRef}
      style={dragStyle}
      data-task-card={done ? "done" : ""}
      className={cn(
        // Each task is its own rounded card on the page.
        "relative transition-opacity duration-200",
        plain && "rounded-ctl",
        done && !completing && "opacity-70",
        dragging && "z-10 opacity-40",
      )}
    >

      <div className="relative overflow-hidden rounded-[inherit]">
        {/* Revealed behind the row while it is swiped (touch screens). */}
        <motion.div
          aria-hidden
          style={{ width: revealLeft }}
          className={cn(
            "absolute inset-y-0 left-0 flex items-center overflow-hidden transition-colors duration-150",
            swipe.armed === "right" ? "bg-ink text-on-ink" : "bg-fill text-ink-3",
          )}
        >
          <Check className="ml-4 size-5 shrink-0" strokeWidth={2.4} />
        </motion.div>
        <motion.div
          aria-hidden
          style={{ width: revealRight }}
          className={cn(
            "absolute inset-y-0 right-0 flex items-center justify-end overflow-hidden text-xs font-medium whitespace-nowrap transition-colors duration-150",
            swipe.armed === "left" ? "bg-danger text-white" : "bg-fill text-ink-3",
          )}
        >
          Delete
          <Trash2 className="mr-4 ml-1.5 size-4 shrink-0" />
        </motion.div>
      <ContextMenu items={() => taskMenu(task, navigate)} disabled={phone}>
        <motion.div
          {...dragProps}
          {...swipe.handlers}
          onTouchStart={(e: React.TouchEvent) => {
            swipe.handlers.onTouchStart(e);
            startHold(e);
          }}
          onTouchMove={(e: React.TouchEvent) => {
            swipe.handlers.onTouchMove(e);
            moveHold(e);
          }}
          onTouchEnd={() => {
            swipe.handlers.onTouchEnd();
            cancelHold();
          }}
          onTouchCancel={() => {
            swipe.handlers.onTouchCancel();
            cancelHold();
          }}
          style={{ x: swipe.x }}
          role="button"
          tabIndex={-1}
          data-task-id={task.id}
          onClick={onClick}
          className={cn(
            "group relative flex touch-pan-y items-center gap-2 rounded-[inherit] max-md:select-none max-md:[-webkit-touch-callout:none] pr-3 pl-2 outline-none transition-colors duration-100 max-md:gap-3 max-md:pr-[18px] max-md:pl-3.5",
            compact ? "py-1.5" : "py-2.5 max-md:py-3.5",
            // Opaque fills, so the swipe panels underneath stay hidden.
            inspected
              ? "bg-card bg-[image:linear-gradient(var(--accent-soft),var(--accent-soft))]"
              : selected
                ? "bg-card bg-[image:linear-gradient(var(--fill),var(--fill))]"
                : "bg-card hover:bg-[image:linear-gradient(var(--row-hover),var(--row-hover))]",
          )}
        >
          <span data-drag-handle className="-my-1 flex shrink-0" onTouchStart={dragTouchStart}>
            <TaskCheck checked={done} color={check} onToggle={checkToggle} size={phone ? 22 : 18} />
          </span>
          <div className="min-w-0 flex-1">
            {/* Long titles wrap onto a second line rather than being cut short. */}
            <div
              className={cn(
                "text-sm font-medium break-words transition-colors duration-200 [overflow-wrap:anywhere] max-md:text-base max-md:tracking-[-0.01em]",
                compact ? "line-clamp-1" : "line-clamp-2",
                done ? "text-ink-3" : "text-ink",
              )}
            >
              <span className="strike" data-done={done || undefined}>
                {task.title}
              </span>
            </div>
            {meta.length > 0 && !compact && (
              <div className="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3 max-md:mt-1">
                {meta}
              </div>
            )}
          </div>
          {task.startTime && settings.showTime && (
            <span
              className={cn(
                "shrink-0 rounded-[6px] px-1.5 py-px text-xs font-medium tnum max-md:bg-transparent max-md:px-0 max-md:font-mono max-md:text-[14px] max-md:font-normal",
                done ? "text-ink-4" : "bg-fill text-ink-2 max-md:text-ink",
              )}
            >
              {formatClock(task.startTime)}
            </span>
          )}
          {trailing}
        </motion.div>
      </ContextMenu>
      </div>
      <AnimatePresence initial={false}>
        {expanded && task.subtasks.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.layout}
            className="overflow-hidden"
          >
            <div className="pr-1 pb-2 pl-[38px]">
              {task.subtasks.map((sub) => (
                <div key={sub.id} className="flex items-center gap-1 rounded-[calc(var(--radius-ctl)_-_1px)] py-0.5 pr-2 hover:bg-fill/70">
                  <TaskCheck
                    size={14}
                    checked={sub.isDone || task.isDone}
                    onToggle={() => toggleSubtask(task.id, sub.id)}
                  />
                  <span className={cn("truncate text-xs", sub.isDone ? "text-ink-3 line-through" : "text-ink-2")}>
                    {sub.title}
                  </span>
                  {sub.date && (
                    <span className="ml-auto shrink-0 text-2xs text-ink-3">{relativeDay(sub.date)}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/** The lifted copy that follows the pointer while dragging. */
export function TaskDragPreview({ task }: { task: Task }) {
  const projects = useProjectMap();
  const project = task.projectId ? projects.get(task.projectId) : undefined;
  return (
    <div className="flex w-[300px] cursor-grabbing items-center gap-2.5 rounded-[calc(var(--radius-ctl)_+_2px)] bg-raised px-3 py-2 shadow-lift">
      <span className="size-[15px] shrink-0 rounded-[4px] border-[1.5px] border-ink-4" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
      {project && <span className="size-[7px] shrink-0 rounded-full" style={{ background: argbToCss(project.colorValue) }} />}
      {task.startTime && <span className="text-xs text-ink-3 tnum">{formatClock(task.startTime)}</span>}
    </div>
  );
}

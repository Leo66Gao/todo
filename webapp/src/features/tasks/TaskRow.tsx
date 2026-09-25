"use client";

import { memo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useDraggable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, CornerDownRight, FileText, GraduationCap, ListChecks, Timer } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import type { Task } from "@/lib/model";
import { dueLabel, formatClock, formatDuration, relativeDay, sameDay } from "@/lib/time";
import { isEmptyContent } from "@/lib/delta";
import { useNavigate } from "@/shell/nav";
import { ui, useUI } from "@/shell/ui";
import { toggleSubtask, toggleTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { springs } from "@/ui/motion";
import { ContextMenu } from "@/ui/overlay";
import { editTask, openTask, taskMenu } from "./actions";
import { priorityColor, useLabelMap, useProjectMap } from "./meta";
import { TaskCheck } from "./TaskCheck";

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

  const onClick = (e: React.MouseEvent) => {
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
      <span key="dur" className="flex items-center gap-1">
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

  return (
    <div ref={dragRef} style={dragStyle} className={cn("relative", dragging && "z-10 opacity-40")}>
      <ContextMenu items={() => taskMenu(task, navigate)}>
        <div
          {...dragProps}
          role="button"
          tabIndex={-1}
          data-task-id={task.id}
          onClick={onClick}
          className={cn(
            "group relative flex items-start gap-1.5 rounded-[9px] pr-2.5 pl-1 outline-none transition-colors duration-100",
            compact ? "py-1" : "py-[7px]",
            inspected ? "bg-accent-soft" : selected ? "bg-fill" : "hover:bg-fill/70",
          )}
        >
          <TaskCheck checked={done} color={check} onToggle={toggle} className="-my-0.5" />
          <div className="min-w-0 flex-1 pt-[3px]">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "relative min-w-0 truncate text-sm font-medium transition-colors duration-200",
                  done ? "text-ink-3" : "text-ink",
                )}
              >
                {task.title}
                <motion.span
                  aria-hidden
                  className="absolute top-1/2 left-0 h-px bg-ink-3"
                  initial={false}
                  animate={{ width: done ? "100%" : "0%" }}
                  transition={{ duration: 0.22, ease: [0.3, 0.8, 0.3, 1] }}
                />
              </span>
            </div>
            {meta.length > 0 && !compact && (
              <div className="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                {meta}
              </div>
            )}
          </div>
          {task.startTime && settings.showTime && (
            <span
              className={cn(
                "mt-[3px] shrink-0 rounded-[6px] px-1.5 py-px text-xs font-medium tnum",
                done ? "text-ink-4" : "bg-fill text-ink-2",
              )}
            >
              {formatClock(task.startTime)}
            </span>
          )}
          {trailing}
        </div>
      </ContextMenu>
      <AnimatePresence initial={false}>
        {expanded && task.subtasks.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.layout}
            className="overflow-hidden"
          >
            <div className="pb-1.5 pl-[34px]">
              {task.subtasks.map((sub) => (
                <div key={sub.id} className="flex items-center gap-1 rounded-[7px] py-0.5 pr-2 hover:bg-fill/70">
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
    <div className="flex w-[300px] cursor-grabbing items-center gap-2.5 rounded-[10px] bg-raised px-3 py-2 shadow-lift">
      <span className="size-[15px] shrink-0 rounded-[4px] border-[1.5px] border-ink-4" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
      {project && <span className="size-[7px] shrink-0 rounded-full" style={{ background: argbToCss(project.colorValue) }} />}
      {task.startTime && <span className="text-xs text-ink-3 tnum">{formatClock(task.startTime)}</span>}
    </div>
  );
}

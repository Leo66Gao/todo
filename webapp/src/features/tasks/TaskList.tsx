"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronRight } from "lucide-react";
import type { Task } from "@/lib/model";
import { useUI } from "@/shell/ui";
import { cn } from "@/ui/cn";
import { springs } from "@/ui/motion";
import { TaskRow } from "./TaskRow";

/**
 * A run of task rows. Rows animate in and out, and slide into place when the
 * list reflows (completion, reordering, sync).
 */
export function TaskList({
  tasks,
  sortable,
  showDate,
  trailing,
  id,
  plain,
}: {
  tasks: Task[];
  sortable?: boolean;
  showDate?: boolean;
  trailing?: (task: Task) => ReactNode;
  id?: string;
  plain?: boolean;
}) {
  const dragging = useUI((s) => s.dragging);
  const rows = (
    <AnimatePresence initial={false}>
      {tasks.map((task) => (
        <motion.div
          key={task.id}
          layout={dragging ? false : "position"}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } }}
          transition={springs.layout}
        >
          <TaskRow
            task={task}
            sortable={sortable && !task.milestone}
            showDate={showDate}
            plain={plain}
            trailing={trailing?.(task)}
          />
        </motion.div>
      ))}
    </AnimatePresence>
  );
  const body = <div className={plain ? undefined : "task-stack"}>{rows}</div>;
  if (!sortable) return body;
  return (
    <SortableContext id={id} items={tasks.filter((t) => !t.milestone).map((t) => t.id)} strategy={verticalListSortingStrategy}>
      {body}
    </SortableContext>
  );
}

export function Section({
  title,
  count,
  children,
  collapsible,
  defaultOpen = true,
  action,
  className,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const heading = (
    <span className="flex items-center gap-1.5">
      {collapsible && (
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={springs.snappy} className="flex text-ink-3">
          <ChevronRight className="size-3.5" />
        </motion.span>
      )}
      <span className="text-[11px] font-semibold tracking-[0.11em] text-ink-3 uppercase">{title}</span>
      {count != null && <span className="text-[11px] font-semibold text-ink-3/70 tnum">{count}</span>}
    </span>
  );
  return (
    <motion.section layout="position" transition={springs.layout} className={cn("mt-5 first:mt-0", className)}>
      <div className="flex h-7 items-center justify-between pr-1 pl-2 max-md:mb-1 max-md:pl-1">
        {collapsible ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="-ml-1 rounded-[6px] px-1 py-0.5 hover:bg-fill">
            {heading}
          </button>
        ) : (
          heading
        )}
        {action}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.layout}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

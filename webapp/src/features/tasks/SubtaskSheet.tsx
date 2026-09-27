"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Flag, X } from "lucide-react";
import { PRIORITIES, type Priority } from "@/lib/dart";
import { uuid, type Subtask, type Task } from "@/lib/model";
import { startOfDay } from "@/lib/time";
import { addSubtaskFull, deleteSubtask, updateSubtask } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Menu, Modal, Popover } from "@/ui/overlay";
import { DatePanel } from "@/ui/pickers";
import { DifficultyField } from "./fields";
import { PRIORITY_LABEL, priorityColor } from "./meta";

/**
 * Adds or edits one of an assignment's subtasks, as in the phone app: its
 * title, an optional milestone date (which puts it on that day as a task of
 * its own), and a difficulty and priority of its own.
 */
export function SubtaskSheet({
  task,
  existing,
  open,
  onOpenChange,
}: {
  task: Task;
  existing: Subtask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} width={440} label={existing ? "Edit subtask" : "New subtask"}>
      {open && <SheetBody key={existing?.id ?? "new"} task={task} existing={existing} close={() => onOpenChange(false)} />}
    </Modal>
  );
}

function SheetBody({ task, existing, close }: { task: Task; existing: Subtask | null; close: () => void }) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [date, setDate] = useState<Date | null>(existing?.date ?? null);
  const [difficulty, setDifficulty] = useState<number | null>(existing?.difficulty ?? null);
  const [priority, setPriority] = useState<Priority | null>(existing?.priority ?? null);
  const [dateOpen, setDateOpen] = useState(false);

  const save = () => {
    const name = title.trim();
    if (!name) return;
    const sub: Subtask = {
      id: existing?.id ?? uuid(),
      title: name,
      isDone: existing?.isDone ?? false,
      date,
      priority,
      difficulty,
    };
    if (existing) updateSubtask(task.id, sub);
    else addSubtaskFull(task.id, sub);
    close();
  };

  return (
    <form
      className="flex flex-col gap-3 px-5 pt-4 pb-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="text-lg font-semibold tracking-[-0.01em]">{existing ? "Edit subtask" : "New subtask"}</div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={(e) => {
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
        }}
        placeholder="What step comes next?"
        className="h-12 rounded-[14px] bg-fill px-3.5 text-base outline-none placeholder:text-ink-3 focus:shadow-[inset_0_0_0_1px_var(--line-strong)]"
      />

      <div className="flex items-center gap-2">
        <Popover
          open={dateOpen}
          onOpenChange={setDateOpen}
          trigger={
            <button
              type="button"
              className={cn(
                "flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border border-line px-3.5 text-left text-[15px] transition-colors hover:bg-fill",
                date ? "text-ink" : "text-ink-3",
              )}
            >
              <Flag className="size-4 shrink-0 text-ink-3" />
              <span className="truncate">{date ? `Milestone · ${format(date, "EEE d MMM")}` : "No milestone date"}</span>
            </button>
          }
        >
          <DatePanel
            value={date ?? task.date}
            onPick={(d) => {
              setDate(startOfDay(d));
              setDateOpen(false);
            }}
          />
        </Popover>
        {date && (
          <button
            type="button"
            aria-label="Remove the milestone date"
            onClick={() => setDate(null)}
            className="flex size-11 shrink-0 items-center justify-center rounded-[14px] border border-line text-ink-3 transition-colors hover:bg-fill hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div className="rounded-[14px] border border-line px-3.5 pt-2 pb-2.5">
        <div className="mb-1 text-xs font-medium text-ink-3">Difficulty{difficulty == null && " · same as the assignment"}</div>
        <DifficultyField level={difficulty ?? 2} active={difficulty != null} onChange={setDifficulty} onClear={() => setDifficulty(null)} />
      </div>

      <Menu
        trigger={
          <button
            type="button"
            className="flex h-11 items-center gap-2.5 rounded-[14px] border border-line px-3.5 text-left text-[15px] transition-colors hover:bg-fill data-[state=open]:bg-fill"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: priority && priority !== "none" ? priorityColor(priority) : "var(--ink-4)" }}
            />
            <span className={cn("flex-1 truncate", !priority && "text-ink-3")}>
              {priority ? `${PRIORITY_LABEL[priority]} priority` : "Priority: same as the assignment"}
            </span>
            <ChevronDown className="size-4 text-ink-3" />
          </button>
        }
        items={[
          { label: "Same as the assignment", checked: priority == null, onSelect: () => setPriority(null) },
          { separator: true },
          ...PRIORITIES.filter((p) => p !== "none").map((p) => ({
            label: PRIORITY_LABEL[p],
            swatch: priorityColor(p),
            checked: priority === p,
            onSelect: () => setPriority(p),
          })),
        ]}
      />

      <button
        type="submit"
        disabled={!title.trim()}
        className="mt-2 h-12 rounded-[16px] bg-ink text-[15px] font-semibold text-on-ink transition-[opacity,transform] active:scale-[0.99] disabled:opacity-40"
      >
        {existing ? "Save subtask" : "Add subtask"}
      </button>
      {existing && (
        <button
          type="button"
          className="h-10 rounded-[14px] text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
          onClick={() => {
            deleteSubtask(task.id, existing.id);
            close();
          }}
        >
          Delete subtask
        </button>
      )}
    </form>
  );
}

"use client";

// Subtasks you can rename in place and drag into order: a sortable list used
// by the inspector (saved as you go) and the task editor (saved with the task).

import { useRef, useState, type ReactNode } from "react";
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, X } from "lucide-react";
import { uuid, type Subtask } from "@/lib/model";
import { restrictToVerticalAxis } from "@/features/settings/restrict";
import { IconButton } from "@/ui/controls";
import { cn } from "@/ui/cn";
import { TaskCheck } from "./TaskCheck";

export type DragHandle = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;

/** A list whose items are dragged into a new order by a handle each item places. */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  children,
  className,
}: {
  items: T[];
  onReorder: (orderedIds: string[]) => void;
  children: (item: T, handle: DragHandle) => ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // (A touch holds a moment first, so the list still scrolls.)
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const ids = items.map((i) => i.id);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item) => (
            <SortableItem key={item.id} id={item.id}>
              {(handle) => children(item, handle)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, children }: { id: string; children: (handle: DragHandle) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-80")}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

/** The grip a row is dragged by (shown on hover; held a moment on touch). */
export function Grip({ handle, className }: { handle: DragHandle; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Drag to reorder"
      data-no-press
      {...handle.attributes}
      {...handle.listeners}
      className={cn(
        "flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-ink-4 transition-opacity hover:text-ink-3 active:cursor-grabbing",
        "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100",
        className,
      )}
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

/**
 * The task editor's subtasks, part of the task being edited: each title is a
 * field, Enter adds the next one, Backspace on an empty one removes it, and
 * the grip drags it into order.
 */
export function SubtaskEditor({ value, onChange, parentDone = false }: { value: Subtask[]; onChange: (next: Subtask[]) => void; parentDone?: boolean }) {
  const [draft, setDraft] = useState("");
  const fields = useRef(new Map<string, HTMLInputElement>());
  const focus = (id: string) => requestAnimationFrame(() => fields.current.get(id)?.focus());
  const update = (id: string, patch: Partial<Subtask>) => onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => onChange(value.filter((s) => s.id !== id));
  const blank = (): Subtask => ({ id: uuid(), title: "", isDone: false, date: null, priority: null, difficulty: null });
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onChange([...value, { ...blank(), title }]);
    setDraft("");
  };
  return (
    <div className="-ml-4">
      <SortableList items={value} onReorder={(ids) => onChange(ids.map((id) => value.find((s) => s.id === id)!))}>
        {(sub, handle) => (
          <div className="group flex min-h-8 items-center gap-1 rounded-box pr-1 transition-colors focus-within:bg-fill/60 hover:bg-fill/40">
            <Grip handle={handle} />
            <TaskCheck size={15} checked={sub.isDone || parentDone} onToggle={() => update(sub.id, { isDone: !sub.isDone })} label={sub.title || "Subtask"} />
            <input
              ref={(el) => {
                if (el) fields.current.set(sub.id, el);
                else fields.current.delete(sub.id);
              }}
              value={sub.title}
              onChange={(e) => update(sub.id, { title: e.target.value })}
              onBlur={() => {
                if (!sub.title.trim()) remove(sub.id);
              }}
              onKeyDown={(e) => {
                const at = value.findIndex((s) => s.id === sub.id);
                if (e.key === "Enter") {
                  // (Not the form's Enter, which saves the task.)
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.metaKey || e.ctrlKey) return;
                  const next = blank();
                  onChange([...value.slice(0, at + 1), next, ...value.slice(at + 1)]);
                  focus(next.id);
                } else if (e.key === "Backspace" && sub.title === "") {
                  e.preventDefault();
                  remove(sub.id);
                  const before = value[at - 1];
                  if (before) focus(before.id);
                }
              }}
              placeholder="Subtask"
              className={cn(
                "h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-4",
                sub.isDone ? "text-ink-3 line-through decoration-ink-4" : "text-ink",
              )}
            />
            <IconButton label="Delete subtask" size="sm" className="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100" onClick={() => remove(sub.id)}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        )}
      </SortableList>
      <div className="flex items-center gap-1 pl-4">
        <span className="flex size-[23px] shrink-0 items-center justify-center text-ink-3">
          <Plus className="size-3.5" />
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.stopPropagation();
              add();
            }
          }}
          placeholder="Add a subtask"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
        />
      </div>
    </div>
  );
}

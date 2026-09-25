"use client";

import { format } from "date-fns";
import { ChevronLeft, MoreHorizontal, Pencil } from "lucide-react";
import { daysFromToday, dueLabel, isOverdue } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui } from "@/shell/ui";
import { taskMenu } from "@/features/tasks/actions";
import { TaskDetail } from "@/features/tasks/Inspector";
import { toggleTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, IconButton } from "@/ui/controls";
import { Menu, Tooltip } from "@/ui/overlay";

export function AssignmentView({ id }: { id: string }) {
  const task = useWorkspace((s) => s.tasks.find((t) => t.id === id));
  const navigate = useNavigate();
  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 text-ink-3" icon={<ChevronLeft className="size-4" />} onClick={() => navigate({ view: "assignments" })}>
      Assignments
    </Button>
  );
  if (!task) {
    return (
      <>
        <PageHeader title="" leading={back} />
        <p className="px-6 py-10 text-sm text-ink-3">This assignment was deleted or hasn’t synced to this device yet.</p>
      </>
    );
  }
  const overdue = isOverdue(task.date, task.isDone);
  const days = daysFromToday(task.date);
  return (
    <>
      <PageHeader
        title=""
        leading={back}
        actions={
          <>
            <Button variant={task.isDone ? "secondary" : "primary"} onClick={() => toggleTask(task.id)}>
              {task.isDone ? "Mark as not done" : "Mark as done"}
            </Button>
            <Tooltip label="Edit all fields">
              <IconButton label="Edit assignment" onClick={() => ui.editTask(task.id)}>
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
              items={taskMenu(task, navigate)
                .filter((i) => !("label" in i) || (i.label !== "Open" && i.label !== "Open assignment"))
                .map((i) =>
                  "label" in i && i.label === "Delete"
                    ? { ...i, onSelect: () => {
                        i.onSelect?.();
                        navigate({ view: "assignments" });
                      } }
                    : i,
                )}
            />
          </>
        }
      />
      <div className="scroll-area flex-1 pb-24">
        <div className="mx-auto w-full max-w-[720px] px-6 pt-2 max-sm:px-4">
          <p className={cn("px-0 pb-1 text-sm", task.isDone ? "text-ink-3" : overdue ? "text-danger" : days <= 2 ? "text-ink" : "text-ink-2")}>
            {task.isDone ? "Completed" : `Due ${format(task.date, "EEEE d MMMM")}`}
            {!task.isDone && <span className="text-ink-3">, {dueLabel(task.date).toLowerCase()}</span>}
          </p>
          <TaskDetail taskId={task.id} variant="page" />
        </div>
      </div>
    </>
  );
}

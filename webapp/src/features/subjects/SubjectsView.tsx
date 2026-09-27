"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import type { Project } from "@/lib/model";
import { isOverdue, relativeDay } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { useAllTasks } from "@/features/tasks/meta";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/controls";
import { ContextMenu } from "@/ui/overlay";
import { createSubject, subjectMenu } from "./subjectActions";

export function SubjectsView() {
  const navigate = useNavigate();
  const projects = useWorkspace((s) => s.projects);
  const notes = useWorkspace((s) => s.notes);
  const all = useAllTasks();

  const summary = useMemo(() => {
    const map = new Map<string, { open: number; overdue: number; next: Date | null; notes: number }>();
    for (const p of projects) map.set(p.id, { open: 0, overdue: 0, next: null, notes: 0 });
    for (const t of all) {
      if (t.isDone || !t.projectId || t.parentTaskId) continue;
      const entry = map.get(t.projectId);
      if (!entry) continue;
      entry.open++;
      if (isOverdue(t.date)) entry.overdue++;
      else if (!entry.next || t.date < entry.next) entry.next = t.date;
    }
    for (const n of notes) if (n.subjectId && map.has(n.subjectId)) map.get(n.subjectId)!.notes++;
    return map;
  }, [projects, notes, all]);

  return (
    <>
      <PageHeader
        title="Subjects"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={async () => {
            const p = await createSubject();
            if (p) navigate({ view: "subject", id: p.id });
          }}>
            <span className="max-sm:hidden">New subject</span>
          </Button>
        }
      />
      <div className="scroll-area flex-1 pb-bar">
        <div className="mx-auto w-full max-w-[900px] px-6 max-sm:px-3">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <p className="text-sm font-medium">No subjects yet</p>
              <p className="mt-1 text-xs text-ink-3">Subjects group tasks, assignments and notes for a class.</p>
              <Button className="mt-4" icon={<Plus className="size-4" />} onClick={() => void createSubject()}>
                New subject
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1 xl:grid-cols-3">
              {projects.map((p) => (
                <SubjectTile key={p.id} project={p} info={summary.get(p.id)!} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SubjectTile({
  project,
  info,
}: {
  project: Project;
  info: { open: number; overdue: number; next: Date | null; notes: number };
}) {
  const navigate = useNavigate();
  return (
    <ContextMenu items={() => subjectMenu(project, navigate)}>
      <button
        type="button"
        onClick={() => navigate({ view: "subject", id: project.id })}
        className="group flex flex-col rounded-[calc(var(--radius-ctl)_+_4px)] border border-line px-4 py-3.5 text-left transition-[background-color,border-color,transform] duration-150 hover:border-line-strong hover:bg-fill/40 active:scale-[0.99]"
      >
        <span className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full" style={{ background: argbToCss(project.colorValue) }} />
          <span className="truncate text-sm font-semibold">{project.title}</span>
        </span>
        <span className="mt-3 flex items-end justify-between gap-3 text-xs text-ink-3">
          <span className="flex gap-3">
            <span>
              <span className="font-medium text-ink tnum">{info.open}</span> open
            </span>
            <span>
              <span className="font-medium text-ink tnum">{info.notes}</span> {info.notes === 1 ? "note" : "notes"}
            </span>
          </span>
          <span className={cn(info.overdue > 0 && "text-danger")}>
            {info.overdue > 0
              ? `${info.overdue} overdue`
              : info.next
                ? `Next ${relativeDay(info.next).length > 9 ? format(info.next, "d MMM") : relativeDay(info.next).toLowerCase()}`
                : "Nothing due"}
          </span>
        </span>
      </button>
    </ContextMenu>
  );
}

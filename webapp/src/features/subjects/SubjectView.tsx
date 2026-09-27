"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, Folder, FolderPlus, MoreHorizontal, Plus, FilePlus2 } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { uuid } from "@/lib/model";
import { isOverdue } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui } from "@/shell/ui";
import { useAllTasks } from "@/features/tasks/meta";
import { Section, TaskList } from "@/features/tasks/TaskList";
import { createNote } from "@/features/notes/noteActions";
import { NoteRow } from "@/features/notes/NoteRow";
import { addFolder, deleteFolder, renameFolder, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { confirmDialog, ContextMenu, Menu, promptDialog } from "@/ui/overlay";
import { deleteSubject, editSubject } from "./subjectActions";

export function SubjectView({ id }: { id: string }) {
  const navigate = useNavigate();
  const project = useWorkspace((s) => s.projects.find((p) => p.id === id));
  const notes = useWorkspace((s) => s.notes);
  const folders = useWorkspace((s) => s.folders);
  const all = useAllTasks();
  const [folderId, setFolderId] = useState<string | "all">("all");

  // Milestones count as the subject's work too (they carry their assignment's subject).
  const tasks = useMemo(() => all.filter((t) => t.projectId === id), [all, id]);
  const overdue = tasks.filter((t) => isOverdue(t.date, t.isDone)).sort((a, b) => a.date.getTime() - b.date.getTime());
  const upcoming = tasks
    .filter((t) => !t.isDone && !isOverdue(t.date))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0));
  const done = tasks.filter((t) => t.isDone).sort((a, b) => b.date.getTime() - a.date.getTime());
  const subjectFolders = folders.filter((f) => f.subjectId === id);
  const subjectNotes = notes
    .filter((n) => n.subjectId === id && (folderId === "all" || n.folderId === folderId))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  useEffect(() => {
    ui.set({ visibleOrder: [...overdue, ...upcoming, ...done].map((t) => t.id) });
  }, [overdue, upcoming, done]);

  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 text-ink-3" icon={<ChevronLeft className="size-4" />} onClick={() => navigate({ view: "subjects" })}>
      Subjects
    </Button>
  );
  if (!project) {
    return (
      <>
        <PageHeader title="" leading={back} />
        <p className="px-6 py-10 text-sm text-ink-3">This subject was deleted or hasn’t synced to this device yet.</p>
      </>
    );
  }

  const newFolder = async () => {
    const name = await promptDialog({ title: "New folder", placeholder: "Folder name", confirmLabel: "Create folder" });
    if (!name) return;
    const folder = { id: uuid(), name, subjectId: id, createdAt: new Date() };
    addFolder(folder);
    setFolderId(folder.id);
  };

  return (
    <>
      <PageHeader
        leading={back}
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: argbToCss(project.colorValue) }} />
            <span className="truncate">{project.title}</span>
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              aria-label="New note"
              icon={<FilePlus2 className="size-4 sm:hidden" />}
              className="max-sm:w-[30px] max-sm:px-0"
              onClick={() => createNote(navigate, { subjectId: id, folderId: folderId === "all" ? null : folderId })}
            >
              <span className="max-sm:hidden">New note</span>
            </Button>
            <Button variant="primary" className="max-md:hidden" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ projectId: id })}>
              <span className="max-sm:hidden">New task</span>
            </Button>
            <Menu
              align="end"
              trigger={
                <IconButton label="Subject options">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              }
              items={[
                { label: "Edit subject…", onSelect: () => void editSubject(project) },
                { label: "Delete subject…", destructive: true, onSelect: () => void deleteSubject(project, navigate) },
              ]}
            />
          </>
        }
      />
      <div className="scroll-area flex-1 pb-bar">
        <div className="mx-auto grid w-full max-w-[1100px] grid-cols-[minmax(0,1fr)_minmax(0,380px)] gap-10 px-6 max-lg:grid-cols-1 max-md:px-4">
          <div>
            {tasks.length === 0 && (
              <div className="rounded-[calc(var(--radius-ctl)_+_4px)] border border-dashed border-line-strong px-4 py-8 text-center">
                <p className="text-sm font-medium">No tasks in {project.title}</p>
                <Button className="mt-3" size="sm" icon={<Plus className="size-3.5" />} onClick={() => ui.newTask({ projectId: id })}>
                  New task
                </Button>
              </div>
            )}
            {overdue.length > 0 && (
              <Section title="Overdue" count={overdue.length}>
                <TaskList tasks={overdue} showDate />
              </Section>
            )}
            {upcoming.length > 0 && (
              <Section title="Coming up" count={upcoming.length}>
                <TaskList tasks={upcoming} showDate />
              </Section>
            )}
            {done.length > 0 && (
              <Section title="Completed" count={done.length} collapsible defaultOpen={false}>
                <TaskList tasks={done} showDate />
              </Section>
            )}
          </div>

          <div>
            <div className="flex h-7 items-center justify-between pl-2">
              <span className="text-xs font-semibold text-ink-2">Notes</span>
              <span className="text-xs text-ink-3 tnum">{subjectNotes.length}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 px-1">
              <FolderChip label="All" active={folderId === "all"} onClick={() => setFolderId("all")} />
              {subjectFolders.map((f) => (
                <ContextMenu
                  key={f.id}
                  items={[
                    {
                      label: "Rename…",
                      onSelect: async () => {
                        const name = await promptDialog({ title: "Rename folder", initial: f.name, confirmLabel: "Rename" });
                        if (name) renameFolder(f.id, name);
                      },
                    },
                    {
                      label: "Delete folder…",
                      destructive: true,
                      onSelect: async () => {
                        const ok = await confirmDialog({
                          title: `Delete “${f.name}”?`,
                          message: "Notes inside stay in this subject, outside any folder.",
                          confirmLabel: "Delete folder",
                          destructive: true,
                        });
                        if (ok) {
                          deleteFolder(f.id);
                          if (folderId === f.id) setFolderId("all");
                        }
                      },
                    },
                  ]}
                >
                  <span>
                    <FolderChip label={f.name} icon active={folderId === f.id} onClick={() => setFolderId(f.id)} />
                  </span>
                </ContextMenu>
              ))}
              <button
                type="button"
                onClick={() => void newFolder()}
                className="flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-xs text-ink-3 transition-colors hover:bg-fill hover:text-ink-2"
              >
                <FolderPlus className="size-3.5" />
                Folder
              </button>
            </div>
            <div className={cn("mt-2", subjectNotes.length > 0 && "note-group card")}>
              <AnimatePresence initial={false} mode="popLayout">
                {subjectNotes.map((n) => (
                  <motion.div
                    key={n.id}
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={springs.layout}
                  >
                    <NoteRow note={n} showSubject={false} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {subjectNotes.length === 0 && (
                <button
                  type="button"
                  onClick={() => createNote(navigate, { subjectId: id, folderId: folderId === "all" ? null : folderId })}
                  className="flex h-9 w-full items-center gap-2.5 rounded-[9px] px-3 text-sm text-ink-3 transition-colors hover:bg-fill/70 hover:text-ink-2"
                >
                  <Plus className="size-4" />
                  {folderId === "all" ? "Write the first note" : "Add a note to this folder"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function FolderChip({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-[7px] border px-2.5 text-xs font-medium transition-colors",
        active ? "border-ink bg-ink text-on-ink" : "border-line-strong text-ink-2 hover:border-ink-4 hover:text-ink",
      )}
    >
      {icon && <Folder className="size-3" />}
      {label}
    </button>
  );
}

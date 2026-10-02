"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BookOpen,
  ChevronLeft,
  Code2,
  FilePlus2,
  File as FileGlyph,
  FileText,
  Folder,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Pin,
  Play,
  Plus,
  Presentation,
  Search,
  Sheet,
  type LucideIcon,
} from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { plainText } from "@/lib/delta";
import type { Material, Project, StudyNote } from "@/lib/model";
import { uuid } from "@/lib/model";
import { isOverdue } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { ui } from "@/shell/ui";
import { useAllTasks } from "@/features/tasks/meta";
import { TaskList } from "@/features/tasks/TaskList";
import { createNote, editedLabel, pinnedFirst, removeNote, togglePin } from "@/features/notes/noteActions";
import { NoteRow } from "@/features/notes/NoteRow";
import { addFolder, captureWorkspaceSession, deleteFolder, renameFolder, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { confirmDialog, ContextMenu, Menu, Modal, promptDialog, type MenuItem } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { PHONE, useMedia } from "@/ui/useMedia";
import {
  looksLikePath,
  looksLikeUrl,
  materialKind,
  moveMaterial,
  normalizeUrl,
  removeMaterial,
  saveMaterial,
  setDescription,
  siteOf,
  titleFromPath,
  titleFromUrl,
  type MaterialKind,
} from "./materials";
import { canLinkFiles, closeFileViewer, copyPath, forgetFile, linkFile, loadLinkedFiles, openFile, useFileViewer, useLinkedFiles } from "./localFiles";
import { deleteSubject, editSubject } from "./subjectActions";

/** How many open tasks show before "Show all" (fewer on phones, where rows are taller). */
const TASKS_SHOWN = 4;
const TASKS_SHOWN_PHONE = 3;

export function SubjectView({ id }: { id: string }) {
  const navigate = useNavigate();
  const project = useWorkspace((s) => s.projects.find((p) => p.id === id));
  const notes = useWorkspace((s) => s.notes);
  const folders = useWorkspace((s) => s.folders);
  const all = useAllTasks();
  const [folderId, setFolderId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");

  // Milestones count as the subject's work too (they carry their assignment's subject).
  const tasks = useMemo(() => all.filter((t) => t.projectId === id), [all, id]);
  const open = useMemo(
    () =>
      tasks
        .filter((t) => !t.isDone)
        .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0)),
    [tasks],
  );
  const done = useMemo(() => tasks.filter((t) => t.isDone).sort((a, b) => b.date.getTime() - a.date.getTime()), [tasks]);

  const subjectNotes = useMemo(() => notes.filter((n) => n.subjectId === id), [notes, id]);
  const pinned = useMemo(() => subjectNotes.filter((n) => n.pinnedAt).sort(pinnedFirst), [subjectNotes]);
  const subjectFolders = folders.filter((f) => f.subjectId === id);
  const q = query.trim().toLowerCase();
  const listed = subjectNotes
    .filter((n) => folderId === "all" || n.folderId === folderId)
    // Pinned notes have their own row at the top, unless you're looking for something.
    .filter((n) => (q ? n.title.toLowerCase().includes(q) || plainText(n.content).toLowerCase().includes(q) : folderId !== "all" || !n.pinnedAt))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  useEffect(() => {
    ui.set({ visibleOrder: [...open, ...done].map((t) => t.id) });
  }, [open, done]);

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

  const newNote = () => createNote(navigate, { subjectId: id, folderId: folderId === "all" ? null : folderId });
  const newFolder = async () => {
    const currentSession = captureWorkspaceSession();
    const name = await promptDialog({ title: "New folder", placeholder: "Folder name", confirmLabel: "Create folder" });
    if (!name || !currentSession() || !useWorkspace.getState().projects.some((p) => p.id === id)) return;
    const folder = { id: uuid(), name, subjectId: id, createdAt: new Date() };
    addFolder(folder);
    setFolderId(folder.id);
  };

  const color = argbToCss(project.colorValue);

  return (
    <>
      <PageHeader
        leading={back}
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{project.title}</span>
          </span>
        }
        actions={
          <>
            <Button
              variant="primary"
              aria-label="New note"
              icon={<FilePlus2 className="size-4" />}
              className="max-md:w-[30px] max-md:px-0"
              onClick={newNote}
            >
              <span className="max-md:hidden">New note</span>
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
                { label: "Edit name and colour…", onSelect: () => void editSubject(project) },
                { label: "New folder…", onSelect: () => void newFolder() },
                { separator: true },
                { label: "Delete subject…", destructive: true, onSelect: () => void deleteSubject(project, navigate) },
              ]}
            />
          </>
        }
      />
      <div className="scroll-area flex-1 pb-bar">
        <div className="mx-auto w-full max-w-[1100px] px-6 max-sm:px-4">
          <Description project={project} />

          {/* Phones read top to bottom: pinned, what's due, materials, then every note. */}
          <div
            className={cn(
              "mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,340px)] items-start gap-x-10 gap-y-8 max-lg:grid-cols-1",
              pinned.length > 0 && "lg:grid-rows-[auto_1fr]",
            )}
          >
            {pinned.length > 0 && (
              <section className="min-w-0 lg:col-start-1 lg:row-start-1">
                <PanelHeading title="Pinned" count={pinned.length} />
                <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
                  <AnimatePresence initial={false} mode="popLayout">
                    {pinned.map((n) => (
                      <motion.div key={n.id} layout="position" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={springs.layout}>
                        <PinnedCard note={n} color={color} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}

            <aside className={cn("flex flex-col gap-8 lg:col-start-2 lg:row-start-1", pinned.length > 0 && "lg:row-span-2")}>
              <TasksPanel subjectId={id} open={open} done={done} />
              <MaterialsPanel project={project} />
            </aside>

            <div className={cn("min-w-0 lg:col-start-1", pinned.length > 0 ? "lg:row-start-2" : "lg:row-start-1")}>
              <section>
                <PanelHeading
                  title="Notes"
                  count={subjectNotes.length}
                  action={
                    <PanelAction icon={<Plus className="size-3.5" />} onClick={newNote}>
                      New note
                    </PanelAction>
                  }
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {(subjectFolders.length > 0 || subjectNotes.length > 4) && (
                    <label className="flex h-7 w-44 min-w-0 items-center gap-1.5 rounded-[7px] border border-line-strong px-2 text-xs transition-colors focus-within:border-ink-4 max-sm:w-full">
                      <Search className="size-3 shrink-0 text-ink-3" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${project.title}`}
                        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
                      />
                    </label>
                  )}
                  {subjectFolders.length > 0 && <FolderChip label="All" active={folderId === "all"} onClick={() => setFolderId("all")} />}
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
                <div className="mt-2.5">
                  <AnimatePresence initial={false} mode="popLayout">
                    {listed.map((n) => (
                      <motion.div key={n.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={springs.layout}>
                        <NoteRow note={n} showSubject={false} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {listed.length === 0 &&
                    (q ? (
                      <p className="px-1 py-3 text-sm text-ink-3">No notes here match “{query.trim()}”.</p>
                    ) : (
                      <button
                        type="button"
                        onClick={newNote}
                        className="flex w-full items-center gap-3 rounded-card border border-dashed border-line-strong px-4 py-5 text-left transition-colors hover:border-ink-4 hover:bg-fill/50"
                      >
                        <FilePlus2 className="size-5 shrink-0 text-ink-3" strokeWidth={1.6} />
                        <span>
                          <span className="block text-sm font-medium">
                            {folderId !== "all" ? "Add a note to this folder" : pinned.length ? "Every other note shows here" : "Write the first note"}
                          </span>
                          <span className="block text-xs text-ink-3">Pin the ones you open most to keep them at the top.</span>
                        </span>
                      </button>
                    ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Description

function Description({ project }: { project: Project }) {
  const [draft, setDraft] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const session = useRef<(() => boolean) | null>(null);
  const editing = draft != null;
  const text = project.description ?? "";

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  const commit = () => {
    if (draft == null) return;
    if (draft.trim() !== text && session.current?.()) setDescription(project.id, draft);
    setDraft(null);
  };

  return (
    <div className="max-w-[720px] pt-1">
      <textarea
        ref={field}
        rows={1}
        value={draft ?? text}
        placeholder="Add a description: what the course covers, where it meets, when the exam is…"
        onFocus={() => {
          session.current = captureWorkspaceSession();
          setDraft(text);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.currentTarget.blur();
          }
        }}
        aria-label="Subject description"
        className={cn(
          "-mx-2 block w-[calc(100%+16px)] resize-none overflow-hidden rounded-[9px] bg-transparent px-2 py-1.5 text-[15px] leading-[23px] text-ink-2 outline-none transition-colors placeholder:text-ink-4",
          "hover:bg-fill/60 focus:bg-card focus:text-ink focus:shadow-card",
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pinned notes

function PinnedCard({ note, color }: { note: StudyNote; color: string }) {
  const navigate = useNavigate();
  const preview = plainText(note.content);
  return (
    <ContextMenu
      items={() => [
        { label: "Open", onSelect: () => navigate({ view: "note", id: note.id }) },
        { label: "Unpin", onSelect: () => togglePin(note) },
        { separator: true },
        { label: "Delete note…", destructive: true, onSelect: () => void removeNote(note) },
      ]}
    >
      <div className="group relative h-full">
        <button
          type="button"
          onClick={() => navigate({ view: "note", id: note.id })}
          className="card relative flex h-[132px] w-full flex-col overflow-hidden px-4 pt-3.5 pb-3 text-left transition-[background,transform] hover:bg-[image:linear-gradient(var(--row-hover),var(--row-hover))] active:scale-[0.985]"
        >
          <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] opacity-70" style={{ background: color }} />
          <span className="truncate pr-6 text-sm font-semibold tracking-[-0.005em]">{note.title || "Untitled note"}</span>
          <span className="mt-1 line-clamp-3 text-xs leading-[18px] break-words text-ink-3">{preview || "No additional text"}</span>
          <span className="mt-auto pt-2 text-2xs text-ink-3">{editedLabel(note.updatedAt)}</span>
        </button>
        <button
          type="button"
          aria-label={`Unpin “${note.title || "Untitled note"}”`}
          onClick={() => togglePin(note)}
          className="absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-full text-ink-3 transition-[opacity,background] hover:bg-fill hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <Pin className="size-3.5 -rotate-45 fill-current" />
        </button>
      </div>
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// Tasks: what's next, kept short.

function TasksPanel({ subjectId, open, done }: { subjectId: string; open: ReturnType<typeof useAllTasks>; done: ReturnType<typeof useAllTasks> }) {
  const [expanded, setExpanded] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const limit = useMedia(PHONE) ? TASKS_SHOWN_PHONE : TASKS_SHOWN;
  const overdue = open.filter((t) => isOverdue(t.date, t.isDone)).length;
  const shown = expanded ? open : open.slice(0, limit);
  return (
    <section>
      <PanelHeading
        title="Up next"
        count={open.length || undefined}
        detail={overdue ? <span className="text-danger">{overdue} overdue</span> : undefined}
        action={
          <PanelAction icon={<Plus className="size-3.5" />} onClick={() => ui.newTask({ projectId: subjectId })}>
            Task
          </PanelAction>
        }
      />
      {open.length === 0 ? (
        <p className="px-1 text-sm text-ink-3">{done.length ? "All caught up." : "Nothing due."}</p>
      ) : (
        <TaskList tasks={shown} showDate hideSubject />
      )}
      <div className="mt-1.5 flex gap-1">
        {open.length > limit && (
          <PanelAction onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show all ${open.length}`}</PanelAction>
        )}
        {done.length > 0 && (
          <PanelAction onClick={() => setShowDone(!showDone)}>{showDone ? "Hide completed" : `Completed (${done.length})`}</PanelAction>
        )}
      </div>
      {showDone && done.length > 0 && (
        <div className="mt-1.5">
          <TaskList tasks={done} showDate hideSubject />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Materials

const KIND_ICON: Record<MaterialKind, LucideIcon> = {
  video: Play,
  doc: FileText,
  slides: Presentation,
  sheet: Sheet,
  pdf: FileText,
  code: Code2,
  link: Link2,
  file: FileGlyph,
  item: BookOpen,
};

function MaterialsPanel({ project }: { project: Project }) {
  const materials = project.materials ?? [];
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<Material | null>(null);
  const linked = useLinkedFiles((s) => s.handles);
  useEffect(() => void loadLinkedFiles(), []);

  const add = () => {
    const text = adding.trim();
    if (!text) return;
    const saved = looksLikePath(text)
      ? saveMaterial(project.id, { title: titleFromPath(text), path: text })
      : looksLikeUrl(text)
        ? saveMaterial(project.id, { title: titleFromUrl(text), url: text })
        : saveMaterial(project.id, { title: text });
    setAdding("");
    toast(`Added “${saved.title}”`, { label: "Edit", run: () => setEditing(saved) });
  };

  const menu = (m: Material, index: number): MenuItem[] => [
    ...(m.url ? [{ label: "Open link", onSelect: () => openLink(m.url!) }, { label: "Copy link", onSelect: () => void copy(m.url!) }] : []),
    ...(m.path
      ? [
          ...(canLinkFiles() ? [{ label: "Open file", onSelect: () => openFile(m) }] : []),
          { label: "Copy path", onSelect: () => void copyPath(m) },
          ...(canLinkFiles()
            ? [
                linked.has(m.id)
                  ? { label: "Forget the file on this computer", onSelect: () => forgetFile(m.id) }
                  : { label: "Choose the file on this computer…", onSelect: () => void linkFile(m) },
              ]
            : []),
        ]
      : []),
    { label: "Edit…", onSelect: () => setEditing(m) },
    { separator: true },
    { label: "Move up", disabled: index === 0, onSelect: () => moveMaterial(project.id, m.id, index - 1) },
    { label: "Move down", disabled: index === materials.length - 1, onSelect: () => moveMaterial(project.id, m.id, index + 1) },
    { separator: true },
    {
      label: "Remove",
      destructive: true,
      onSelect: () => {
        removeMaterial(project.id, m.id);
        toast(`Removed “${m.title}”`, { label: "Undo", run: () => { saveMaterial(project.id, m); moveMaterial(project.id, m.id, index); } });
      },
    },
  ];

  return (
    <section>
      <PanelHeading title="Materials" count={materials.length || undefined} />
      <ul className="flex flex-col">
        <AnimatePresence initial={false}>
          {materials.map((m, i) => {
            const Icon = KIND_ICON[materialKind(m)];
            return (
              <motion.li key={m.id} layout="position" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={springs.layout}>
                <ContextMenu items={() => menu(m, i)}>
                  <div className="group flex items-center rounded-[10px] transition-colors hover:bg-fill/70">
                    <button
                      type="button"
                      onClick={() => (m.url ? openLink(m.url) : m.path ? openFile(m) : setEditing(m))}
                      className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
                      title={m.url ?? m.path}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-card text-ink-2 shadow-card">
                        <Icon className="size-4" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{m.title}</span>
                        {(m.detail || m.url || m.path) && (
                          <span className="block truncate text-xs text-ink-3">{m.detail ?? (m.url ? siteOf(m.url) : shortPath(m.path!))}</span>
                        )}
                      </span>
                    </button>
                    <Menu
                      align="end"
                      trigger={
                        <button
                          type="button"
                          aria-label={`Options for “${m.title}”`}
                          className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3 transition-[opacity,background] hover:bg-fill hover:text-ink data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        >
                          <MoreHorizontal className="size-4" />
                        </button>
                      }
                      items={menu(m, i)}
                    />
                  </div>
                </ContextMenu>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      <form
        className="mt-1 flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors focus-within:bg-card focus-within:shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-dashed border-line-strong text-ink-3">
          <Plus className="size-4" />
        </span>
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder={materials.length ? "Paste a link, a file path, or name a book" : "Add course pages, files, readings, videos…"}
          aria-label="Add material: paste a link or type a name"
          enterKeyHint="done"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
        />
        {adding.trim() && (
          <Button type="submit" size="sm" variant="primary">
            Add
          </Button>
        )}
      </form>
      <MaterialDialog subjectId={project.id} material={editing} onClose={() => setEditing(null)} />
      <FileViewer />
    </section>
  );
}

function MaterialDialog({ subjectId, material, onClose }: { subjectId: string; material: Material | null; onClose: () => void }) {
  const [shown, setShown] = useState<Material | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [detail, setDetail] = useState("");
  // The account the dialog was opened in; a save after switching is dropped.
  const [session, setSession] = useState<(() => boolean) | null>(null);
  if (material && material !== shown) {
    setShown(material);
    setTitle(material.title);
    setUrl(material.url ?? material.path ?? "");
    setDetail(material.detail ?? "");
    setSession(() => captureWorkspaceSession());
  }
  const urlOk = !url.trim() || looksLikeUrl(url) || looksLikePath(url);
  const valid = title.trim().length > 0 && urlOk;
  const input =
    "mt-1 h-9 w-full rounded-ctl border border-line-strong bg-card px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft";
  return (
    <Modal open={material != null} onOpenChange={(o) => !o && onClose()} width={420} label="Edit material">
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !shown) return;
          const isPath = looksLikePath(url);
          if (session?.()) saveMaterial(subjectId, { ...shown, title, url: url.trim() && !isPath ? normalizeUrl(url) : undefined, path: isPath ? url : undefined, detail });
          onClose();
        }}
      >
        <h2 className="text-base font-semibold">Edit material</h2>
        <label className="mt-4 block text-xs font-medium text-ink-2">
          Name
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
        </label>
        <label className="mt-3 block text-xs font-medium text-ink-2">
          Link or file path
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or /Users/…" inputMode="url" className={cn(input, !urlOk && "border-danger")} />
        </label>
        <label className="mt-3 block text-xs font-medium text-ink-2">
          Detail
          <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Chapters 3–5, weekly reading, exam formula sheet…" className={input} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** "~/Physics/notes.pdf" for "/Users/leo/Physics/notes.pdf". */
function shortPath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^[A-Z]:\\Users\\[^\\]+/i, "~");
}

/** PDFs, pictures, text and video from a linked file, shown in the app. */
function FileViewer() {
  const file = useFileViewer((s) => s.file);
  const [shown, setShown] = useState(file);
  if (file && file !== shown) setShown(file);
  const f = file ?? shown;
  return (
    <Modal open={file != null} onOpenChange={(o) => !o && closeFileViewer()} width={980} label={f?.name ?? "File"} className="h-[min(86vh,900px)]">
      {f && (
        <>
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.name}</span>
            <Button size="sm" onClick={() => window.open(f.url, "_blank")}>
              Open in a new tab
            </Button>
            <Button size="sm" variant="ghost" onClick={closeFileViewer}>
              Close
            </Button>
          </div>
          <div className="min-h-0 flex-1 bg-fill">
            {f.type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.url} alt={f.name} className="size-full object-contain" />
            ) : f.type.startsWith("video/") ? (
              <video src={f.url} controls className="size-full" />
            ) : f.type.startsWith("audio/") ? (
              <div className="flex size-full items-center justify-center">
                <audio src={f.url} controls />
              </div>
            ) : (
              <iframe src={f.url} title={f.name} className="size-full border-0 bg-white" />
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function openLink(url: string) {
  window.open(url, "_blank", "noopener");
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Link copied");
  } catch {
    toast("Couldn’t copy the link.");
  }
}

// ---------------------------------------------------------------------------
// Pieces

function PanelHeading({ title, count, detail, action }: { title: string; count?: number; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex h-7 items-center gap-2 px-1">
      <h2 className="text-[11px] font-semibold tracking-[0.11em] text-ink-3 uppercase">{title}</h2>
      {count != null && <span className="text-[11px] font-semibold text-ink-3/70 tnum">{count}</span>}
      {detail && <span className="text-[11px] font-medium">{detail}</span>}
      <span className="flex-1" />
      {action}
    </div>
  );
}

function PanelAction({ children, icon, onClick }: { children: ReactNode; icon?: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 items-center gap-1 rounded-[7px] px-2 text-xs font-medium text-ink-3 transition-colors hover:bg-fill hover:text-ink"
    >
      {icon}
      {children}
    </button>
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

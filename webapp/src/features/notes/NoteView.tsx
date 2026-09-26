"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type QuillType from "quill";
import { ChevronDown, ChevronLeft, FileText, Folder, MoreHorizontal } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { isEmptyContent } from "@/lib/delta";
import { encodeNote, recordFits, uuid, type StudyNote } from "@/lib/model";
import { countWords, formatCount } from "@/lib/words";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { addFolder, addNote, deleteNote, updateNote, useWorkspace } from "@/store/workspace";
import { Button, IconButton } from "@/ui/controls";
import { cn } from "@/ui/cn";
import { Menu, Popover, promptDialog } from "@/ui/overlay";
import { noteHref, RichText, type NoteLinks } from "@/ui/RichText";
import { toast } from "@/ui/toast";
import { editedLabel, removeNote } from "./noteActions";

export function NoteView({ id }: { id: string }) {
  const note = useWorkspace((s) => s.notes.find((n) => n.id === id));
  const navigate = useNavigate();
  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 text-ink-3" icon={<ChevronLeft className="size-4" />} onClick={() => history.length > 1 ? history.back() : navigate({ view: "notes" })}>
      Back
    </Button>
  );
  if (!note) {
    return (
      <>
        <PageHeader title="" leading={back} />
        <p className="px-6 py-10 text-sm text-ink-3">This note was deleted or hasn’t synced to this device yet.</p>
      </>
    );
  }
  return <NoteEditor key={note.id} note={note} back={back} />;
}

function NoteEditor({ note, back }: { note: StudyNote; back: React.ReactNode }) {
  const navigate = useNavigate();
  const projects = useWorkspace((s) => s.projects);
  const folders = useWorkspace((s) => s.folders);
  const shownTitle = (t: string) => (t === "Untitled note" ? "" : t);
  const [title, setTitle] = useState(shownTitle(note.title));
  // Only the fields edited here are written back, so a change that arrives
  // from another device to the other field is never overwritten by a stale draft.
  const draft = useRef<{ title?: string; content?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedTitle, setSavedTitle] = useState(note.title);
  const [syncedTitle, setSyncedTitle] = useState(note.title);
  const [editingTitle, setEditingTitle] = useState(false);
  if (note.title !== syncedTitle) {
    setSyncedTitle(note.title);
    // A title that changed elsewhere replaces the field unless it's being typed in.
    if (note.title !== savedTitle && !editingTitle) setTitle(shownTitle(note.title));
  }

  const [quill, setQuill] = useState<QuillType | null>(null);
  const noteLinks = useMemo<NoteLinks>(
    () => ({
      search: (query) => {
        const { notes, projects } = useWorkspace.getState();
        const q = query.toLowerCase();
        return notes
          .filter((n) => n.id !== note.id && n.title.trim() && (!q || n.title.toLowerCase().includes(q)))
          .sort(
            (a, b) =>
              Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) ||
              b.updatedAt.getTime() - a.updatedAt.getTime(),
          )
          .map((n) => ({ id: n.id, title: n.title, hint: projects.find((p) => p.id === n.subjectId)?.title }));
      },
      create: (title) => {
        const now = new Date();
        const current = useWorkspace.getState().notes.find((n) => n.id === note.id);
        const created: StudyNote = {
          id: uuid(),
          title,
          content: "",
          subjectId: current?.subjectId ?? null,
          folderId: current?.folderId ?? null,
          attachments: [],
          createdAt: now,
          updatedAt: now,
        };
        addNote(created);
        return created.id;
      },
    }),
    [note.id],
  );

  const subject = projects.find((p) => p.id === note.subjectId);
  const subjectFolders = folders.filter((f) => f.subjectId === note.subjectId);
  const folder = folders.find((f) => f.id === note.folderId);

  const persist = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const pending = draft.current;
    if (pending.title === undefined && pending.content === undefined) return;
    const current = useWorkspace.getState().notes.find((n) => n.id === note.id);
    if (!current) return;
    const next: StudyNote = {
      ...current,
      title: pending.title !== undefined ? pending.title.trim() || "Untitled note" : current.title,
      content: pending.content ?? current.content,
      updatedAt: new Date(),
    };
    if (!recordFits(encodeNote(next))) {
      toast("This note is too large to sync. Keep it under 650 KB.");
      return;
    }
    draft.current = {};
    updateNote(next);
    setSavedTitle(next.title);
    setEditingTitle(false);
  };

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, 500);
  };

  // Save on leave; a note that was never written in is discarded.
  useEffect(
    () => () => {
      persist();
      const current = useWorkspace.getState().notes.find((n) => n.id === note.id);
      if (current && current.title.trim() === "" && isEmptyContent(current.content)) deleteNote(current.id);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        persist();
        toast("Saved");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportDocx = async () => {
    persist();
    const current = useWorkspace.getState().notes.find((n) => n.id === note.id) ?? note;
    try {
      const { fileName, noteToDocx, saveFile } = await import("@/lib/noteFiles");
      await saveFile(fileName(current.title, "docx"), await noteToDocx(current.title, current.content));
    } catch {
      toast("The Word document couldn’t be made.");
    }
  };
  const exportPdf = async () => {
    persist();
    const current = useWorkspace.getState().notes.find((n) => n.id === note.id) ?? note;
    try {
      const { printNote } = await import("@/lib/noteFiles");
      await printNote(current.title, current.content);
    } catch {
      toast("Printing isn’t available here.");
    }
  };

  const setSubject = (id: string | null) =>
    updateNote({ ...note, subjectId: id, folderId: null, updatedAt: new Date() });
  const setFolder = (id: string | null) => updateNote({ ...note, folderId: id, updatedAt: new Date() });
  const newFolder = async () => {
    const name = await promptDialog({ title: "New folder", placeholder: "Folder name", confirmLabel: "Create folder" });
    if (!name) return;
    const created = { id: uuid(), name, subjectId: note.subjectId, createdAt: new Date() };
    addFolder(created);
    setFolder(created.id);
  };

  return (
    <>
      <PageHeader
        title=""
        leading={back}
        actions={
          <>
            <Menu
              align="end"
              trigger={
                <Button variant="ghost" size="sm" className="text-ink-2">
                  {subject ? (
                    <span className="size-2 rounded-full" style={{ background: argbToCss(subject.colorValue) }} />
                  ) : null}
                  {subject?.title ?? "No subject"}
                  <ChevronDown className="size-3.5 text-ink-3" />
                </Button>
              }
              items={[
                { label: "No subject", checked: !subject, onSelect: () => setSubject(null) },
                ...(projects.length ? [{ separator: true as const }] : []),
                ...projects.map((p) => ({
                  label: p.title,
                  swatch: argbToCss(p.colorValue),
                  checked: p.id === note.subjectId,
                  onSelect: () => setSubject(p.id),
                })),
              ]}
            />
            <Menu
              align="end"
              trigger={
                <Button variant="ghost" size="sm" className="text-ink-2" icon={<Folder className="size-3.5" />}>
                  {folder?.name ?? "No folder"}
                  <ChevronDown className="size-3.5 text-ink-3" />
                </Button>
              }
              items={[
                { label: "No folder", checked: !folder, onSelect: () => setFolder(null) },
                ...(subjectFolders.length ? [{ separator: true as const }] : []),
                ...subjectFolders.map((f) => ({ label: f.name, checked: f.id === note.folderId, onSelect: () => setFolder(f.id) })),
                { separator: true },
                { label: "New folder…", onSelect: () => void newFolder() },
              ]}
            />
            <Menu
              align="end"
              trigger={
                <IconButton label="More">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              }
              items={[
                { label: "Export as Word document", onSelect: () => void exportDocx() },
                { label: "Print or save as PDF…", onSelect: () => void exportPdf() },
                { separator: true },
                {
                  label: "Delete note…",
                  destructive: true,
                  onSelect: () => void removeNote(note, () => navigate({ view: "notes" })),
                },
              ]}
            />
          </>
        }
      />
      <div className="scroll-area flex-1 pb-32">
        <article className="mx-auto w-full max-w-[720px] px-6 pt-4 max-sm:px-4">
          <textarea
            rows={1}
            value={title}
            autoFocus={note.title === "" && isEmptyContent(note.content)}
            onChange={(e) => {
              const value = e.target.value.replace(/\n/g, " ");
              setTitle(value);
              setEditingTitle(true);
              draft.current.title = value;
              schedule();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (document.querySelector(".rt .ql-editor") as HTMLElement | null)?.focus();
              }
            }}
            placeholder="Untitled note"
            className="field-sizing-content block w-full resize-none bg-transparent font-display text-xl font-semibold tracking-[-0.015em] outline-none placeholder:text-ink-4"
          />
          <div className="mt-1 mb-5 flex items-center justify-between gap-3 text-xs text-ink-3">
            <span>{editedLabel(note.updatedAt)}</span>
            <WordCount quill={quill} note={note} />
          </div>
          <RichText
            value={note.content}
            toolbar="full"
            toolbarClassName="sticky top-0 z-10 -mx-2 bg-canvas/90 px-1 py-1.5 backdrop-blur-md"
            reading
            minHeight={320}
            placeholder="Start writing, or type / for blocks and [[ to link a note"
            onReady={setQuill}
            noteLinks={noteLinks}
            onChange={(content) => {
              draft.current.content = content;
              schedule();
            }}
          />
          <Backlinks note={note} />
        </article>
      </div>
    </>
  );
}

/** Words in the note (and in the selection), against an optional limit. */
function WordCount({ quill, note }: { quill: QuillType | null; note: StudyNote }) {
  const [counts, setCounts] = useState({ total: 0, selected: 0 });
  useEffect(() => {
    if (!quill) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const range = quill.getSelection();
        setCounts({
          total: countWords(quill.getText()),
          selected: range && range.length ? countWords(quill.getText(range.index, range.length)) : 0,
        });
      });
    };
    measure();
    quill.on("editor-change", measure);
    return () => {
      cancelAnimationFrame(frame);
      quill.off("editor-change", measure);
    };
  }, [quill]);

  const limit = typeof note.extra?.wordLimit === "number" ? note.extra.wordLimit : null;
  const setLimit = (value: number | null) => {
    const current = useWorkspace.getState().notes.find((n) => n.id === note.id);
    if (!current) return;
    const extra = { ...current.extra };
    if (value) extra.wordLimit = value;
    else delete extra.wordLimit;
    updateNote({ ...current, extra });
  };
  const over = limit != null && counts.total > limit;
  const label = counts.selected
    ? `${formatCount(counts.selected)} of ${formatCount(counts.total)} words`
    : limit
      ? `${formatCount(counts.total)} / ${formatCount(limit)} words`
      : `${formatCount(counts.total)} ${counts.total === 1 ? "word" : "words"}`;

  return (
    <Popover
      align="end"
      className="w-64 p-3"
      trigger={
        <button
          type="button"
          className={cn("tnum -mr-1.5 rounded-[6px] px-1.5 py-0.5 transition-colors hover:bg-fill hover:text-ink", over && "text-danger hover:text-danger")}
        >
          {label}
        </button>
      }
    >
      {(close) => (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number(new FormData(e.currentTarget).get("limit"));
            setLimit(Number.isFinite(value) && value > 0 ? Math.round(value) : null);
            close();
          }}
        >
          <label className="text-sm font-medium" htmlFor="word-limit">
            Word limit
          </label>
          <p className="mt-0.5 text-xs text-ink-3">The count turns red past it. Formulas don’t count.</p>
          <div className="mt-2.5 flex gap-2">
            <input
              id="word-limit"
              name="limit"
              type="number"
              min={1}
              inputMode="numeric"
              autoFocus
              defaultValue={limit ?? ""}
              placeholder="e.g. 1500"
              className="tnum h-8 min-w-0 flex-1 rounded-ctl border border-line-strong bg-canvas px-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft"
            />
            <Button type="submit" size="sm" variant="primary">
              Set
            </Button>
          </div>
          {limit != null && (
            <button
              type="button"
              onClick={() => {
                setLimit(null);
                close();
              }}
              className="mt-2 text-xs text-ink-3 hover:text-ink"
            >
              Remove limit
            </button>
          )}
        </form>
      )}
    </Popover>
  );
}

/** Notes that link here. */
function Backlinks({ note }: { note: StudyNote }) {
  const navigate = useNavigate();
  const href = noteHref(note.id);
  const notes = useWorkspace((s) => s.notes);
  const projects = useWorkspace((s) => s.projects);
  const linking = useMemo(() => notes.filter((n) => n.id !== note.id && n.content.includes(`"${href}"`)), [notes, note.id, href]);
  if (linking.length === 0) return null;
  return (
    <section className="mt-14 border-t border-line pt-4">
      <h2 className="mb-1.5 text-xs font-medium text-ink-3">Linked from</h2>
      <ul className="-mx-2">
        {linking.map((n) => {
          const subject = projects.find((p) => p.id === n.subjectId);
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => navigate({ view: "note", id: n.id })}
                className="flex h-8 w-full items-center gap-2.5 rounded-ctl px-2 text-left text-sm transition-colors hover:bg-fill"
              >
                <FileText className="size-3.5 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{n.title || "Untitled note"}</span>
                {subject && (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-3">
                    <span className="size-1.5 rounded-full" style={{ background: argbToCss(subject.colorValue) }} />
                    {subject.title}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

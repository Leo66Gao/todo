"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Folder, MoreHorizontal } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { isEmptyContent } from "@/lib/delta";
import { encodeNote, recordFits, uuid, type StudyNote } from "@/lib/model";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { addFolder, deleteNote, updateNote, useWorkspace } from "@/store/workspace";
import { Button, IconButton } from "@/ui/controls";
import { Menu, promptDialog } from "@/ui/overlay";
import { RichText } from "@/ui/RichText";
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
  const [title, setTitle] = useState(note.title === "Untitled note" ? "" : note.title);
  const draft = useRef({ title: note.title, content: note.content });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const [, force] = useState(0);

  const subject = projects.find((p) => p.id === note.subjectId);
  const subjectFolders = folders.filter((f) => f.subjectId === note.subjectId);
  const folder = folders.find((f) => f.id === note.folderId);

  const persist = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    const current = useWorkspace.getState().notes.find((n) => n.id === note.id);
    if (!current) return;
    const next: StudyNote = {
      ...current,
      title: draft.current.title.trim() || "Untitled note",
      content: draft.current.content,
      updatedAt: new Date(),
    };
    if (!recordFits(encodeNote(next))) {
      toast("This note is too large to sync. Keep it under 650 KB.");
      return;
    }
    dirty.current = false;
    updateNote(next);
    force((n) => n + 1);
  };

  const schedule = () => {
    dirty.current = true;
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
            className="field-sizing-content block w-full resize-none bg-transparent text-xl font-semibold tracking-[-0.015em] outline-none placeholder:text-ink-4"
          />
          <p className="mt-1 mb-5 text-xs text-ink-3">{editedLabel(note.updatedAt)}</p>
          <RichText
            value={note.content}
            toolbar="full"
            toolbarClassName="sticky top-0 z-10 -mx-2 bg-canvas/90 px-1 py-1.5 backdrop-blur-md"
            reading
            minHeight={320}
            placeholder="Start writing…"
            onChange={(content) => {
              draft.current.content = content;
              schedule();
            }}
          />
        </article>
      </div>
    </>
  );
}

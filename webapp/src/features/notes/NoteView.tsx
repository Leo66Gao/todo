"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type QuillType from "quill";
import { BookMarked, Check, ChevronDown, ChevronLeft, FileText, Folder, Moon, MoreHorizontal, PenLine, Sun } from "lucide-react";
import { useAppearance } from "@/lib/appearance";
import { argbToCss } from "@/lib/dart";
import { isEmptyContent } from "@/lib/delta";
import { changeDraft, storeDraft, type EditorDraft, type DraftField } from "@/lib/editorDrafts";
import { encodeNote, uuid, type StudyNote } from "@/lib/model";
import { bibliography, bibliographyHeading, inText, reference } from "@/lib/sources";
import { countWords, formatCount } from "@/lib/words";
import { openSources, type CiteTarget } from "@/features/sources/library";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { addFolder, addNote, captureWorkspaceSession, deleteNote, flushWorkspaceSave, readSide, saveEditorDraft, updateNote, useWorkspace } from "@/store/workspace";
import { Button, IconButton } from "@/ui/controls";
import { cn } from "@/ui/cn";
import { Menu, Popover, promptDialog, Tooltip } from "@/ui/overlay";
import { noteHref, RichText, type EditorAction, type NoteLinks } from "@/ui/RichText";
import { toast } from "@/ui/toast";
import { getLocal, setLocal } from "@/lib/prefs";
import { useMedia } from "@/ui/useMedia";
import { editedLabel, removeNote } from "./noteActions";
import { VersionHistory } from "./VersionHistory";
import { NoteAiButton } from "./NoteAi";

const pill =
  "flex h-9 max-w-full min-w-0 items-center gap-2 rounded-full border border-line bg-card px-3.5 text-[13px] font-medium text-ink-2 shadow-card transition-colors hover:bg-fill data-[state=open]:bg-fill";

export function NoteView({ id }: { id: string }) {
  const note = useWorkspace((s) => s.notes.find((n) => n.id === id));
  const navigate = useNavigate();
  const back = (
    <button
      type="button"
      aria-label="Back"
      onClick={() => (history.length > 1 ? history.back() : navigate({ view: "notes" }))}
      className="-ml-1 flex h-9 items-center gap-1 rounded-full pr-3 pl-1.5 text-sm text-ink-3 transition-colors hover:bg-fill hover:text-ink max-md:ml-0 max-md:size-11 max-md:justify-center max-md:lens-chip max-md:p-0 max-md:text-ink"
    >
      <ChevronLeft className="size-[18px] max-md:size-5" />
      <span className="max-md:hidden">Back</span>
    </button>
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
  const draft = useRef<EditorDraft | null>(null);
  const [editorSession] = useState(() => ({ current: captureWorkspaceSession(), owner: useWorkspace.getState().user?.uid ?? "", journalId: uuid() }));
  const warned = useRef(false);
  const draftDurable = useRef(false);
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
  // View reads the note as a page; Edit is a plain white page with the
  // formatting bar, like a word processor. A new note opens ready to write.
  const [editing, setEditingMode] = useState(
    () => (note.title === "" && isEmptyContent(note.content)) || getLocal<string>("notes.mode", "view") === "edit",
  );
  // Phones always write straight into the note; the two modes are for wider screens.
  const phone = useMedia("(max-width: 767px)");
  const paged = !phone && editing;
  const readOnly = !phone && !editing;
  const appMode = useAppearance((s) => s.themeMode);
  const systemDark = useMedia("(prefers-color-scheme: dark)");
  const [pageMode, setPageMode] = useState<"follow" | "light" | "dark">(() => {
    const saved = getLocal<string>("notes.pageMode", "follow");
    return saved === "light" || saved === "dark" ? saved : "follow";
  });
  const pageTheme = pageMode === "follow"
    ? appMode === "dark" || (appMode === "system" && systemDark) ? "dark" : "light"
    : pageMode;
  const choosePageMode = (mode: typeof pageMode) => {
    setPageMode(mode);
    setLocal("notes.pageMode", mode);
  };
  const setEditing = (on: boolean) => {
    setEditingMode(on);
    setLocal("notes.mode", on ? "edit" : "view");
    if (!on) persist();
  };
  const [historyOpen, setHistoryOpen] = useState(false);
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

  const actions = useMemo<EditorAction[]>(() => {
    const citedIds = () => {
      const current = useWorkspace.getState().notes.find((n) => n.id === note.id);
      return Array.isArray(current?.extra?.cited) ? (current.extra.cited as string[]) : [];
    };
    const target: CiteTarget = {
      cited: citedIds,
      cite: (source, style, page) => {
        if (!quill) return;
        const range = quill.getSelection(true);
        const before = range.index > 0 ? quill.getText(range.index - 1, 1) : "\n";
        const text = `${/\s|\(/.test(before) ? "" : " "}${inText(source, style, page)}`;
        quill.deleteText(range.index, range.length, "user");
        quill.insertText(range.index, text, "user");
        quill.setSelection(range.index + text.length, 0, "silent");
        const current = useWorkspace.getState().notes.find((n) => n.id === note.id);
        if (current && !citedIds().includes(source.id)) {
          updateNote({ ...current, extra: { ...current.extra, cited: [...citedIds(), source.id] } });
        }
      },
      bibliography: (style) => {
        if (!quill) return;
        const all = readSide<{ sources?: { id: string }[] }>("settings:sources", {}).sources ?? [];
        const ids = new Set(citedIds());
        const sources = bibliography(all.filter((s) => ids.has(s.id)) as Parameters<typeof bibliography>[0], style);
        const heading = bibliographyHeading(style);
        // Replace the list if the note already has one (either style).
        let start = -1;
        let end = quill.getLength() - 1;
        for (const line of quill.getLines()) {
          const header = (line.formats() as { header?: number }).header;
          const text = line.domNode.textContent?.trim();
          if (start < 0 && header && (text === "Works Cited" || text === "References")) start = quill.getIndex(line);
          else if (start >= 0 && header && quill.getIndex(line) > start) {
            end = quill.getIndex(line);
            break;
          }
        }
        if (start >= 0) quill.deleteText(start, end - start, "user");
        const at = start >= 0 ? start : quill.getLength() - 1;
        const ops: { insert: string; attributes?: Record<string, unknown> }[] = [];
        if (start < 0 && at > 0) ops.push({ insert: "\n" });
        ops.push({ insert: heading }, { insert: "\n", attributes: { header: 2 } });
        for (const source of sources) {
          for (const run of reference(source, style)) ops.push(run.italic ? { insert: run.text, attributes: { italic: true } } : { insert: run.text });
          ops.push({ insert: "\n" });
        }
        quill.updateContents([{ retain: at }, ...ops] as never, "user");
      },
    };
    return [
      { key: "cite", label: "Cite a source", icon: <BookMarked />, words: "cite citation source reference bibliography", run: () => openSources(target) },
    ];
  }, [quill, note.id]);

  const subject = projects.find((p) => p.id === note.subjectId);
  const subjectFolders = folders.filter((f) => f.subjectId === note.subjectId);
  const folder = folders.find((f) => f.id === note.folderId);

  const persist = (openCopy = true): boolean => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!editorSession.current()) return false;
    const pending = draft.current;
    if (!pending) return true;
    const result = saveEditorDraft(pending);
    if (!result.saved) {
      toast(draftDurable.current ? "This note is too large to sync. Its draft is kept on this device; shorten it or export it." : "This note is too large and draft storage is unavailable. Keep this page open and export it before leaving.");
      return false;
    }
    draft.current = null;
    const next = useWorkspace.getState().notes.find((n) => n.id === result.id);
    if (next) setSavedTitle(next.title);
    setEditingTitle(false);
    if (result.conflicted) {
      toast("The original changed elsewhere. Your edits were kept in a conflict copy.");
      if (openCopy) navigate({ view: "note", id: result.id });
    }
    return true;
  };

  const remember = (field: DraftField, value: string, basedOn: string) => {
    if (!editorSession.current()) return;
    const current = useWorkspace.getState().notes.find((n) => n.id === note.id) ?? note;
    draft.current = changeDraft(draft.current, editorSession.owner, "note", encodeNote(current), editorSession.journalId, field, value, basedOn);
    try { storeDraft(draft.current); draftDurable.current = true; }
    catch {
      draftDurable.current = false;
      if (!warned.current) { warned.current = true; toast("Draft storage is unavailable. Keep this page open until the device save finishes."); }
      persist();
    }
  };

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(persist, 500);
  };

  // Save on leave; a note that was never written in is discarded.
  const mountGeneration = useRef(0);
  useEffect(
    () => {
      const generation = ++mountGeneration.current;
      const currentSession = editorSession.current;
      const abandoned = () => generation === mountGeneration.current && !draft.current;
      return () => {
        persist(false);
        // React's development effect replay isn't a page leave. Let a replay
        // renew its generation before discarding an actually abandoned note.
        queueMicrotask(() => {
          if (!abandoned() || !currentSession()) return;
          const current = useWorkspace.getState().notes.find((n) => n.id === note.id);
          if (current && current.title.trim() === "" && isEmptyContent(current.content)) deleteNote(current.id);
        });
      };
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const persistRef = useRef(persist);
  useEffect(() => { persistRef.current = persist; });
  useEffect(() => {
    const leave = () => { persistRef.current(false); };
    const hide = () => { if (document.hidden) leave(); };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("pagehide", leave); document.removeEventListener("visibilitychange", hide); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!persist()) return;
        void flushWorkspaceSave().then(() => {
          if (editorSession.current()) toast("Saved on this device");
        }).catch(() => { if (editorSession.current()) toast("The device save failed. Your draft is still kept for recovery."); });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const exportDocx = async () => {
    const current = { ...(useWorkspace.getState().notes.find((n) => n.id === note.id) ?? note), ...draft.current?.patch };
    persist();
    try {
      const { fileName, noteToDocx, saveFile } = await import("@/lib/noteFiles");
      await saveFile(fileName(current.title, "docx"), await noteToDocx(current.title, current.content));
    } catch {
      toast("The Word document couldn’t be made.");
    }
  };
  const exportPdf = async () => {
    const current = { ...(useWorkspace.getState().notes.find((n) => n.id === note.id) ?? note), ...draft.current?.patch };
    persist();
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
            {!phone && (
            <Tooltip label={editing ? "Done editing" : "Edit the note"}>
              {editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-sm font-semibold text-on-ink transition-transform active:scale-[0.97] max-md:size-11 max-md:justify-center max-md:border-transparent! max-md:bg-ink! max-md:px-0 max-md:text-on-ink!"
                >
                  <Check className="size-4 max-md:size-5" strokeWidth={2.4} />
                  <span className="max-md:hidden">Done</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-card px-3.5 text-sm font-medium shadow-card transition-transform active:scale-[0.97] max-md:size-11 max-md:justify-center max-md:px-0 max-md:lens-chip"
                >
                  <PenLine className="size-4 max-md:size-[18px]" />
                  <span className="max-md:hidden">Edit</span>
                </button>
              )}
            </Tooltip>
            )}
            {paged && (
              <Menu
                align="end"
                trigger={
                  <Button size="sm" icon={pageTheme === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}>
                    Page: {pageMode === "follow" ? "Auto" : pageMode === "dark" ? "Dark" : "Light"}
                  </Button>
                }
                items={[
                  { heading: "Page appearance" },
                  { label: "Follow app", checked: pageMode === "follow", onSelect: () => choosePageMode("follow") },
                  { label: "Light page", checked: pageMode === "light", onSelect: () => choosePageMode("light") },
                  { label: "Dark page", checked: pageMode === "dark", onSelect: () => choosePageMode("dark") },
                ]}
              />
            )}
            <NoteAiButton quill={quill} note={note} />
            <Menu
              align="end"
              trigger={
                <IconButton label="More">
                  <MoreHorizontal className="size-4" />
                </IconButton>
              }
              items={[
                { label: "Version history…", onSelect: () => { persist(); setHistoryOpen(true); } },
                { separator: true },
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
      <div className={cn("scroll-area flex-1 pb-32", paged && "note-desk")} data-page-theme={paged ? pageTheme : undefined}>
        <article
          className={cn(
            "mx-auto w-full",
            paged
              ? "note-page mt-6 max-w-[816px] px-[72px] pt-12 pb-16 max-md:mx-3 max-md:w-auto max-md:px-5 max-md:pt-6 max-md:pb-10"
              : "max-w-[720px] px-6 pt-4 max-sm:px-4",
          )}
        >
          <textarea
            rows={1}
            value={title}
            readOnly={readOnly}
            autoFocus={note.title === "" && isEmptyContent(note.content)}
            onChange={(e) => {
              const value = e.target.value.replace(/\n/g, " ");
              setTitle(value);
              setEditingTitle(true);
              remember("title", value.trim() || "Untitled note", note.title);
              schedule();
            }}
            onBlur={() => persist()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (document.querySelector(".rt .ql-editor") as HTMLElement | null)?.focus();
              }
            }}
            placeholder="Untitled note"
            className="field-sizing-content block w-full resize-none bg-transparent font-display text-xl font-semibold tracking-[-0.015em] outline-none placeholder:text-ink-4 max-md:text-[28px] max-md:leading-[1.2] max-md:font-bold max-md:tracking-[-0.02em]"
          />
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
      <Menu
        align="end"
        trigger={
          <button type="button" className={pill}>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: subject ? argbToCss(subject.colorValue) : "var(--ink-4)" }}
            />
            <span className="truncate">{subject?.title ?? "No subject"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-ink-3" />
          </button>
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
          <button type="button" className={pill}>
            <Folder className="size-3.5 shrink-0 text-ink-3" />
            <span className="truncate">{folder?.name ?? "No folder"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-ink-3" />
          </button>
        }
        items={[
          { label: "No folder", checked: !folder, onSelect: () => setFolder(null) },
          ...(subjectFolders.length ? [{ separator: true as const }] : []),
          ...subjectFolders.map((f) => ({ label: f.name, checked: f.id === note.folderId, onSelect: () => setFolder(f.id) })),
          { separator: true },
          { label: "New folder…", onSelect: () => void newFolder() },
        ]}
      />
          </div>
          <div className="mt-3 mb-5 flex items-center justify-between gap-3 text-xs text-ink-3">
            <span>{editedLabel(note.updatedAt)}</span>
            <WordCount quill={quill} note={note} />
          </div>
          <RichText
            value={note.content}
            toolbar="full"
            toolbarClassName={
              paged
                ? "note-toolbar sticky top-2 z-10 -mx-3 rounded-[12px] px-1.5 py-1 max-md:-mx-2"
                : "sticky top-0 z-10 -mx-2 bg-canvas/90 px-1 py-1.5 backdrop-blur-md"
            }
            readOnly={readOnly}
            reading={!paged}
            minHeight={320}
            placeholder="Start writing, or type / for blocks and [[ to link a note"
            onReady={setQuill}
            noteLinks={noteLinks}
            actions={actions}
            onBlur={() => persist()}
            onChange={(content, basedOn) => {
              remember("content", content, basedOn);
              schedule();
            }}
          />
          <Backlinks note={note} />
        </article>
      </div>
      <VersionHistory noteId={note.id} open={historyOpen} onOpenChange={setHistoryOpen} />
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
              className="tnum h-8 min-w-0 flex-1 rounded-ctl border border-line-strong bg-card px-2.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft"
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

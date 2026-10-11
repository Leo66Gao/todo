"use client";

// AI help across notes, not just one:
// - Ask your notes (from search): a question answered from the notes that
//   best match it, with links to the notes it used.
// - Exam revision (on a subject's exam card): a revision sheet or a quiz made
//   from all of the subject's notes.

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { format } from "date-fns";
import { FileText, RotateCcw, Sparkles } from "lucide-react";
import { AiError, chatJson, chatStream, useAiKey } from "@/lib/ai";
import { contentFromDelta } from "@/lib/delta";
import { markdownToDelta } from "@/lib/markdownPaste";
import { uuid, type StudyNote } from "@/lib/model";
import { askNotesMessages, cleanText, quizMessages, revisionSheetMessages, splitSources, type NoteContext } from "@/lib/notePrompts";
import { noteMarkdown, pickNotes } from "@/lib/noteSearch";
import { useNavigate } from "@/shell/nav";
import { addNote, useWorkspace } from "@/store/workspace";
import { Button, Spinner } from "@/ui/controls";
import { Modal } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { examDay } from "@/features/subjects/exams";
import { ChatPanel, Markdown, PHOTO_QUESTION, QuizView, readQuestions, useKatex, usePhotoAttachments, type QuizQuestion, type Turn } from "./AiViews";

function needKey(navigate: ReturnType<typeof useNavigate>) {
  if (useAiKey.getState().key) return false;
  toast("Add your DeepSeek API key in Settings to use the AI tools.", { label: "Settings", run: () => navigate({ view: "settings" }) });
  return true;
}

const failure = (e: unknown) => (e instanceof AiError ? e.message : "Something went wrong. Try again.");

// ---------------------------------------------------------------------------
// Ask your notes

export const useAskNotes = create<{ open: boolean; question: string }>(() => ({ open: false, question: "" }));
export const askNotes = (question = "") => useAskNotes.setState({ open: true, question: question.trim() });

interface SourcedTurn extends Turn {
  /** The answer as it came, with its sources line (what the model sees next time). */
  raw: string;
  notes: { id: string; title: string }[];
}

export function AskNotesDialog() {
  const open = useAskNotes((s) => s.open);
  return (
    <Modal open={open} onOpenChange={(o) => useAskNotes.setState({ open: o })} width={600} label="Ask your notes" initialFocus={(e) => e.preventDefault()}>
      {open && <AskNotes />}
    </Modal>
  );
}

function AskNotes() {
  const navigate = useNavigate();
  const notes = useWorkspace((s) => s.notes);
  const projects = useWorkspace((s) => s.projects);
  const [turns, setTurns] = useState<SourcedTurn[]>([]);
  const [draft, setDraft] = useState(() => useAskNotes.getState().question);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const lastQuestion = useRef("");
  const photos = usePhotoAttachments();
  const katex = useKatex(true);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = async (text = draft) => {
    const question = text.trim();
    const images = photos.images;
    if ((!question && !images.length) || busy || needKey(navigate)) return;
    lastQuestion.current = question;
    setDraft("");
    photos.clear();
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const subjectOf = (id: string | null) => projects.find((p) => p.id === id)?.title;
    const picked = pickNotes(notes, subjectOf, [...turns.map((t) => t.q), question].join(" "));
    const messages = askNotesMessages(
      picked.map((p) => ({ title: p.note.title, subject: subjectOf(p.note.subjectId), markdown: p.markdown })),
      turns.map((t) => ({ q: t.q || PHOTO_QUESTION, a: t.raw, images: t.images })),
      question || PHOTO_QUESTION,
      images,
    );
    const history = turns;
    const show = (raw: string, done: boolean) => {
      const { text: a, sources } = splitSources(cleanText(raw));
      const used = done ? sources.map((n) => picked[n - 1]?.note).filter((n): n is StudyNote => !!n) : [];
      setTurns([...history, { q: question, a, raw, images, notes: used.map((n) => ({ id: n.id, title: n.title || "Untitled note" })) }]);
    };
    show("", false);
    try {
      const raw = await chatStream(messages, { signal: controller.signal, mode: "think", onText: (t) => show(t, false) });
      show(raw, true);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setTurns(history);
      setDraft(question);
      for (const url of images) photos.restore(url);
      setError(failure(e));
    } finally {
      if (abort.current === controller) setBusy(false);
      setTimeout(() => input.current?.focus(), 0);
    }
  };

  // Asked straight from search: send it at once.
  useEffect(() => {
    const initial = useAskNotes.getState().question;
    const timer = setTimeout(() => (initial ? void ask(initial) : input.current?.focus()), 0);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openNote = (id: string) => {
    useAskNotes.setState({ open: false });
    navigate({ view: "note", id });
  };

  return (
    <div className="flex min-h-0 flex-col px-5 pt-4 pb-5 max-sm:px-4">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
        <Sparkles className="size-3.5" />
        Ask your notes
        {busy && turns.at(-1)?.a && <Spinner className="size-3" />}
      </div>
      {error && (
        <div className="mt-3 flex items-center gap-3 text-sm text-danger">
          <span className="flex-1">{error}</span>
          <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={() => void ask(lastQuestion.current)}>
            Retry
          </Button>
        </div>
      )}
      <ChatPanel
        turns={turns}
        busy={busy}
        katex={katex}
        scroller={scroller}
        input={input}
        draft={draft}
        setDraft={setDraft}
        onAsk={() => void ask()}
        images={photos.images}
        onAttach={photos.attach}
        onRemoveImage={photos.remove}
        placeholder={notes.length ? "Ask anything about your notes…" : "You have no notes yet. Ask anyway…"}
        before={
          <p className="mt-2 text-sm text-ink-3">
            Answers come from the notes that best match your question, with links to them.
          </p>
        }
        after={(t) => {
          const turn = t as SourcedTurn;
          if (!turn.notes?.length) return null;
          return (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {turn.notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNote(n.id)}
                  className="flex max-w-[240px] items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-fill hover:text-ink"
                >
                  <FileText className="size-3 shrink-0" />
                  <span className="truncate">{n.title}</span>
                </button>
              ))}
            </div>
          );
        }}
      />
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={() => useAskNotes.setState({ open: false })}>
          Close
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exam revision from a subject's notes

type Mode = "sheet" | "quiz";
export const useSubjectStudy = create<{ projectId: string | null; mode: Mode }>(() => ({ projectId: null, mode: "sheet" }));
export const studySubject = (projectId: string, mode: Mode) => useSubjectStudy.setState({ projectId, mode });

/** The subject's notes as one piece of material (most recently edited first, within budget). */
export function subjectMaterial(subject: string, notes: StudyNote[], budget = 40_000): NoteContext {
  let left = budget;
  const parts: string[] = [];
  for (const n of [...notes].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())) {
    const body = noteMarkdown(n.content);
    if (!body.trim() || left < 1000) continue;
    const part = `# ${n.title || "Untitled note"}\n${body.length > left ? `${body.slice(0, left)}\n…` : body}`;
    parts.push(part);
    left -= part.length;
  }
  return { title: `${subject} notes`, subject, markdown: parts.join("\n\n") };
}

export function SubjectStudyDialog() {
  const projectId = useSubjectStudy((s) => s.projectId);
  return (
    <Modal
      open={projectId != null}
      onOpenChange={(o) => !o && useSubjectStudy.setState({ projectId: null })}
      width={620}
      label="Revision"
      initialFocus={(e) => e.preventDefault()}
    >
      {projectId && <SubjectStudy key={projectId} projectId={projectId} />}
    </Modal>
  );
}

function SubjectStudy({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const mode = useSubjectStudy((s) => s.mode);
  const project = useWorkspace((s) => s.projects.find((p) => p.id === projectId));
  const notes = useWorkspace((s) => s.notes);
  const [sheet, setSheet] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const katex = useKatex(true);
  const subject = project?.title ?? "Subject";
  const [material] = useState(() => subjectMaterial(subject, notes.filter((n) => n.subjectId === projectId)));

  const run = async (which: Mode) => {
    if (needKey(navigate)) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    try {
      if (which === "sheet") {
        setBusy("Making the revision sheet");
        setSheet("");
        const exam = project ? examDay(project) : null;
        const text = await chatStream(revisionSheetMessages(material, exam ? format(exam, "EEEE d MMMM") : null), {
          signal: controller.signal,
          mode: "think",
          onText: (t) => {
            setBusy("Writing");
            setSheet(cleanText(t));
          },
        });
        setSheet(cleanText(text));
      } else {
        setBusy("Writing questions");
        setQuestions(null);
        setQuestions(readQuestions(await chatJson(quizMessages(material, 8), controller.signal, "think")));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(failure(e));
    } finally {
      if (abort.current === controller) setBusy(null);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => material.markdown.trim() && void run(mode), 0);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const el = scroller.current;
    if (el && busy) el.scrollTop = el.scrollHeight;
  }, [sheet, busy]);

  const close = () => useSubjectStudy.setState({ projectId: null });
  const saveSheet = () => {
    const now = new Date();
    const note: StudyNote = {
      id: uuid(),
      title: `${subject} revision sheet`,
      content: contentFromDelta(markdownToDelta(sheet)),
      subjectId: projectId,
      folderId: null,
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
    addNote(note);
    close();
    navigate({ view: "note", id: note.id });
  };

  const waiting = busy != null && (mode === "quiz" ? !questions : !sheet);
  return (
    <div className="flex min-h-0 flex-col px-5 pt-4 pb-5 max-sm:px-4">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
        <Sparkles className="size-3.5" />
        {mode === "sheet" ? `${subject} revision sheet` : `${subject} practice questions`}
        {busy && !waiting && <Spinner className="size-3" />}
      </div>
      {!material.markdown.trim() && <p className="py-6 text-sm text-ink-3">This subject has no notes yet. Write some notes for it first.</p>}
      {waiting && (
        <div className="flex items-center gap-3 py-10 text-sm text-ink-3">
          <Spinner />
          {busy}…
        </div>
      )}
      {error && <p className="py-6 text-sm text-danger">{error}</p>}
      {mode === "sheet" && sheet && (
        <div ref={scroller} className="scroll-area mt-3 max-h-[60dvh] text-[15px] leading-relaxed">
          <Markdown katex={katex} text={sheet} />
        </div>
      )}
      {mode === "quiz" && questions && (
        <QuizView className="scroll-area mt-3 max-h-[60dvh]" questions={questions} onChange={setQuestions} material={material} katex={katex} />
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={close}>
          Close
        </Button>
        {!busy && material.markdown.trim() && (error || (mode === "quiz" ? questions : sheet)) && (
          <Button icon={<RotateCcw className="size-3.5" />} onClick={() => void run(mode)}>
            {error ? "Retry" : mode === "quiz" ? "New questions" : "Write it again"}
          </Button>
        )}
        {!busy && mode === "sheet" && sheet && (
          <Button variant="primary" onClick={saveSheet}>
            Save as a note
          </Button>
        )}
      </div>
    </div>
  );
}

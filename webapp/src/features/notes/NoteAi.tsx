"use client";

import { useEffect, useRef, useState } from "react";
import type QuillType from "quill";
import { format } from "date-fns";
import { BookOpen, Camera, RotateCcw, CircleHelp, Lightbulb, ListChecks, MessageCircle, PenLine, Sparkles, SpellCheck, Wand2 } from "lucide-react";
import { AiError, chatJson, chatStream, useAiKey, type AiMode, type ChatMessage } from "@/lib/ai";
import type { DeltaOp } from "@/lib/delta";
import { markdownToDelta } from "@/lib/markdownPaste";
import type { StudyNote } from "@/lib/model";
import { markdownLines, sectionAt, toMarkdown } from "@/lib/noteMarkdown";
import {
  askMessages,
  cleanText,
  continueMessages,
  editMessages,
  explainMessages,
  photoNoteMessages,
  quizMessages,
  summaryMessages,
  tasksMessages,
  termsMessages,
  type Focus,
  type NoteContext,
} from "@/lib/notePrompts";
import { formatDuration, startOfDay, today } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { addTask, newTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, IconButton, Spinner } from "@/ui/controls";
import { Menu, Modal, type MenuItem } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { TaskCheck } from "@/features/tasks/TaskCheck";
import { ChatPanel, Markdown, PHOTO_QUESTION, QuizView, readQuestions, useKatex, usePhotoAttachments, type Katex, type QuizQuestion } from "@/features/ai/AiViews";
import { choosePhotos, photoDataUrl } from "@/lib/photoData";

type Range = { index: number; length: number };

/** The note when the menu opened: as Markdown, where the cursor was, and what it's in. */
interface Snapshot {
  note: NoteContext;
  plain: string;
  range: Range | null;
  selection: string | null;
  section: { title: string; text: string; end: number } | null;
}

type WriteVerb = "explain" | "continue" | "clearer" | "fix" | "photo";

/** What came back, and how it can go into the note. */
type Result =
  | { kind: "summary"; points: string[] }
  | { kind: "terms"; terms: { term: string; meaning: string }[] }
  | { kind: "quiz"; questions: QuizQuestion[] }
  | { kind: "chat"; focus: Focus; options: Focus[]; turns: { q: string; a: string; images?: string[] }[]; at: number; added?: number }
  | { kind: "write"; verb: WriteVerb; text: string; range: Range | null; at: number; original?: string }
  | { kind: "tasks"; tasks: { title: string; date: Date; minutes: number; include: boolean }[] };

const RESULT_LABEL: Record<Result["kind"], string> = {
  summary: "Summary",
  terms: "Key terms",
  quiz: "Practice questions",
  chat: "Ask",
  write: "",
  tasks: "Tasks found in the note",
};
const WRITE_LABEL: Record<WriteVerb, string> = { explain: "Explanation", continue: "Continued", clearer: "Rewritten", fix: "Corrected", photo: "From your photo" };

const opsLength = (ops: DeltaOp[]) => ops.reduce((n, op) => n + (typeof op.insert === "string" ? op.insert.length : 1), 0);

/** The start of the line after the one [index] is in (adding an empty last line if needed). */
function lineAfter(quill: QuillType, index: number) {
  const nl = quill.getText(index).indexOf("\n");
  const at = index + Math.max(0, nl) + 1;
  if (at < quill.getLength()) return at;
  quill.insertText(quill.getLength() - 1, "\n", "user");
  const last = quill.getLength() - 1;
  quill.removeFormat(last, 1, "user");
  return last;
}

/**
 * Markdown from the AI as rich text (lists, bold, formulas), as whole lines
 * at [at]. Returns the index of the inserted text's last line break; the
 * cursor goes there unless [keepCursor].
 */
function insertLines(quill: QuillType, markdown: string, at: number, keepCursor = false) {
  const ops = markdownToDelta(markdown);
  if (!ops.length) return at;
  quill.updateContents([{ retain: at }, ...ops] as never, "user");
  const end = at + opsLength(ops) - 1;
  if (!keepCursor) quill.setSelection(end, 0, "silent");
  return end;
}

/** Replaces the selection, keeping the line ending it stopped before (and that line's format). */
function replaceRange(quill: QuillType, range: Range, markdown: string) {
  let ops = markdownToDelta(markdown);
  const endsLine = quill.getText(range.index + range.length - 1, 1) === "\n";
  if (!endsLine && ops.length) ops = ops.slice(0, -1);
  quill.updateContents([{ retain: range.index }, { delete: range.length }, ...ops] as never, "user");
  quill.setSelection(range.index + opsLength(ops), 0, "silent");
}

/**
 * The selected text as delta ops. A selection usually stops short of its last
 * line's end, where that line's format (a list item, a heading) is kept, so
 * that line ending is added to keep the format.
 */
function selectedOps(quill: QuillType, range: Range): DeltaOp[] {
  const ops = quill.getContents(range.index, range.length).ops as DeltaOp[];
  const end = range.index + range.length;
  if (quill.getText(end - 1, 1) === "\n") return ops;
  const nl = quill.getText(end).indexOf("\n");
  const lineEnd = quill.getContents(end + Math.max(0, nl), 1).ops[0] as DeltaOp | undefined;
  return [...ops, { insert: "\n", ...(lineEnd?.attributes ? { attributes: lineEnd.attributes } : {}) }];
}

/** A list result with something in it, worth adding to the note. */
const hasContent = (r: Result) =>
  (r.kind === "summary" && r.points.length > 0) || (r.kind === "terms" && r.terms.length > 0) || (r.kind === "quiz" && r.questions.length > 0);

const focusLabel = (f: Focus) => (f.kind === "selection" ? "The selection" : f.kind === "section" ? f.title || "This section" : "The whole note");

/**
 * The note's AI helper (DeepSeek, with the key kept on this device). Answers
 * stream in as they're written; nothing goes into the note until it's added.
 */
export function NoteAiButton({ quill, note }: { quill: QuillType | null; note: StudyNote }) {
  const navigate = useNavigate();
  const hasKey = useAiKey((s) => !!s.key);
  const subject = useWorkspace((s) => s.projects.find((p) => p.id === note.subjectId));
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState("");
  const photos = usePhotoAttachments();
  /** The Ask conversation, kept while the note is open so it can be picked up again. */
  const [kept, setKept] = useState<Extract<Result, { kind: "chat" }> | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** Runs the last request again (after an error). */
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const lastRange = useRef<Range | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const open = busy != null || result != null || error != null;
  const katex = useKatex(open);

  useEffect(() => {
    if (!quill) return;
    const track = (range: Range | null) => {
      if (range) lastRange.current = { index: range.index, length: range.length };
    };
    quill.on("selection-change", track);
    return () => void quill.off("selection-change", track);
  }, [quill]);

  // Keep the newest words in view while an answer streams in.
  useEffect(() => {
    const el = scroller.current;
    if (el && (result?.kind === "chat" || result?.kind === "write")) el.scrollTop = el.scrollHeight;
  }, [result]);

  /** Reads the note when the menu opens (tapping the button takes focus from the text). */
  const capture = (): Snapshot | null => {
    if (!quill) return null;
    const range = quill.getSelection() ?? lastRange.current;
    const lines = markdownLines(quill.getContents().ops as DeltaOp[]);
    const hasSelection = range != null && range.length > 0;
    const selection = hasSelection ? toMarkdown(markdownLines(selectedOps(quill, range))) : null;
    const section = range ? sectionAt(lines, range.index) : null;
    return {
      note: { title: note.title, subject: subject?.title, markdown: toMarkdown(lines) },
      plain: quill.getText().trim(),
      range: range ? { index: range.index, length: range.length } : null,
      selection: selection?.trim() ? selection : null,
      // A section that is the whole note isn't worth offering separately.
      section: section && section.lines.length < lines.length ? { title: section.title, text: toMarkdown(section.lines), end: section.lines[section.lines.length - 1].start } : null,
    };
  };

  const ready = (s: Snapshot | null, needsText = true): s is Snapshot => {
    if (!hasKey) {
      toast("Add your DeepSeek API key in Settings to use the AI tools.", { label: "Settings", run: () => navigate({ view: "settings" }) });
      return false;
    }
    if (!s || !quill) return false;
    if (needsText && s.plain.length < 20) {
      toast("Write a little more first.");
      return false;
    }
    return true;
  };

  const start = (label: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setBusy(label);
    return controller;
  };
  const failed = (e: unknown) => {
    if ((e as Error).name === "AbortError") return;
    setError(e instanceof AiError ? e.message : "Something went wrong. Try again.");
  };

  /** A JSON answer (lists of points, terms, questions, tasks). */
  const runJson = async <T,>(label: string, messages: ChatMessage[], mode: AiMode, read: (answer: T) => Result) => {
    setRetry(() => () => void runJson(label, messages, mode, read));
    const controller = start(label);
    setResult(null);
    try {
      setResult(read(await chatJson<T>(messages, controller.signal, mode)));
    } catch (e) {
      failed(e);
    } finally {
      if (abort.current === controller) setBusy(null);
    }
  };

  /** Written text, shown as it arrives. */
  const runWrite = async (verb: WriteVerb, label: string, messages: ChatMessage[], mode: AiMode, range: Range | null, at: number) => {
    setRetry(() => () => void runWrite(verb, label, messages, mode, range, at));
    const controller = start(label);
    const original = range && quill ? quill.getText(range.index, range.length) : undefined;
    setResult({ kind: "write", verb, text: "", range, at, original });
    try {
      const text = await chatStream(messages, {
        signal: controller.signal,
        mode,
        onThinking: () => setBusy("Thinking"),
        onText: (t) => {
          setBusy("Writing");
          setResult((r) => (r?.kind === "write" ? { ...r, text: cleanText(t) } : r));
        },
      });
      setResult((r) => (r?.kind === "write" ? { ...r, text: cleanText(text) } : r));
    } catch (e) {
      // A newer request may have taken over: leave its result alone.
      if (abort.current === controller) setResult(null);
      failed(e);
    } finally {
      if (abort.current === controller) setBusy(null);
    }
  };

  // ---- The tools

  const summarise = (s: Snapshot) =>
    runJson<{ points?: unknown[] }>("Summarising", summaryMessages(s.note), "fast", (a) => ({
      kind: "summary",
      points: (a.points ?? []).filter((p): p is string => typeof p === "string" && !!p.trim()).slice(0, 10),
    }));

  const keyTerms = (s: Snapshot) =>
    runJson<{ terms?: { term?: string; meaning?: string }[] }>("Finding key terms", termsMessages(s.note), "fast", (a) => ({
      kind: "terms",
      terms: (a.terms ?? []).filter((t) => t.term && t.meaning).map((t) => ({ term: t.term!, meaning: t.meaning! })).slice(0, 15),
    }));

  const quiz = (s: Snapshot) =>
    runJson<{ questions?: { q?: unknown; a?: unknown }[] }>("Writing questions", quizMessages(s.note), "think", (a) => ({
      kind: "quiz",
      questions: readQuestions(a),
    }));

  const toTasks = (s: Snapshot) => {
    const now = today();
    return runJson<{ tasks?: { title?: string; date?: string; minutes?: number }[] }>(
      "Finding tasks",
      tasksMessages(s.note, format(now, "EEEE yyyy-MM-dd")),
      "think",
      (a) => ({
        kind: "tasks",
        tasks: (a.tasks ?? [])
          .filter((t) => t.title)
          .slice(0, 12)
          .map((t) => {
            const parsed = t.date ? new Date(`${t.date}T00:00:00`) : null;
            const date = parsed && !Number.isNaN(parsed.getTime()) && parsed >= now ? startOfDay(parsed) : now;
            const minutes = Math.min(600, Math.max(0, Math.round((t.minutes ?? 30) / 5) * 5));
            return { title: t.title!.trim(), date, minutes, include: true };
          }),
      }),
    );
  };

  const explain = (s: Snapshot) => {
    if (!s.selection || !s.range) return toast("Select what you’d like explained first.");
    void runWrite("explain", "Explaining", explainMessages(s.note, s.selection), "think", null, s.range.index + s.range.length - 1);
  };

  const edit = (s: Snapshot, how: "clearer" | "fix") => {
    if (!s.selection || !s.range) return toast("Select some text in the note first.");
    void runWrite(how, how === "fix" ? "Correcting" : "Rewriting", editMessages(s.note, s.selection, how), "fast", s.range, s.range.index);
  };

  const continueWriting = (s: Snapshot) => {
    if (!quill) return;
    const at = s.range ? s.range.index + s.range.length : quill.getLength() - 1;
    // Before the cursor (its line keeps its format), then the rest, on its own line when the cursor ends one.
    const lineEnd = quill.getText(at, 1) === "\n";
    const before = at > 0 ? toMarkdown(markdownLines(selectedOps(quill, { index: 0, length: at }))) : "";
    const after = toMarkdown(markdownLines(quill.getContents(at + (lineEnd ? 1 : 0)).ops as DeltaOp[]));
    void runWrite("continue", "Writing", continueMessages(s.note, before, after && lineEnd ? `\n${after}` : after), "fast", null, at);
  };

  /** Photos of a page or the board, written up and added where the cursor is. */
  const fromPhoto = async (s: Snapshot) => {
    if (!quill) return;
    const files = await choosePhotos();
    if (!files.length) return;
    const at = s.range ? s.range.index + s.range.length : quill.getLength() - 1;
    setRetry(null);
    const controller = start("Reading the photos");
    setResult(null);
    try {
      const images = await Promise.all(files.map(photoDataUrl));
      if (controller.signal.aborted) return;
      setBusy(null);
      void runWrite("photo", "Reading the photos", photoNoteMessages(images, { into: s.note }), "fast", null, at);
    } catch (e) {
      if (controller.signal.aborted) return;
      setBusy(null);
      setError((e as Error).message);
    }
  };

  /** Opens the conversation: about the selection, the section the cursor is in, or the whole note. */
  const openAsk = (s: Snapshot) => {
    abort.current?.abort();
    setError(null);
    setBusy(null);
    setDraft("");
    // Pick a kept conversation up where it was (its answers go where they went before).
    // The note may have changed since: its answers now go where the cursor is.
    if (kept?.turns.length && quill) {
      setResult({ ...kept, at: s.range ? s.range.index + s.range.length : quill.getLength() - 1 });
      setTimeout(() => input.current?.focus(), 50);
    } else openFresh(s);
  };

  /** Starts over: a new conversation about what's selected now. */
  const newChat = () => {
    setKept(null);
    if (snap && result?.kind === "chat") openFresh(snap);
  };
  const openFresh = (s: Snapshot) => {
    if (!quill) return;
    const options: Focus[] = [];
    if (s.selection) options.push({ kind: "selection", text: s.selection });
    if (s.section) options.push({ kind: "section", title: s.section.title, text: s.section.text });
    options.push({ kind: "note" });
    const focus = options[0];
    const at = focus.kind === "selection" && s.range ? s.range.index + s.range.length - 1 : focus.kind === "section" && s.section ? s.section.end : quill.getLength() - 1;
    setDraft("");
    setResult({ kind: "chat", focus, options, turns: [], at });
    setTimeout(() => input.current?.focus(), 50);
  };

  const ask = async () => {
    const question = draft.trim();
    const images = photos.images;
    if ((!question && !images.length) || !snap || result?.kind !== "chat" || busy) return;
    const chat = result;
    setDraft("");
    photos.clear();
    setRetry(null);
    const controller = start("Thinking");
    const messages = askMessages(
      snap.note,
      chat.focus,
      chat.turns.map((t) => ({ ...t, q: t.q || PHOTO_QUESTION })),
      question || PHOTO_QUESTION,
      images,
    );
    setResult({ ...chat, turns: [...chat.turns, { q: question, a: "", images }] });
    const setAnswer = (a: string) =>
      setResult((r) => (r?.kind === "chat" ? { ...r, turns: r.turns.map((t, i) => (i === r.turns.length - 1 ? { ...t, a } : t)) } : r));
    try {
      const text = await chatStream(messages, {
        signal: controller.signal,
        mode: "think",
        onText: (t) => {
          setBusy("Writing");
          setAnswer(cleanText(t));
        },
      });
      setAnswer(cleanText(text));
    } catch (e) {
      // Closed while answering: nothing to take back.
      if ((e as Error).name === "AbortError") return;
      // Take the question back so it can be asked again.
      setResult((r) => (r?.kind === "chat" ? { ...r, turns: r.turns.slice(0, -1) } : r));
      setDraft(question);
      for (const url of images) photos.restore(url);
      failed(e);
    } finally {
      if (abort.current === controller) setBusy(null);
      setTimeout(() => input.current?.focus(), 0);
    }
  };

  const setFocus = (focus: Focus) => {
    if (result?.kind !== "chat" || !quill || !snap) return;
    const at =
      focus.kind === "selection" && snap.range
        ? snap.range.index + snap.range.length - 1
        : focus.kind === "section" && snap.section
          ? snap.section.end
          : quill.getLength() - 1;
    setResult({ ...result, focus, at });
  };

  // ---- Putting answers into the note

  const close = () => {
    abort.current?.abort();
    if (result?.kind === "chat") {
      // An answer still being written isn't kept.
      const done = (busy ? result.turns.slice(0, -1) : result.turns).filter((t) => t.a);
      setKept(done.length ? { ...result, turns: done } : null);
    }
    photos.clear();
    setBusy(null);
    setResult(null);
    setError(null);
  };

  const apply = (where: "top" | "end" | "here") => {
    if (!quill || !result) return;
    // A note being read (not edited) has its editor locked, which also drops
    // changes made for you: unlock it just while the answer goes in.
    const locked = !quill.isEnabled();
    if (locked) quill.enable(true);
    try {
      applyTo(quill, where);
    } finally {
      if (locked) quill.enable(false);
    }
  };

  const applyTo = (quill: QuillType, where: "top" | "end" | "here") => {
    if (!result) return;
    const end = () => lineAfter(quill, quill.getLength() - 1);
    switch (result.kind) {
      case "summary":
        insertLines(quill, `## Summary\n${result.points.map((p) => `- ${p}`).join("\n")}`, where === "top" ? 0 : end());
        break;
      case "terms":
        insertLines(quill, `## Key terms\n${result.terms.map((t) => `- **${t.term}**: ${t.meaning}`).join("\n")}`, end());
        break;
      case "quiz":
        insertLines(quill, `## Practice questions\n${result.questions.map((x, i) => `**${i + 1}. ${x.q}**\n${x.a}\n`).join("\n")}`, end());
        break;
      case "chat": {
        const last = result.turns[result.turns.length - 1];
        if (!last?.a) return;
        const at = lineAfter(quill, Math.min(result.at, quill.getLength() - 1));
        // The next answer goes after this one (the panel stays open, so the cursor stays put).
        const end = insertLines(quill, last.q ? `**${last.q}**\n${last.a}` : last.a, at, true);
        setResult({ ...result, at: end, added: result.turns.length });
        toast("Added to the note");
        return;
      }
      case "write":
        if (result.verb === "clearer" || result.verb === "fix") {
          if (!result.range) break;
          // The note changed meanwhile (on another device): don't replace the wrong text.
          if (result.original != null && quill.getText(result.range.index, result.range.length) !== result.original) {
            toast("The note changed since. Select the text again and retry.");
            return;
          }
          replaceRange(quill, result.range, result.text);
        } else {
          insertLines(quill, result.text, lineAfter(quill, result.at));
        }
        break;
      case "tasks": {
        const chosen = result.tasks.filter((t) => t.include);
        for (const t of chosen) {
          addTask(newTask({ title: t.title, date: t.date, durationMinutes: t.minutes, remainingMinutes: t.minutes, projectId: note.subjectId }));
        }
        toast(`Added ${chosen.length} ${chosen.length === 1 ? "task" : "tasks"}`);
        break;
      }
    }
    close();
  };

  // ---- The menu

  const runTool = (tool: (s: Snapshot) => unknown, needsText = true) => {
    if (ready(snap, needsText)) void tool(snap);
  };
  const items: MenuItem[] = [
    {
      label: kept?.turns.length
        ? "Continue asking…"
        : snap?.selection
          ? "Ask about the selection…"
          : snap?.section
            ? `Ask about “${snap.section.title}”…`
            : "Ask about this note…",
      icon: <MessageCircle />,
      onSelect: () => runTool(openAsk),
    },
    ...(snap?.selection
      ? ([
          { heading: "Selection" },
          { label: "Explain it", icon: <Lightbulb />, onSelect: () => runTool(explain) },
          { label: "Rewrite more clearly", icon: <Wand2 />, onSelect: () => runTool((s) => edit(s, "clearer")) },
          { label: "Fix spelling and grammar", icon: <SpellCheck />, onSelect: () => runTool((s) => edit(s, "fix")) },
        ] satisfies MenuItem[])
      : []),
    { heading: "Note" },
    { label: "Summarise", icon: <Sparkles />, onSelect: () => runTool(summarise) },
    { label: "Key terms", icon: <BookOpen />, onSelect: () => runTool(keyTerms) },
    { label: "Quiz me", icon: <CircleHelp />, onSelect: () => runTool(quiz) },
    { label: "Continue writing", icon: <PenLine />, onSelect: () => runTool(continueWriting) },
    { label: "Add from a photo…", icon: <Camera />, onSelect: () => runTool(fromPhoto, false) },
    { label: "Turn into tasks", icon: <ListChecks />, onSelect: () => runTool(toTasks) },
  ];

  const label = busy ?? (error ? "Couldn’t finish" : result?.kind === "write" ? WRITE_LABEL[result.verb] : RESULT_LABEL[result?.kind ?? "summary"]);
  // Nothing to show yet (an answer that's streaming in shows as it comes).
  const waiting = busy != null && !(result?.kind === "write" && result.text) && result?.kind !== "chat";

  return (
    <>
      <Menu
        align="end"
        onOpenChange={(o) => o && setSnap(capture())}
        trigger={
          <IconButton label="AI tools">
            <Sparkles className="size-4 max-md:size-[18px]" />
          </IconButton>
        }
        items={items}
      />
      <Modal open={open} onOpenChange={(o) => !o && close()} width={560} label="AI" initialFocus={(e) => e.preventDefault()}>
        <div className="flex min-h-0 flex-col px-5 pt-4 pb-5 max-sm:px-4">
          <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
            <Sparkles className="size-3.5" />
            {label}
            {busy && !waiting && <Spinner className="size-3" />}
          </div>
          {waiting && (
            <div className="flex items-center gap-3 py-10 text-sm text-ink-3">
              <Spinner />
              {busy}…
            </div>
          )}
          {error && (
            <div className={cn("flex items-center gap-3 text-sm text-danger", result?.kind === "chat" ? "mt-3" : "py-6")}>
              <span className="flex-1">{error}</span>
              {(retry || result?.kind === "chat") && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw className="size-3.5" />}
                  onClick={() => (result?.kind === "chat" ? void ask() : retry?.())}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
          {result?.kind === "chat" ? (
            <ChatPanel
              turns={result.turns}
              busy={busy != null}
              katex={katex}
              scroller={scroller}
              input={input}
              draft={draft}
              setDraft={setDraft}
              onAsk={() => void ask()}
              images={photos.images}
              onAttach={photos.attach}
              onRemoveImage={photos.remove}
              placeholder={
                result.focus.kind === "note"
                  ? "Ask anything about this note…"
                  : result.focus.kind === "selection"
                    ? "Ask about the selection…"
                    : `Ask about “${focusLabel(result.focus)}”…`
              }
              before={
                result.options.length > 1 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {result.options.map((f, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setFocus(f)}
                        className={cn(
                          "max-w-[220px] truncate rounded-full border px-2.5 py-1 text-xs transition-colors",
                          f.kind === result.focus.kind ? "border-transparent bg-ink text-on-ink" : "border-line-strong text-ink-2 hover:bg-fill",
                        )}
                      >
                        {focusLabel(f)}
                      </button>
                    ))}
                  </div>
                )
              }
            />
          ) : (
            result && !waiting && <ResultView result={result} katex={katex} scroller={scroller} material={snap?.note ?? null} onChange={setResult} />
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {result?.kind === "chat" && result.turns.length > 0 && !busy && (
              <Button variant="ghost" className="mr-auto" onClick={newChat}>
                New chat
              </Button>
            )}
            <Button variant="ghost" onClick={close}>
              {result && result.kind !== "chat" && result.kind !== "quiz" ? "Discard" : "Close"}
            </Button>
            {!busy && result?.kind === "summary" && result.points.length > 0 && <Button onClick={() => apply("top")}>Add at the top</Button>}
            {!busy && result && hasContent(result) && (
              <Button variant="primary" onClick={() => apply("end")}>
                Add to the note
              </Button>
            )}
            {!busy && result?.kind === "chat" && result.turns.at(-1)?.a && result.added !== result.turns.length && (
              <Button onClick={() => apply("here")}>Add answer to the note</Button>
            )}
            {!busy && result?.kind === "write" && result.text && (
              <Button variant="primary" onClick={() => apply("here")}>
                {result.verb === "clearer" || result.verb === "fix" ? "Replace the selection" : "Insert"}
              </Button>
            )}
            {result?.kind === "tasks" && result.tasks.some((t) => t.include) && (
              <Button variant="primary" onClick={() => apply("here")}>
                Add {result.tasks.filter((t) => t.include).length} {result.tasks.filter((t) => t.include).length === 1 ? "task" : "tasks"}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

function ResultView({
  result,
  katex,
  scroller,
  material,
  onChange,
}: {
  result: Result;
  katex: Katex | null;
  scroller: React.RefObject<HTMLDivElement | null>;
  material: NoteContext | null;
  onChange: (r: Result) => void;
}) {
  const box = "scroll-area mt-3 max-h-[52dvh] text-[15px] leading-relaxed";
  switch (result.kind) {
    case "summary":
      if (result.points.length === 0) return <p className="py-6 text-sm text-ink-3">Nothing came back. Try again.</p>;
      return <Markdown className={box} katex={katex} text={result.points.map((p) => `- ${p}`).join("\n")} />;
    case "terms":
      if (result.terms.length === 0) return <p className="py-6 text-sm text-ink-3">No key terms came back. Try again.</p>;
      return <Markdown className={box} katex={katex} text={result.terms.map((t) => `- **${t.term}**: ${t.meaning}`).join("\n")} />;
    case "quiz":
      return material ? (
        <QuizView
          className={box}
          questions={result.questions}
          onChange={(questions) => onChange({ ...result, questions })}
          material={material}
          katex={katex}
        />
      ) : null;
    case "tasks":
      if (result.tasks.length === 0) return <p className="py-6 text-sm text-ink-3">No tasks were found in this note.</p>;
      return (
        <div className={cn(box, "task-group")}>
          {result.tasks.map((t, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-2.5">
              <TaskCheck
                size={20}
                checked={t.include}
                onToggle={() => onChange({ ...result, tasks: result.tasks.map((x, j) => (j === i ? { ...x, include: !x.include } : x)) })}
                ariaLabel={`Include “${t.title}”`}
              />
              <div className="min-w-0 flex-1">
                <div className={cn("text-[15px] leading-snug", !t.include && "text-ink-3")}>{t.title}</div>
                <div className="font-mono text-[12px] text-ink-3">
                  {format(t.date, "EEE d MMM")}
                  {t.minutes > 0 && ` · ${formatDuration(t.minutes)}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    case "write":
      return (
        <div ref={scroller} className={box}>
          <Markdown katex={katex} text={result.text} />
        </div>
      );
    case "chat":
      return null;
  }
}

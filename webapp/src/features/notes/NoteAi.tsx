"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type QuillType from "quill";
import { format } from "date-fns";
import { ArrowUp, BookOpen, CircleHelp, Lightbulb, ListChecks, MessageCircle, PenLine, Sparkles, SpellCheck, Wand2 } from "lucide-react";
import { AiError, chatJson, chatStream, useAiKey, type AiMode, type ChatMessage } from "@/lib/ai";
import type { DeltaOp } from "@/lib/delta";
import { deltaToHtml } from "@/lib/deltaHtml";
import { markdownToDelta } from "@/lib/markdownPaste";
import type { StudyNote } from "@/lib/model";
import { markdownLines, sectionAt, toMarkdown } from "@/lib/noteMarkdown";
import {
  askMessages,
  cleanText,
  continueMessages,
  editMessages,
  explainMessages,
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

type Range = { index: number; length: number };
type Katex = typeof import("katex").default;

/** The note when the menu opened: as Markdown, where the cursor was, and what it's in. */
interface Snapshot {
  note: NoteContext;
  plain: string;
  range: Range | null;
  selection: string | null;
  section: { title: string; text: string; end: number } | null;
}

type WriteVerb = "explain" | "continue" | "clearer" | "fix";

/** What came back, and how it can go into the note. */
type Result =
  | { kind: "summary"; points: string[] }
  | { kind: "terms"; terms: { term: string; meaning: string }[] }
  | { kind: "quiz"; questions: { q: string; a: string; shown: boolean }[] }
  | { kind: "chat"; focus: Focus; options: Focus[]; turns: { q: string; a: string }[]; at: number; added?: number }
  | { kind: "write"; verb: WriteVerb; text: string; range: Range | null; at: number }
  | { kind: "tasks"; tasks: { title: string; date: Date; minutes: number; include: boolean }[] };

const RESULT_LABEL: Record<Result["kind"], string> = {
  summary: "Summary",
  terms: "Key terms",
  quiz: "Practice questions",
  chat: "Ask",
  write: "",
  tasks: "Tasks found in the note",
};
const WRITE_LABEL: Record<WriteVerb, string> = { explain: "Explanation", continue: "Continued", clearer: "Rewritten", fix: "Corrected" };

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

/** Markdown from the AI as rich text (lists, bold, formulas), as whole lines at [at]. */
function insertLines(quill: QuillType, markdown: string, at: number) {
  const ops = markdownToDelta(markdown);
  if (!ops.length) return;
  quill.updateContents([{ retain: at }, ...ops] as never, "user");
  quill.setSelection(at + opsLength(ops) - 1, 0, "silent");
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

function useKatex(active: boolean) {
  const [katex, setKatex] = useState<Katex | null>(null);
  useEffect(() => {
    if (active && !katex) void import("katex").then((m) => setKatex(() => m.default));
  }, [active, katex]);
  return katex;
}

/** The AI's Markdown, rendered the way the note shows it (formulas included). */
function Markdown({ text, katex, className }: { text: string; katex: Katex | null; className?: string }) {
  const html = useMemo(
    () =>
      deltaToHtml(markdownToDelta(text), {
        formula: (tex, display) => (katex ? katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" }) : null),
      }),
    [text, katex],
  );
  return <div className={cn("doc-preview", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

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
  const abort = useRef<AbortController | null>(null);
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

  const ready = (s: Snapshot | null): s is Snapshot => {
    if (!hasKey) {
      toast("Add your DeepSeek API key in Settings to use the AI tools.", { label: "Settings", run: () => navigate({ view: "settings" }) });
      return false;
    }
    if (!s || !quill) return false;
    if (s.plain.length < 20) {
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
    const controller = start(label);
    setResult({ kind: "write", verb, text: "", range, at });
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
      setResult(null);
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
    runJson<{ questions?: { q?: string; a?: string }[] }>("Writing questions", quizMessages(s.note), "think", (a) => ({
      kind: "quiz",
      questions: (a.questions ?? []).filter((x) => x.q && x.a).slice(0, 8).map((x) => ({ q: x.q!, a: x.a!, shown: false })),
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

  /** Opens the conversation: about the selection, the section the cursor is in, or the whole note. */
  const openAsk = (s: Snapshot) => {
    if (!quill) return;
    const options: Focus[] = [];
    if (s.selection) options.push({ kind: "selection", text: s.selection });
    if (s.section) options.push({ kind: "section", title: s.section.title, text: s.section.text });
    options.push({ kind: "note" });
    const focus = options[0];
    const at = focus.kind === "selection" && s.range ? s.range.index + s.range.length - 1 : focus.kind === "section" && s.section ? s.section.end : quill.getLength() - 1;
    abort.current?.abort();
    setError(null);
    setBusy(null);
    setDraft("");
    setResult({ kind: "chat", focus, options, turns: [], at });
    setTimeout(() => input.current?.focus(), 50);
  };

  const ask = async () => {
    const question = draft.trim();
    if (!question || !snap || result?.kind !== "chat" || busy) return;
    const chat = result;
    setDraft("");
    const controller = start("Thinking");
    const messages = askMessages(snap.note, chat.focus, chat.turns, question);
    setResult({ ...chat, turns: [...chat.turns, { q: question, a: "" }] });
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
      // Take the question back so it can be asked again.
      setResult((r) => (r?.kind === "chat" ? { ...r, turns: r.turns.slice(0, -1) } : r));
      setDraft(question);
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
    setBusy(null);
    setResult(null);
    setError(null);
  };

  const apply = (where: "top" | "end" | "here") => {
    if (!quill || !result) return;
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
        const at = lineAfter(quill, result.at);
        insertLines(quill, `**${last.q}**\n${last.a}`, at);
        // The next answer goes after this one.
        setResult({ ...result, at: quill.getSelection()?.index ?? at, added: result.turns.length });
        toast("Added to the note");
        return;
      }
      case "write":
        if (result.verb === "clearer" || result.verb === "fix") {
          if (result.range) replaceRange(quill, result.range, result.text);
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

  const runTool = (tool: (s: Snapshot) => unknown) => {
    if (ready(snap)) void tool(snap);
  };
  const items: MenuItem[] = [
    {
      label: snap?.selection ? "Ask about the selection…" : snap?.section ? `Ask about “${snap.section.title}”…` : "Ask about this note…",
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
          {error && <p className="py-6 text-sm text-danger">{error}</p>}
          {result?.kind === "chat" ? (
            <ChatView
              result={result}
              busy={busy}
              katex={katex}
              scroller={scroller}
              input={input}
              draft={draft}
              setDraft={setDraft}
              onAsk={() => void ask()}
              onFocus={setFocus}
            />
          ) : (
            result && !waiting && <ResultView result={result} katex={katex} scroller={scroller} onChange={setResult} />
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {result && result.kind !== "chat" ? "Discard" : "Close"}
            </Button>
            {!busy && result?.kind === "summary" && <Button onClick={() => apply("top")}>Add at the top</Button>}
            {!busy && result && (result.kind === "summary" || result.kind === "terms" || result.kind === "quiz") && (
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

function ChatView({
  result,
  busy,
  katex,
  scroller,
  input,
  draft,
  setDraft,
  onAsk,
  onFocus,
}: {
  result: Extract<Result, { kind: "chat" }>;
  busy: string | null;
  katex: Katex | null;
  scroller: React.RefObject<HTMLDivElement | null>;
  input: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (s: string) => void;
  onAsk: () => void;
  onFocus: (f: Focus) => void;
}) {
  const started = result.turns.length > 0;
  return (
    <div className="flex min-h-0 flex-col">
      {!started && result.options.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.options.map((f, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onFocus(f)}
              className={cn(
                "max-w-[220px] truncate rounded-full border px-2.5 py-1 text-xs transition-colors",
                f.kind === result.focus.kind ? "border-transparent bg-ink text-on-ink" : "border-line-strong text-ink-2 hover:bg-fill",
              )}
            >
              {focusLabel(f)}
            </button>
          ))}
        </div>
      )}
      {started && (
        <div ref={scroller} className="scroll-area mt-3 max-h-[52dvh] space-y-4 pr-1">
          {result.turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <p className="ml-auto w-fit max-w-[85%] rounded-[14px] bg-fill-strong px-3 py-1.5 text-[15px] leading-snug whitespace-pre-wrap">{t.q}</p>
              {t.a ? (
                <Markdown text={t.a} katex={katex} className="text-[15px]" />
              ) : (
                busy && i === result.turns.length - 1 && (
                  <div className="flex items-center gap-2 text-sm text-ink-3">
                    <Spinner className="size-3.5" />
                    Thinking…
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
      <form
        className="mt-3 flex items-end gap-2 rounded-[14px] border border-line-strong bg-card py-1.5 pr-1.5 pl-3 focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          onAsk();
        }}
      >
        <textarea
          ref={input}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onAsk();
            }
          }}
          placeholder={started ? "Ask a follow-up…" : result.focus.kind === "note" ? "Ask anything about this note…" : `Ask about ${focusLabel(result.focus).toLowerCase() === "the selection" ? "the selection" : `“${focusLabel(result.focus)}”`}…`}
          className="field-sizing-content max-h-32 min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-snug outline-none placeholder:text-ink-4"
        />
        <IconButton label="Ask" type="submit" disabled={!draft.trim() || busy != null} className="rounded-full bg-accent text-white hover:bg-accent hover:text-white active:bg-accent">
          <ArrowUp className="size-4" />
        </IconButton>
      </form>
    </div>
  );
}

function ResultView({
  result,
  katex,
  scroller,
  onChange,
}: {
  result: Result;
  katex: Katex | null;
  scroller: React.RefObject<HTMLDivElement | null>;
  onChange: (r: Result) => void;
}) {
  const box = "scroll-area mt-3 max-h-[52dvh] text-[15px] leading-relaxed";
  switch (result.kind) {
    case "summary":
      return <Markdown className={box} katex={katex} text={result.points.map((p) => `- ${p}`).join("\n")} />;
    case "terms":
      return <Markdown className={box} katex={katex} text={result.terms.map((t) => `- **${t.term}**: ${t.meaning}`).join("\n")} />;
    case "quiz":
      if (result.questions.length === 0) return <p className="py-6 text-sm text-ink-3">No questions came back. Try again.</p>;
      return (
        <ol className={cn(box, "space-y-3")}>
          {result.questions.map((x, i) => (
            <li key={i} className="rounded-[12px] bg-fill px-3.5 py-3">
              <div className="flex gap-1.5 font-medium">
                <span className="tnum">{i + 1}.</span>
                <Markdown katex={katex} className="min-w-0 flex-1" text={x.q} />
              </div>
              {x.shown ? (
                <Markdown katex={katex} className="mt-1.5 text-ink-2" text={x.a} />
              ) : (
                <button
                  type="button"
                  className="mt-1.5 text-sm font-medium text-accent"
                  onClick={() => onChange({ ...result, questions: result.questions.map((y, j) => (j === i ? { ...y, shown: true } : y)) })}
                >
                  Show answer
                </button>
              )}
            </li>
          ))}
        </ol>
      );
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

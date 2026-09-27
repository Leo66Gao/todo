"use client";

import { useEffect, useRef, useState } from "react";
import type QuillType from "quill";
import { format } from "date-fns";
import { Sparkles } from "lucide-react";
import { AiError, chatJson, useAiKey, type ChatMessage } from "@/lib/ai";
import type { StudyNote } from "@/lib/model";
import { formatDuration, startOfDay, today } from "@/lib/time";
import { useNavigate } from "@/shell/nav";
import { addTask, newTask, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, IconButton, Spinner } from "@/ui/controls";
import { Menu, Modal, promptDialog } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { TaskCheck } from "@/features/tasks/TaskCheck";

type Range = { index: number; length: number };

/** What came back, and how it can go into the note. */
type Result =
  | { kind: "summary"; title: string; points: string[] }
  | { kind: "terms"; terms: { term: string; meaning: string }[] }
  | { kind: "answer"; question: string; text: string }
  | { kind: "rewrite"; text: string; range: Range; verb: string }
  | { kind: "explain"; text: string }
  | { kind: "continue"; text: string; at: number }
  | { kind: "tasks"; tasks: { title: string; date: Date; minutes: number; include: boolean }[] };

const MAX_TEXT = 14_000;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const system = (note: StudyNote, subject?: string): ChatMessage => ({
  role: "system",
  content: [
    "You help a high-school student with their study notes.",
    `The note is titled "${note.title || "Untitled"}"${subject ? `, for ${subject}` : ""}.`,
    "Write in the language the note is written in. Be accurate and concise; never invent facts that aren't in the note unless asked to explain.",
    "Answer only with a JSON object in the shape asked for.",
  ].join(" "),
});

/**
 * The note's AI helper (DeepSeek, with the key kept on this device). Each
 * tool shows its answer first; nothing goes into the note until it's added.
 */
export function NoteAiButton({ quill, note }: { quill: QuillType | null; note: StudyNote }) {
  const navigate = useNavigate();
  const hasKey = useAiKey((s) => !!s.key);
  const subject = useWorkspace((s) => s.projects.find((p) => p.id === note.subjectId));
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // The selection when the menu opened (tapping the button takes focus from the text).
  const selection = useRef<Range | null>(null);
  const lastRange = useRef<Range | null>(null);
  useEffect(() => {
    if (!quill) return;
    const track = (range: Range | null) => {
      if (range) lastRange.current = { index: range.index, length: range.length };
    };
    quill.on("selection-change", track);
    return () => void quill.off("selection-change", track);
  }, [quill]);

  const text = () => (quill?.getText() ?? "").trim().slice(0, MAX_TEXT);
  const selected = () => {
    const range = selection.current;
    return range && range.length > 0 && quill ? { range, text: quill.getText(range.index, range.length).trim() } : null;
  };

  const run = async <T,>(label: string, prompt: string, read: (answer: T) => Result) => {
    if (!hasKey) {
      toast("Add your DeepSeek API key in Settings to use the AI tools.", { label: "Settings", run: () => navigate({ view: "settings" }) });
      return;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setResult(null);
    setBusy(label);
    try {
      const answer = await chatJson<T>([system(note, subject?.title), { role: "user", content: prompt }], controller.signal);
      setResult(read(answer));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof AiError ? e.message : "Something went wrong. Try again.");
    } finally {
      if (abort.current === controller) setBusy(null);
    }
  };

  const needText = () => {
    if (text().length >= 20) return true;
    toast("Write a little more first.");
    return false;
  };

  const summarise = () =>
    needText() &&
    run<{ title?: string; points?: string[] }>(
      "Summarising",
      `Summarise this note as 3 to 7 short bullet points covering the key ideas. Reply as {"points": ["..."]}.\n\nNOTE:\n${text()}`,
      (a) => ({ kind: "summary", title: "Summary", points: (a.points ?? []).filter(Boolean).slice(0, 10) }),
    );

  const keyTerms = () =>
    needText() &&
    run<{ terms?: { term?: string; meaning?: string }[] }>(
      "Finding key terms",
      `List the important terms or concepts in this note with a one-sentence meaning each (from the note where possible). Reply as {"terms": [{"term": "...", "meaning": "..."}]}.\n\nNOTE:\n${text()}`,
      (a) => ({
        kind: "terms",
        terms: (a.terms ?? []).filter((t) => t.term && t.meaning).map((t) => ({ term: t.term!, meaning: t.meaning! })).slice(0, 15),
      }),
    );

  const withSelection = (verb: string, instruction: string) => {
    const sel = selected();
    if (!sel) {
      toast("Select some text in the note first.");
      return;
    }
    void run<{ text?: string }>(
      verb,
      `${instruction} Reply as {"text": "..."} using plain text (keep line breaks).\n\nTEXT:\n${sel.text}\n\nTHE WHOLE NOTE, FOR CONTEXT:\n${text()}`,
      (a) => ({ kind: "rewrite", text: (a.text ?? "").trim(), range: sel.range, verb }),
    );
  };

  const explain = () => {
    const sel = selected();
    if (!sel) {
      toast("Select what you’d like explained first.");
      return;
    }
    void run<{ text?: string }>(
      "Explaining",
      `Explain this simply, as to a student meeting it for the first time, in 2 to 5 sentences with an example if it helps. Reply as {"text": "..."}.\n\nTEXT:\n${sel.text}\n\nTHE WHOLE NOTE, FOR CONTEXT:\n${text()}`,
      (a) => ({ kind: "explain", text: (a.text ?? "").trim() }),
    );
  };

  const continueWriting = () => {
    if (!needText() || !quill) return;
    const at = selection.current ? selection.current.index + selection.current.length : quill.getLength() - 1;
    const before = quill.getText(0, at).slice(-MAX_TEXT);
    void run<{ text?: string }>(
      "Writing",
      `Continue this note from where the text stops with one or two paragraphs in the same style and level. Don't repeat what's there. Reply as {"text": "..."}.\n\nNOTE SO FAR:\n${before}`,
      (a) => ({ kind: "continue", text: (a.text ?? "").trim(), at }),
    );
  };

  const ask = async () => {
    if (!needText()) return;
    const question = await promptDialog({ title: "Ask about this note", placeholder: "What would you like to know?", confirmLabel: "Ask" });
    if (!question) return;
    void run<{ text?: string }>(
      "Thinking",
      `Answer the student's question using the note (say so if the note doesn't cover it, then answer briefly from general knowledge). Reply as {"text": "..."}.\n\nQUESTION: ${question}\n\nNOTE:\n${text()}`,
      (a) => ({ kind: "answer", question, text: (a.text ?? "").trim() }),
    );
  };

  const toTasks = () => {
    if (!needText()) return;
    const now = today();
    void run<{ tasks?: { title?: string; date?: string; minutes?: number }[] }>(
      "Finding tasks",
      `Find the things to do in this note (homework, deadlines, revision, readings). Today is ${format(now, "EEEE yyyy-MM-dd")}. For each give a short title, a date (yyyy-MM-dd; the deadline if one is given, otherwise a sensible day soon) and the minutes it needs. Reply as {"tasks": [{"title": "...", "date": "yyyy-MM-dd", "minutes": 30}]}, or {"tasks": []} if there are none.\n\nNOTE:\n${text()}`,
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

  // ---- Putting answers into the note

  const insertHtml = (html: string, at?: number) => {
    if (!quill) return;
    const index = at ?? quill.getLength() - 1;
    quill.clipboard.dangerouslyPasteHTML(index, html, "user");
    quill.setSelection(Math.min(quill.getLength() - 1, index), 0, "silent");
  };
  const paragraphs = (s: string) =>
    s
      .split(/\n{1,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${escape(p)}</p>`)
      .join("");

  const close = () => {
    abort.current?.abort();
    setBusy(null);
    setResult(null);
    setError(null);
  };

  const apply = (where: "top" | "end" | "replace" | "here") => {
    if (!quill || !result) return;
    switch (result.kind) {
      case "summary": {
        const html = `<h3>${escape(result.title)}</h3><ul>${result.points.map((p) => `<li>${escape(p)}</li>`).join("")}</ul>`;
        insertHtml(html, where === "top" ? 0 : undefined);
        break;
      }
      case "terms":
        insertHtml(`<h3>Key terms</h3><ul>${result.terms.map((t) => `<li><strong>${escape(t.term)}</strong> — ${escape(t.meaning)}</li>`).join("")}</ul>`);
        break;
      case "answer":
        insertHtml(`<p><strong>${escape(result.question)}</strong></p>${paragraphs(result.text)}`);
        break;
      case "explain":
        insertHtml(paragraphs(result.text), selection.current ? selection.current.index + selection.current.length : undefined);
        break;
      case "continue":
        insertHtml(paragraphs(result.text), result.at);
        break;
      case "rewrite":
        quill.deleteText(result.range.index, result.range.length, "user");
        quill.insertText(result.range.index, result.text, "user");
        quill.setSelection(result.range.index + result.text.length, 0, "silent");
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

  const onMenu = (open: boolean) => {
    if (!open || !quill) return;
    const range = quill.getSelection() ?? lastRange.current;
    selection.current = range ? { index: range.index, length: range.length } : null;
  };

  return (
    <>
      <Menu
        align="end"
        onOpenChange={onMenu}
        trigger={
          <IconButton label="AI tools">
            <Sparkles className="size-4 max-md:size-[18px]" />
          </IconButton>
        }
        items={[
          { label: "Summarise", onSelect: summarise },
          { label: "Key terms", onSelect: keyTerms },
          { label: "Ask about this note…", onSelect: () => void ask() },
          { label: "Continue writing", onSelect: continueWriting },
          { separator: true },
          { label: "Rewrite the selection more clearly", onSelect: () => withSelection("Rewriting", "Rewrite this more clearly and concisely, keeping every fact.") },
          { label: "Fix spelling and grammar", onSelect: () => withSelection("Correcting", "Fix the spelling, grammar and punctuation of this without changing its meaning or style.") },
          { label: "Explain the selection", onSelect: explain },
          { separator: true },
          { label: "Turn into tasks", onSelect: toTasks },
        ]}
      />
      <Modal
        open={busy != null || result != null || error != null}
        onOpenChange={(open) => !open && close()}
        width={520}
        label="AI"
        initialFocus={(e) => e.preventDefault()}
      >
        <div className="flex min-h-0 flex-col px-5 pt-4 pb-5">
          <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
            <Sparkles className="size-3.5" />
            {busy ?? (error ? "Couldn’t finish" : RESULT_LABEL[result?.kind ?? "summary"])}
          </div>
          {busy && (
            <div className="flex items-center gap-3 py-10 text-sm text-ink-3">
              <Spinner />
              {busy}…
            </div>
          )}
          {error && <p className="py-6 text-sm text-danger">{error}</p>}
          {result && <ResultView result={result} onChange={setResult} />}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {result ? "Discard" : "Close"}
            </Button>
            {result?.kind === "summary" && <Button onClick={() => apply("top")}>Add at the top</Button>}
            {result && result.kind !== "tasks" && result.kind !== "rewrite" && (
              <Button variant="primary" onClick={() => apply("end")}>
                {result.kind === "continue" || result.kind === "explain" ? "Insert" : "Add to the note"}
              </Button>
            )}
            {result?.kind === "rewrite" && (
              <Button variant="primary" disabled={!result.text} onClick={() => apply("replace")}>
                Replace the selection
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

const RESULT_LABEL: Record<Result["kind"], string> = {
  summary: "Summary",
  terms: "Key terms",
  answer: "Answer",
  rewrite: "Rewritten",
  explain: "Explanation",
  continue: "Continued",
  tasks: "Tasks found in the note",
};

function ResultView({ result, onChange }: { result: Result; onChange: (r: Result) => void }) {
  const box = "scroll-area mt-3 max-h-[50dvh] text-[15px] leading-relaxed";
  switch (result.kind) {
    case "summary":
      return (
        <ul className={cn(box, "list-disc space-y-1.5 pl-5")}>
          {result.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      );
    case "terms":
      return (
        <dl className={cn(box, "space-y-2.5")}>
          {result.terms.map((t, i) => (
            <div key={i}>
              <dt className="font-semibold">{t.term}</dt>
              <dd className="text-ink-2">{t.meaning}</dd>
            </div>
          ))}
        </dl>
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
    case "answer":
    case "explain":
    case "rewrite":
    case "continue":
      return <div className={cn(box, "whitespace-pre-wrap")}>{result.text || "Nothing came back. Try again."}</div>;
  }
}

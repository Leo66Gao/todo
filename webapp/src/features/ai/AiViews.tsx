"use client";

// The pieces every AI panel shares: answers rendered as rich text (formulas
// included), a conversation with a question box, and practice questions you
// can answer and have checked.

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowUp, Camera, Check, CircleAlert, X } from "lucide-react";
import { AiError, chatJson } from "@/lib/ai";
import { deltaToHtml } from "@/lib/deltaHtml";
import { markdownToDelta } from "@/lib/markdownPaste";
import { checkAnswerMessages, type NoteContext } from "@/lib/notePrompts";
import { choosePhotos, photoDataUrl } from "@/lib/photoData";
import { toast } from "@/ui/toast";
import { cn } from "@/ui/cn";
import { Button, IconButton, Spinner } from "@/ui/controls";

export type Katex = typeof import("katex").default;

export function useKatex(active: boolean) {
  const [katex, setKatex] = useState<Katex | null>(null);
  useEffect(() => {
    if (active && !katex) void import("katex").then((m) => setKatex(() => m.default));
  }, [active, katex]);
  return katex;
}

/** The AI's Markdown, rendered the way notes show it. */
export function Markdown({ text, katex, className }: { text: string; katex: Katex | null; className?: string }) {
  const html = useMemo(
    () =>
      deltaToHtml(markdownToDelta(text), {
        formula: (tex, display) => (katex ? katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" }) : null),
      }),
    [text, katex],
  );
  return <div className={cn("doc-preview", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** What's asked when only a photo is sent. */
export const PHOTO_QUESTION = "Help me with this.";

/** Photos waiting to go with the next question. */
export function usePhotoAttachments(max = 4) {
  const [images, setImages] = useState<string[]>([]);
  const attach = async () => {
    if (images.length >= max) {
      toast(`Up to ${max} photos per question.`);
      return;
    }
    const files = await choosePhotos();
    if (!files.length) return;
    try {
      const urls = await Promise.all(files.map(photoDataUrl));
      if (images.length + urls.length > max) toast(`Up to ${max} photos per question: the first ${max} are attached.`);
      setImages((prev) => [...prev, ...urls].slice(0, max));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return {
    images,
    attach,
    remove: (i: number) => setImages((prev) => prev.filter((_, j) => j !== i)),
    clear: () => setImages([]),
    /** Puts a photo back (its question failed to send). */
    restore: (url: string) => setImages((prev) => (prev.includes(url) ? prev : [...prev, url])),
  };
}

export interface Turn {
  q: string;
  a: string;
  /** Photos sent with the question. */
  images?: string[];
}

/** A conversation: questions, answers as they stream in, and the box for the next question. */
export function ChatPanel({
  turns,
  busy,
  katex,
  scroller,
  input,
  draft,
  setDraft,
  onAsk,
  placeholder,
  before,
  after,
  images,
  onAttach,
  onRemoveImage,
}: {
  turns: Turn[];
  busy: boolean;
  katex: Katex | null;
  scroller: RefObject<HTMLDivElement | null>;
  input: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (s: string) => void;
  onAsk: () => void;
  placeholder: string;
  /** Shown above the box before the first question (what it's about). */
  before?: ReactNode;
  /** Shown under an answer once it's complete (its sources). */
  after?: (turn: Turn, index: number) => ReactNode;
  /** Photos waiting to go with the next question. */
  images?: string[];
  /** Offers to add a photo (a problem, a diagram, a page). */
  onAttach?: () => Promise<void>;
  onRemoveImage?: (index: number) => void;
}) {
  const canSend = (!!draft.trim() || !!images?.length) && !busy;
  return (
    <div className="flex min-h-0 flex-col">
      {turns.length === 0 && before}
      {turns.length > 0 && (
        <div ref={scroller} className="scroll-area mt-3 max-h-[52dvh] space-y-4 pr-1">
          {turns.map((t, i) => {
            const streaming = busy && i === turns.length - 1;
            return (
              <div key={i} className="space-y-2">
                {t.images?.length ? (
                  <div className="ml-auto flex w-fit max-w-[85%] flex-wrap justify-end gap-1.5">
                    {t.images.map((url, j) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} src={url} alt="" className="h-20 w-auto rounded-[10px] border border-line object-cover" />
                    ))}
                  </div>
                ) : null}
                {t.q && <p className="ml-auto w-fit max-w-[85%] rounded-[14px] bg-fill-strong px-3 py-1.5 text-[15px] leading-snug whitespace-pre-wrap">{t.q}</p>}
                {t.a ? (
                  <Markdown text={t.a} katex={katex} className="text-[15px]" />
                ) : (
                  streaming && (
                    <div className="flex items-center gap-2 text-sm text-ink-3">
                      <Spinner className="size-3.5" />
                      Thinking…
                    </div>
                  )
                )}
                {!streaming && t.a && after?.(t, i)}
              </div>
            );
          })}
        </div>
      )}
      {images && images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((url, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-14 w-auto rounded-[8px] border border-line object-cover" />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => onRemoveImage?.(i)}
                className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-on-ink"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className={cn(
          "mt-3 flex items-end gap-1.5 rounded-[14px] border border-line-strong bg-card py-1.5 pr-1.5 focus-within:border-accent",
          onAttach ? "pl-1.5" : "pl-3",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          onAsk();
        }}
      >
        {onAttach && (
          <IconButton
            label="Add a photo"
            disabled={busy}
            className="rounded-full"
            // Back to the question box afterwards, so Enter sends rather than picking again.
            onClick={() => void onAttach().then(() => input.current?.focus())}
          >
            <Camera className="size-4" />
          </IconButton>
        )}
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
          placeholder={images?.length ? "Ask about the photo…" : turns.length ? "Ask a follow-up…" : placeholder}
          className="field-sizing-content max-h-32 min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-snug outline-none placeholder:text-ink-4"
        />
        <IconButton label="Ask" type="submit" disabled={!canSend} className="rounded-full bg-accent text-white hover:bg-accent hover:text-white pointer-fine:active:bg-accent">
          <ArrowUp className="size-4" />
        </IconButton>
      </form>
    </div>
  );
}

export interface QuizQuestion {
  q: string;
  a: string;
  shown: boolean;
  attempt?: string;
  checking?: boolean;
  check?: { verdict: "right" | "partly" | "wrong"; feedback: string } | null;
  /** Why the last check didn't come back. */
  checkError?: string | null;
}

/** Reads the questions out of a JSON answer. */
export const readQuestions = (answer: { questions?: { q?: unknown; a?: unknown }[] }): QuizQuestion[] =>
  (answer.questions ?? [])
    .filter((x): x is { q: string; a: string } => typeof x?.q === "string" && typeof x?.a === "string" && !!x.q.trim())
    .slice(0, 10)
    .map((x) => ({ q: x.q, a: x.a, shown: false }));

const VERDICT = {
  right: { label: "Right", icon: <Check className="size-3.5" />, tone: "text-[var(--p-low)]" },
  partly: { label: "Partly right", icon: <CircleAlert className="size-3.5" />, tone: "text-[var(--p-medium)]" },
  wrong: { label: "Not quite", icon: <X className="size-3.5" />, tone: "text-[var(--p-critical)]" },
} as const;

/**
 * Practice questions: write an answer and have it checked (what's right,
 * what's missing), or just show the model answer.
 */
export function QuizView({
  questions,
  onChange,
  material,
  katex,
  className,
}: {
  questions: QuizQuestion[];
  onChange: (next: QuizQuestion[]) => void;
  /** What the questions were written from, for checking answers against. */
  material: NoteContext;
  katex: Katex | null;
  className?: string;
}) {
  // A check can finish after other answers were typed: always edit the latest list.
  const latestRef = useRef(questions);
  useEffect(() => {
    latestRef.current = questions;
  }, [questions]);
  const update = (i: number, patch: Partial<QuizQuestion>) => {
    const next = latestRef.current.map((x, j) => (j === i ? { ...x, ...patch } : x));
    latestRef.current = next;
    onChange(next);
  };

  const check = async (i: number) => {
    const x = latestRef.current[i];
    const attempt = x.attempt?.trim();
    if (!attempt || x.checking) return;
    update(i, { checking: true, check: null, checkError: null });
    try {
      const answer = await chatJson<{ verdict?: string; feedback?: string }>(checkAnswerMessages(material, x.q, x.a, attempt), undefined, "fast");
      const verdict = answer.verdict === "right" || answer.verdict === "partly" || answer.verdict === "wrong" ? answer.verdict : "partly";
      update(i, { checking: false, check: { verdict, feedback: (answer.feedback ?? "").trim() }, shown: true });
    } catch (e) {
      update(i, { checking: false, checkError: e instanceof AiError ? e.message : "Couldn’t check that. Try again." });
    }
  };

  if (questions.length === 0) return <p className="py-6 text-sm text-ink-3">No questions came back. Try again.</p>;
  return (
    <ol className={cn("space-y-3", className)}>
      {questions.map((x, i) => (
        <li key={i} className="rounded-[12px] bg-fill px-3.5 py-3">
          <div className="flex gap-1.5 font-medium">
            <span className="tnum">{i + 1}.</span>
            <Markdown katex={katex} className="min-w-0 flex-1" text={x.q} />
          </div>
          <textarea
            value={x.attempt ?? ""}
            rows={1}
            onChange={(e) => update(i, { attempt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void check(i);
              }
            }}
            placeholder="Your answer"
            className="field-sizing-content mt-2 max-h-40 min-h-[34px] w-full resize-none rounded-[9px] border border-line-strong bg-card px-2.5 py-1.5 text-[15px] leading-snug outline-none placeholder:text-ink-4 focus:border-accent"
          />
          {x.check && (
            <div className="mt-2 text-[14px]">
              <div className={cn("flex items-center gap-1 font-medium", VERDICT[x.check.verdict].tone)}>
                {VERDICT[x.check.verdict].icon}
                {VERDICT[x.check.verdict].label}
              </div>
              {x.check.feedback && <Markdown katex={katex} className="mt-0.5 text-ink-2" text={x.check.feedback} />}
            </div>
          )}
          {x.checkError && <p className="mt-2 text-[14px] text-danger">{x.checkError}</p>}
          {x.shown && (
            <div className="mt-2 border-t border-line pt-2 text-[14px]">
              <span className="text-xs font-medium text-ink-3">Model answer</span>
              <Markdown katex={katex} className="text-ink-2" text={x.a} />
            </div>
          )}
          <div className="mt-2 flex items-center gap-3">
            {x.attempt?.trim() && (
              <Button size="sm" variant="secondary" disabled={x.checking} icon={x.checking ? <Spinner className="size-3" /> : undefined} onClick={() => void check(i)}>
                {x.checking ? "Checking" : x.check ? "Check again" : "Check my answer"}
              </Button>
            )}
            {!x.shown && (
              <button type="button" className="text-sm font-medium text-accent" onClick={() => update(i, { shown: true })}>
                Show answer
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { friendlyFromTex, friendlyTex } from "@/lib/friendlyTex";
import { DISPLAY } from "@/lib/markdownPaste";
import { Button, Switch } from "./controls";
import { Modal, useAutoFocus } from "./overlay";

type Katex = typeof import("katex").default;

interface FormulaRequest {
  tex: string;
  editing: boolean;
  resolve: (result: { tex: string } | { remove: true } | null) => void;
}

const useFormula = create<{ current: FormulaRequest | null }>(() => ({ current: null }));

/** Asks for a formula; resolves with its TeX, a removal, or null when cancelled. */
export function formulaDialog(tex: string, editing: boolean) {
  return new Promise<{ tex: string } | { remove: true } | null>((resolve) =>
    useFormula.setState({ current: { tex, editing, resolve } }),
  );
}

/** Buttons for what's awkward to type. `|` marks where the cursor goes. */
const SYMBOLS: { label: string; insert: string }[] = [
  { label: "\\frac{a}{b}", insert: "\\frac{|}{}" },
  { label: "x^{n}", insert: "^{|}" },
  { label: "x_{i}", insert: "_{|}" },
  { label: "\\sqrt{x}", insert: "\\sqrt{|}" },
  { label: "\\pi", insert: "\\pi " },
  { label: "\\theta", insert: "\\theta " },
  { label: "\\Delta", insert: "\\Delta " },
  { label: "\\lambda", insert: "\\lambda " },
  { label: "\\mu", insert: "\\mu " },
  { label: "\\times", insert: "\\times " },
  { label: "\\pm", insert: "\\pm " },
  { label: "\\le", insert: "\\le " },
  { label: "\\ge", insert: "\\ge " },
  { label: "\\approx", insert: "\\approx " },
  { label: "\\to", insert: "\\to " },
  { label: "\\infty", insert: "\\infty " },
  { label: "\\sum", insert: "\\sum_{|}^{} " },
  { label: "\\int", insert: "\\int_{|}^{} " },
  { label: "\\vec{v}", insert: "\\vec{|}" },
  { label: "x^{\\circ}", insert: "^\\circ " },
];

function useKatex() {
  const [katex, setKatex] = useState<Katex | null>(null);
  useEffect(() => {
    void import("katex").then((m) => setKatex(() => m.default));
  }, []);
  return katex;
}

function Rendered({ katex, tex, display, className }: { katex: Katex | null; tex: string; display?: boolean; className?: string }) {
  const html = katex?.renderToString(tex, { throwOnError: false, displayMode: display, strict: "ignore" }) ?? "";
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function FormulaHost() {
  const current = useFormula((s) => s.current);
  const [shown, setShown] = useState<FormulaRequest | null>(null);
  const [text, setText] = useState("");
  const [display, setDisplay] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const inputFocus = useAutoFocus();
  const katex = useKatex();

  if (current && current !== shown) {
    setShown(current);
    setDisplay(current.tex.startsWith(DISPLAY));
    setText(friendlyFromTex(current.tex.startsWith(DISPLAY) ? current.tex.slice(DISPLAY.length) : current.tex));
  }
  const request = current ?? shown;
  const tex = friendlyTex(text);

  const finish = (result: { tex: string } | { remove: true } | null) => {
    const ask = useFormula.getState().current;
    if (!ask) return;
    useFormula.setState({ current: null });
    ask.resolve(result);
  };
  const save = () => (tex ? finish({ tex: display ? DISPLAY + tex : tex }) : finish(null));

  const insert = (snippet: string) => {
    const el = input.current;
    if (!el) return;
    const [before, after] = snippet.split("|");
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = text.slice(0, start) + before + (after ?? "") + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length);
    });
  };

  return (
    <Modal open={current != null} onOpenChange={(o) => !o && finish(null)} width={480} label="Formula">
      {request && (
        <form
          className="flex flex-col p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <h2 className="text-base font-semibold">{request.editing ? "Edit formula" : "Formula"}</h2>
          <div
            aria-live="polite"
            className="mt-3.5 flex min-h-[88px] items-center justify-center overflow-x-auto rounded-pop bg-fill px-4 py-5 text-[19px] text-ink"
          >
            {tex ? (
              <Rendered katex={katex} tex={tex} display={display} />
            ) : (
              <span className="text-sm text-ink-3">The formula shows here</span>
            )}
          </div>
          <textarea
            ref={input}
            {...inputFocus}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                save();
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Type it as you'd write it: 1/2 m v^2, sqrt(x), theta >= pi"
            className="mt-3 w-full resize-none rounded-ctl border border-line-strong bg-card px-3 py-2 font-mono text-[13px] leading-5 outline-none transition-[border-color,box-shadow] placeholder:font-sans placeholder:text-ink-4 focus:border-accent focus:ring-3 focus:ring-accent-soft"
          />
          <div className="mt-2.5 flex flex-wrap gap-1">
            {SYMBOLS.map((s) => (
              <button
                key={s.label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(s.insert)}
                aria-label={s.label}
                className="flex h-8 min-w-9 items-center justify-center rounded-[8px] px-2 text-[13px] text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-fill hover:text-ink pointer-fine:active:scale-[0.94] pointer-fine:active:bg-fill-strong"
              >
                <Rendered katex={katex} tex={s.label} className="pointer-events-none" />
              </button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <button type="button" className="text-left" onClick={() => setDisplay(!display)}>
              On its own line
              <span className="block text-xs text-ink-3">Centred and full size</span>
            </button>
            <Switch checked={display} onChange={setDisplay} label="On its own line" />
          </div>
          <div className="mt-5 flex items-center gap-2">
            {request.editing && (
              <Button variant="ghost" className="text-danger" onClick={() => finish({ remove: true })}>
                Remove
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!tex && !request.editing}>
              {request.editing ? "Update" : "Insert"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

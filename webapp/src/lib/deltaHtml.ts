// A note's delta as lines and as clean HTML, for printing, previews and
// exports. Nothing here trusts the content: text is escaped and only web and
// mail links survive.

import { DISPLAY } from "./markdownPaste";
import type { DeltaOp } from "./delta";

type Attrs = Record<string, unknown>;

export interface Segment {
  text?: string;
  formula?: string;
  attrs: Attrs;
}

export interface Line {
  segments: Segment[];
  attrs: Attrs;
}

/** Splits delta ops into lines, each with its block attributes. */
export function deltaLines(ops: DeltaOp[]): Line[] {
  const lines: Line[] = [];
  let current: Segment[] = [];
  for (const op of ops) {
    const attrs = (op.attributes ?? {}) as Attrs;
    if (typeof op.insert === "string") {
      const parts = op.insert.split("\n");
      parts.forEach((part, i) => {
        if (part) current.push({ text: part, attrs });
        if (i < parts.length - 1) {
          lines.push({ segments: current, attrs });
          current = [];
        }
      });
    } else if (op.insert && typeof op.insert === "object") {
      const formula = (op.insert as { formula?: unknown }).formula;
      if (typeof formula === "string") current.push({ formula, attrs });
    }
  }
  if (current.length) lines.push({ segments: current, attrs: {} });
  return lines;
}

export const isDisplayFormula = (line: Line) =>
  line.segments.length === 1 && line.segments[0].formula?.startsWith(DISPLAY) === true;

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function exportLink(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : null;
  } catch {
    return null;
  }
}

export interface HtmlOptions {
  /** Renders a formula (TeX, with or without the display prefix). */
  formula: (tex: string, display: boolean) => string;
}

function inline(segments: Segment[], opts: HtmlOptions): string {
  return segments
    .map((s) => {
      if (s.formula != null) {
        const display = s.formula.startsWith(DISPLAY);
        return opts.formula(display ? s.formula.slice(DISPLAY.length) : s.formula, display);
      }
      let html = escape(s.text ?? "");
      const a = s.attrs;
      if (a.code) html = `<code>${html}</code>`;
      if (a.bold) html = `<strong>${html}</strong>`;
      if (a.italic) html = `<em>${html}</em>`;
      if (a.underline) html = `<u>${html}</u>`;
      if (a.strike) html = `<s>${html}</s>`;
      const href = exportLink(a.link);
      if (href) html = `<a href="${escape(href)}">${html}</a>`;
      return html;
    })
    .join("");
}

/** The note body as semantic HTML. */
export function deltaToHtml(ops: DeltaOp[], opts: HtmlOptions): string {
  const lines = deltaLines(ops);
  const out: string[] = [];
  // Open lists, innermost last: [tag, indent, kind].
  const open: [string, number, string][] = [];
  const closeTo = (indent: number) => {
    while (open.length && open[open.length - 1][1] >= indent) out.push(`</${open.pop()![0]}>`);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const a = line.attrs;
    const list = typeof a.list === "string" ? a.list : null;
    if (!list) closeTo(0);
    if (list) {
      const indent = typeof a.indent === "number" ? a.indent : 0;
      const tag = list === "ordered" ? "ol" : "ul";
      const kind = list === "checked" ? "unchecked" : list;
      closeTo(indent + 1);
      const top = open[open.length - 1];
      if (top && top[1] === indent && top[2] !== kind) closeTo(indent);
      if (!open.length || open[open.length - 1][1] < indent) {
        out.push(kind === "unchecked" ? `<${tag} class="checklist">` : `<${tag}>`);
        open.push([tag, indent, kind]);
      }
      const box = list === "checked" ? "☑ " : list === "unchecked" ? "☐ " : "";
      out.push(`<li${list === "checked" ? ' class="done"' : ""}>${box}${inline(line.segments, opts)}</li>`);
      continue;
    }
    if (a["code-block"]) {
      const code: string[] = [];
      while (i < lines.length && lines[i].attrs["code-block"]) {
        code.push(escape(lines[i].segments.map((s) => s.text ?? "").join("")));
        i++;
      }
      i--;
      out.push(`<pre><code>${code.join("\n")}</code></pre>`);
      continue;
    }
    const body = inline(line.segments, opts);
    if (a.header === 1) out.push(`<h1>${body}</h1>`);
    else if (a.header) out.push(`<h2>${body}</h2>`);
    else if (a.blockquote) out.push(`<blockquote>${body}</blockquote>`);
    else if (isDisplayFormula(line)) out.push(`<div class="math">${body}</div>`);
    else out.push(body ? `<p>${body}</p>` : `<p class="gap"></p>`);
  }
  closeTo(0);
  return out.join("\n");
}

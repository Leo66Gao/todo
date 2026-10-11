// A note as Markdown, for the AI: headings, lists, checklists, quotes, code
// and formulas keep their shape, so the model can see how the note is
// organised (and which part the student is in) instead of a flat wall of text.

import type { DeltaOp } from "./delta";
import { DISPLAY } from "./markdownPaste";

type Attrs = Record<string, unknown>;

export interface MarkdownLine {
  /** The line as Markdown. */
  md: string;
  /** Where the line starts and ends in the editor (the end is its newline). */
  start: number;
  end: number;
  /** 1 or 2 for a heading, else null. */
  header: number | null;
}

function inline(text: string, a: Attrs) {
  if (!text) return "";
  let s = a.code ? `\`${text}\`` : text;
  if (a.bold) s = `**${s}**`;
  if (a.italic) s = `*${s}*`;
  if (a.strike) s = `~~${s}~~`;
  if (typeof a.link === "string") s = `[${s}](${a.link})`;
  return s;
}

/** The note's lines as Markdown, each with its place in the editor. */
export function markdownLines(ops: DeltaOp[]): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let body = "";
  let index = 0;
  let start = 0;
  const counters: number[] = [];
  const close = (attrs: Attrs) => {
    const indent = typeof attrs.indent === "number" ? attrs.indent : 0;
    const pad = "  ".repeat(indent);
    let md = body;
    const list = typeof attrs.list === "string" ? attrs.list : null;
    if (list !== "ordered") counters.length = list ? indent + 1 : 0;
    if (attrs.header === 1) md = `# ${md}`;
    else if (attrs.header) md = `## ${md}`;
    else if (attrs.blockquote) md = `> ${md}`;
    else if (attrs["code-block"]) md = `    ${md}`;
    else if (list === "ordered") {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] ?? 0) + 1;
      md = `${pad}${counters[indent]}. ${md}`;
    } else if (list === "checked") md = `${pad}- [x] ${md}`;
    else if (list === "unchecked") md = `${pad}- [ ] ${md}`;
    else if (list) md = `${pad}- ${md}`;
    lines.push({ md, start, end: index, header: attrs.header === 1 ? 1 : attrs.header ? 2 : null });
    body = "";
    start = index + 1;
  };
  for (const op of ops) {
    const attrs = (op.attributes ?? {}) as Attrs;
    if (typeof op.insert === "string") {
      const parts = op.insert.split("\n");
      parts.forEach((part, i) => {
        body += inline(part, attrs);
        index += part.length;
        if (i < parts.length - 1) {
          close(attrs);
          index += 1;
        }
      });
    } else if (op.insert && typeof op.insert === "object") {
      const formula = (op.insert as { formula?: unknown }).formula;
      if (typeof formula === "string") {
        body += formula.startsWith(DISPLAY) ? `$$${formula.slice(DISPLAY.length)}$$` : `$${formula}$`;
      }
      index += 1;
    }
  }
  if (body) close({});
  return lines;
}

/** Joins lines into Markdown, without runs of empty lines. */
export function toMarkdown(lines: MarkdownLine[]) {
  return lines
    .map((l) => l.md)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The heading section the cursor is in: from the nearest heading above it to
 * the next heading of the same or a higher level. Null when there's no
 * heading above the cursor.
 */
export function sectionAt(lines: MarkdownLine[], index: number): { title: string; lines: MarkdownLine[] } | null {
  let at = lines.findIndex((l) => index >= l.start && index <= l.end);
  if (at < 0) at = lines.length - 1;
  let head = -1;
  for (let i = at; i >= 0; i--) {
    if (lines[i].header) {
      head = i;
      break;
    }
  }
  if (head < 0) return null;
  const level = lines[head].header!;
  let end = head + 1;
  while (end < lines.length && !(lines[end].header && lines[end].header! <= level)) end++;
  return { title: lines[head].md.replace(/^#+\s*/, "").replace(/[*_`~]/g, "").trim(), lines: lines.slice(head, end) };
}

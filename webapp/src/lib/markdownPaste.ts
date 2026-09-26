// Pasted Markdown (what Claude, ChatGPT and most chat apps copy) becomes rich
// text: headings, lists, checklists, quotes, code, bold/italic/strike, links,
// and LaTeX maths ($…$, $$…$$, \(…\), \[…\]) as rendered formulas.

import type { DeltaOp } from "./delta";

type Attrs = Record<string, unknown>;

/** Display formulas are stored with \displaystyle so they render full size. */
export const DISPLAY = "\\displaystyle ";

/** Whether plain text is worth converting (otherwise paste it as it is). */
export function looksLikeMarkdown(text: string): boolean {
  return (
    /(^|\s)\$\$[\s\S]+?\$\$|\\\(|\\\[|(^|[^\w$\\])\$[^\s$][^$\n]*?[^\s\\]\$(?!\d)/.test(text) ||
    /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```)/m.test(text) ||
    /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)/.test(text)
  );
}

/** Inline Markdown (and inline maths) within one line. */
export function inlineOps(text: string, base: Attrs = {}): DeltaOp[] {
  const out: DeltaOp[] = [];
  const push = (insert: DeltaOp["insert"], attrs: Attrs = {}) => {
    const attributes = { ...base, ...attrs };
    out.push(Object.keys(attributes).length ? { insert, attributes } : { insert });
  };
  // Order matters: maths and code first, so their contents are left alone.
  const token =
    /\\\((.+?)\\\)|\$\$(.+?)\$\$|(?<![\w$\\])\$([^\s$](?:[^$\n]*?[^\s\\])?)\$(?!\d)|`([^`]+)`|\*\*(.+?)\*\*(?!\*)|__(.+?)__(?!_)|~~(.+?)~~|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_]*?)_(?![\w_])|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let cursor = 0;
  for (const m of text.matchAll(token)) {
    const start = m.index ?? 0;
    if (start > cursor) push(text.slice(cursor, start));
    const [, paren, dollars2, dollar, code, bold, bold2, strike, italic, italic2, linkText, href] = m;
    if (paren ?? dollar) push({ formula: (paren ?? dollar)!.trim() });
    else if (dollars2) push({ formula: `${DISPLAY}${dollars2.trim()}` });
    else if (code) push(code, { code: true });
    else if (bold ?? bold2) out.push(...inlineOps((bold ?? bold2)!, { ...base, bold: true }));
    else if (strike) out.push(...inlineOps(strike, { ...base, strike: true }));
    else if (italic ?? italic2) out.push(...inlineOps((italic ?? italic2)!, { ...base, italic: true }));
    else if (linkText && href) out.push(...inlineOps(linkText, { ...base, link: href }));
    cursor = start + m[0].length;
  }
  if (cursor < text.length) push(text.slice(cursor));
  return out;
}

/** Converts Markdown text to Quill delta ops (ending with a newline). */
export function markdownToDelta(markdown: string): DeltaOp[] {
  // Lines are collected first so blank lines can be judged by their neighbours.
  const out: { content: DeltaOp[]; attrs?: Attrs }[] = [];
  const line = (content: DeltaOp[], attrs?: Attrs) => out.push({ content, attrs });
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Fenced code.
    if (/^\s*```/.test(raw)) {
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i]);
      for (const code of body.length ? body : [""]) line([{ insert: code }].filter((o) => o.insert !== ""), { "code-block": true });
      continue;
    }
    // Display maths on its own lines: $$ … $$ or \[ … \].
    const open = raw.trim().match(/^(\$\$|\\\[)(.*)$/);
    if (open) {
      const close = open[1] === "$$" ? "$$" : "\\]";
      let body = open[2];
      let closed = body.trimEnd().endsWith(close);
      while (!closed && i + 1 < lines.length) {
        i++;
        body += `\n${lines[i]}`;
        closed = lines[i].trimEnd().endsWith(close);
      }
      body = body.trimEnd();
      if (body.endsWith(close)) body = body.slice(0, -close.length);
      const tex = body.replace(/\s*\n\s*/g, " ").trim();
      if (tex) line([{ insert: { formula: `${DISPLAY}${tex}` } }]);
      continue;
    }
    // Horizontal rules and table separators carry nothing to keep.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw) || /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(raw)) continue;

    const indentWidth = raw.match(/^\s*/)![0].replace(/\t/g, "  ").length;
    const indent = Math.min(4, Math.floor(indentWidth / 2));
    const text = raw.trim();
    const indentAttr = indent > 0 ? { indent } : {};
    let m: RegExpMatchArray | null;
    if ((m = text.match(/^(#{1,6})\s+(.*)$/))) {
      line(inlineOps(m[2].replace(/\s+#+\s*$/, "")), { header: m[1].length === 1 ? 1 : 2 });
    } else if ((m = text.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/))) {
      line(inlineOps(m[2]), { list: m[1] === " " ? "unchecked" : "checked", ...indentAttr });
    } else if ((m = text.match(/^[-*+]\s+(.*)$/))) {
      line(inlineOps(m[1]), { list: "bullet", ...indentAttr });
    } else if ((m = text.match(/^\d+[.)]\s+(.*)$/))) {
      line(inlineOps(m[1]), { list: "ordered", ...indentAttr });
    } else if ((m = text.match(/^>\s?(.*)$/))) {
      line(inlineOps(m[1]), { blockquote: true });
    } else if (/^\|.*\|$/.test(text)) {
      // Table rows: cells separated by spaces, so nothing is lost.
      line(inlineOps(text.slice(1, -1).split("|").map((c) => c.trim()).join("   ")));
    } else {
      line(inlineOps(text));
    }
  }
  // Blank lines: at most one in a row, none at the ends, and none next to
  // headings or display maths, which bring their own space.
  const blank = (l?: (typeof out)[number]) => l != null && l.content.length === 0 && !l.attrs;
  const spaced = (l?: (typeof out)[number]) =>
    l != null && (l.attrs?.header != null || (l.content.length === 1 && String((l.content[0].insert as { formula?: string }).formula ?? "").startsWith(DISPLAY)));
  const ops: DeltaOp[] = [];
  out.forEach((l, i) => {
    if (blank(l)) {
      const prev = out[i - 1];
      let j = i + 1;
      while (blank(out[j])) j++;
      if (!prev || blank(prev) || j >= out.length || spaced(prev) || spaced(out[j])) return;
    }
    ops.push(...l.content);
    ops.push(l.attrs && Object.keys(l.attrs).length ? { insert: "\n", attributes: l.attrs } : { insert: "\n" });
  });
  return ops;
}

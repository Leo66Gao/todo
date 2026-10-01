// Rich text is stored as a Quill delta JSON string (the Flutter app uses
// flutter_quill, which shares the format). Older notes hold raw Markdown or
// plain text; every reader here accepts both.

import { looksLikeMarkdown, markdownToDelta } from "./markdownPaste";

export interface DeltaOp {
  insert?: unknown;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

export function parseDelta(content: string): DeltaOp[] | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;
  try {
    const decoded = JSON.parse(content);
    if (Array.isArray(decoded)) return decoded as DeltaOp[];
    if (decoded && Array.isArray(decoded.ops)) return decoded.ops as DeltaOp[];
  } catch {
    // Not JSON: legacy text.
  }
  return null;
}

export const isQuillDelta = (content: string) => parseDelta(content) != null;

/**
 * Delta ops for any stored content. Legacy Markdown shows formatted, as the
 * original app rendered it (the stored text only changes when edited);
 * other legacy text becomes plain paragraphs.
 */
export function deltaFromContent(content: string): DeltaOp[] {
  const ops = parseDelta(content);
  if (ops) return ops;
  if (looksLikeMarkdown(content)) return markdownToDelta(content);
  const text = content.endsWith("\n") ? content : `${content}\n`;
  return [{ insert: text }];
}

export function contentFromDelta(ops: DeltaOp[]): string {
  return JSON.stringify(ops);
}

/** True when a delta holds nothing but whitespace. */
export function isEmptyContent(content: string): boolean {
  return plainText(content).length === 0;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>)\s+/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/(^|[^A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g, "$1$2")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain text of stored content in either format, for previews and search. */
export function plainText(content: string): string {
  const ops = parseDelta(content);
  if (!ops) return stripMarkdown(content);
  return ops
    .map((op) => {
      if (typeof op.insert === "string") return op.insert;
      const formula = (op.insert as { formula?: unknown } | undefined)?.formula;
      return typeof formula === "string" ? ` ${formula.replace(/^\\displaystyle\s*/, "")} ` : "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

const BARE_URL = /(https?:\/\/[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;

/** Turns bare URLs into links, as the Flutter editor does on save. */
export function withAutoLinks(ops: DeltaOp[]): DeltaOp[] {
  const out: DeltaOp[] = [];
  for (const op of ops) {
    const text = typeof op.insert === "string" ? op.insert : null;
    if (!text || op.attributes?.link != null || op.attributes?.["code-block"] || op.attributes?.code) {
      out.push(op);
      continue;
    }
    let cursor = 0;
    let matched = false;
    for (const match of text.matchAll(BARE_URL)) {
      matched = true;
      const start = match.index ?? 0;
      if (start > cursor) out.push({ ...op, insert: text.slice(cursor, start) });
      const url = match[0];
      const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
      out.push({ insert: url, attributes: { ...op.attributes, link: href } });
      cursor = start + url.length;
    }
    if (!matched) out.push(op);
    else if (cursor < text.length) out.push({ ...op, insert: text.slice(cursor) });
  }
  return out;
}

/** Only ordinary web and mail links are opened. */
export function safeLink(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href);
    if ((url.protocol === "https:" || url.protocol === "http:") && url.host) return url.href;
    if (url.protocol === "mailto:" && url.pathname) return url.href;
  } catch {
    // Invalid URL.
  }
  return null;
}

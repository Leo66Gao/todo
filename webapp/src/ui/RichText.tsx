"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type QuillType from "quill";
import {
  Bold,
  Code2,
  Heading1,
  FileText,
  Heading2,
  Pilcrow,
  Plus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Sigma,
  Strikethrough,
  Underline,
} from "lucide-react";
import "katex/dist/katex.min.css";
import { contentFromDelta, deltaFromContent, safeLink, withAutoLinks, type DeltaOp } from "@/lib/delta";
import { DISPLAY, looksLikeMarkdown, markdownToDelta } from "@/lib/markdownPaste";
import { cn } from "./cn";
import { formulaDialog } from "./FormulaDialog";
import { promptDialog } from "./overlay";
import { Tooltip } from "./overlay";

type ToolbarKind = "none" | "compact" | "full";

interface Tool {
  key: string;
  label: string;
  shortcut?: string[];
  icon: React.ReactNode;
  format: string;
  value?: unknown;
}

const INLINE: Tool[] = [
  { key: "bold", label: "Bold", shortcut: ["⌘", "B"], icon: <Bold />, format: "bold" },
  { key: "italic", label: "Italic", shortcut: ["⌘", "I"], icon: <Italic />, format: "italic" },
  { key: "underline", label: "Underline", shortcut: ["⌘", "U"], icon: <Underline />, format: "underline" },
  { key: "strike", label: "Strikethrough", icon: <Strikethrough />, format: "strike" },
];
const HEADINGS: Tool[] = [
  { key: "h1", label: "Heading", icon: <Heading1 />, format: "header", value: 1 },
  { key: "h2", label: "Subheading", icon: <Heading2 />, format: "header", value: 2 },
];
const LISTS: Tool[] = [
  { key: "bullet", label: "Bulleted list", icon: <List />, format: "list", value: "bullet" },
  { key: "ordered", label: "Numbered list", icon: <ListOrdered />, format: "list", value: "ordered" },
  { key: "check", label: "Checklist", icon: <ListChecks />, format: "list", value: "unchecked" },
];
const BLOCKS: Tool[] = [
  { key: "quote", label: "Quote", icon: <Quote />, format: "blockquote", value: true },
  { key: "code", label: "Code block", icon: <Code2 />, format: "code-block", value: true },
];

export interface RichTextProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  toolbar?: ToolbarKind;
  reading?: boolean;
  autoFocus?: boolean;
  className?: string;
  minHeight?: number;
  toolbarClassName?: string;
  onReady?: (quill: QuillType) => void;
  /** Enables "[[" links to other notes. */
  noteLinks?: NoteLinks;
}

export interface NoteLinks {
  search: (query: string) => { id: string; title: string; hint?: string }[];
  /** Makes a note with this title and returns its ID. */
  create: (title: string) => string;
}

/** Links to notes are stored as this app's own relative URLs. */
export const noteHref = (id: string) => `/note?id=${encodeURIComponent(id)}`;

export function RichText({
  value,
  onChange,
  placeholder,
  toolbar = "none",
  reading,
  autoFocus,
  className,
  minHeight,
  toolbarClassName,
  onReady,
  noteLinks,
}: RichTextProps) {
  const host = useRef<HTMLDivElement>(null);
  const quillRef = useRef<QuillType | null>(null);
  const lastEmitted = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  const [formats, setFormats] = useState<Record<string, unknown>>({});
  const [slash, setSlashState] = useState<Slash | null>(null);
  // Read by key handlers, which can run before React renders a new state.
  const slashRef = useRef<Slash | null>(null);
  const setSlash = (next: Slash | null) => {
    slashRef.current = next;
    setSlashState(next);
  };
  const linksRef = useRef(noteLinks);
  useEffect(() => {
    linksRef.current = noteLinks;
  }, [noteLinks]);
  const entries = (menu: Slash | null) => (menu ? menuEntries(menu, linksRef.current) : []);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let disposed = false;
    const el = host.current;
    if (!el) return;
    void Promise.all([import("quill"), import("katex")]).then(([{ default: Quill }, katex]) => {
      if (disposed || !host.current) return;
      // Quill's formula format renders with KaTeX.
      (window as unknown as { katex: unknown }).katex = katex.default;
      const Delta = Quill.import("delta") as unknown as new (ops?: DeltaOp[]) => QuillDelta;
      el.innerHTML = "";
      const editorEl = document.createElement("div");
      el.appendChild(editorEl);
      const quill = new Quill(editorEl, {
        placeholder,
        modules: { toolbar: false, clipboard: { matchVisual: false } },
        formats: [
          "bold",
          "italic",
          "underline",
          "strike",
          "link",
          "code",
          "header",
          "list",
          "blockquote",
          "code-block",
          "indent",
          "formula",
        ],
      });
      installMathAndMarkdown(quill, Delta, (tex, index) => void editFormula(quill, tex, index));
      quill.setContents(deltaFromContent(value) as never, "silent");
      quill.history.clear();
      quillRef.current = quill;
      quill.on("text-change", (delta, _o, source) => {
        if (source !== "user") return;
        const ops = quill.getContents().ops as DeltaOp[];
        const content = contentFromDelta(withAutoLinks(ops));
        lastEmitted.current = content;
        onChangeRef.current(content);
        setFormats(quill.getFormat() as Record<string, unknown>);
        const next = slashAt(quill, cursorAfter(delta.ops as DeltaOp[]), !!linksRef.current);
        const open = slashRef.current;
        setSlash(next && open?.index === next.index && open.query === next.query ? open : next);
      });
      quill.on("selection-change", (range) => {
        if (range) setFormats(quill.getFormat(range) as Record<string, unknown>);
        // Moving away from the "/" closes the menu.
        if (slashRef.current && (!range || slashAt(quill, range.index, !!linksRef.current)?.index !== slashRef.current.index)) setSlash(null);
      });
      // Cmd/Ctrl-click opens links; plain clicks keep editing.
      quill.root.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement).closest("a");
        const href = a?.getAttribute("href") ?? "";
        if (href.startsWith("/note?id=")) {
          e.preventDefault();
          window.history.pushState(null, "", href);
          return;
        }
        if (a && (e.metaKey || e.ctrlKey)) {
          const href = safeLink(a.getAttribute("href"));
          if (href) window.open(href, "_blank", "noopener");
        }
      });
      if (autoFocus) quill.focus();
      setReady(true);
      onReady?.(quill);
    });
    return () => {
      disposed = true;
      quillRef.current = null;
    };
    // The editor is created once; later value changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accept remote changes while the user is not editing this field.
  useEffect(() => {
    const quill = quillRef.current;
    if (!quill || value === lastEmitted.current) return;
    if (quill.hasFocus()) return;
    lastEmitted.current = value;
    quill.setContents(deltaFromContent(value) as never, "silent");
  }, [value, ready]);

  const apply = (tool: Tool) => {
    const quill = quillRef.current;
    if (!quill) return;
    quill.focus();
    const current = quill.getFormat();
    if (tool.format === "list") {
      const on =
        tool.value === "unchecked"
          ? current.list === "unchecked" || current.list === "checked"
          : current.list === tool.value;
      quill.format("list", on ? false : tool.value, "user");
    } else if (tool.value !== undefined) {
      quill.format(tool.format, current[tool.format] === tool.value ? false : tool.value, "user");
    } else {
      quill.format(tool.format, !current[tool.format], "user");
    }
    setFormats(quill.getFormat() as Record<string, unknown>);
  };

  const link = async () => {
    const quill = quillRef.current;
    if (!quill) return;
    const range = quill.getSelection(true);
    const existing = quill.getFormat(range).link as string | undefined;
    const url = await promptDialog({
      title: existing ? "Edit link" : "Add link",
      placeholder: "https://",
      initial: existing ?? "",
      confirmLabel: existing ? "Update" : "Add link",
    });
    if (url == null) return;
    const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
    quill.focus();
    if (range.length === 0 && !existing) {
      quill.insertText(range.index, url, { link: href }, "user");
    } else {
      quill.formatText(range.index, Math.max(range.length, 0), "link", safeLink(href) ? href : false, "user");
    }
  };

  const runSlash = (entry: Entry) => {
    const quill = quillRef.current;
    const menu = slashRef.current;
    if (!quill || !menu) return;
    setSlash(null);
    quill.deleteText(menu.index, (menu.kind === "link" ? 2 : 1) + menu.query.length, "user");
    quill.setSelection(menu.index, 0, "silent");
    if (entry.note || entry.create != null) {
      const title = entry.note?.title ?? entry.create!;
      const id = entry.note?.id ?? linksRef.current?.create(title);
      if (!id) return;
      quill.insertText(menu.index, title, { link: noteHref(id) }, "user");
      quill.insertText(menu.index + title.length, " ", { link: false }, "user");
      quill.setSelection(menu.index + title.length + 1, 0, "silent");
      return;
    }
    const item = entry.block!;
    if (item.key === "formula") {
      void editFormula(quill, "", null);
      return;
    }
    const line = item.format ? { [item.format]: item.value } : {};
    // Clear the line's other block formats, then apply this one.
    for (const format of ["header", "list", "blockquote", "code-block"]) {
      if (format !== item.format) quill.formatLine(menu.index, 1, format, false, "user");
    }
    for (const [format, value] of Object.entries(line)) quill.formatLine(menu.index, 1, format, value, "user");
    setFormats(quill.getFormat() as Record<string, unknown>);
  };

  const shownEntries = slash ? menuEntries(slash, noteLinks) : [];

  const isActive = (tool: Tool) => {
    const v = formats[tool.format];
    if (tool.format === "list" && tool.value === "unchecked") return v === "unchecked" || v === "checked";
    return tool.value !== undefined ? v === tool.value : !!v;
  };

  const groups =
    toolbar === "full" ? [INLINE, HEADINGS, LISTS, BLOCKS] : toolbar === "compact" ? [INLINE, LISTS] : [];

  const bar = groups.length > 0 && (
    <div className="flex flex-wrap items-center gap-0.5 max-sm:scrollbar-none max-sm:flex-nowrap max-sm:overflow-x-auto">
      {groups.map((group, gi) => (
        <div key={gi} className={cn("flex shrink-0 items-center gap-0.5", gi > 0 && "ml-1 border-l border-line pl-1.5")}>
          {group.map((tool) => (
            <Tooltip key={tool.key} label={tool.label} shortcut={tool.shortcut}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(tool)}
                aria-label={tool.label}
                aria-pressed={isActive(tool)}
                className={cn(
                  "flex size-7 items-center justify-center rounded-[6px] transition-colors [&>svg]:size-[15px]",
                  isActive(tool) ? "bg-fill-strong text-ink" : "text-ink-3 hover:bg-fill hover:text-ink",
                )}
              >
                {tool.icon}
              </button>
            </Tooltip>
          ))}
          {group === BLOCKS && (
            <Tooltip label="Formula" shortcut={["⌘", "⇧", "E"]}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => quillRef.current && void editFormula(quillRef.current, "", null)}
                aria-label="Formula"
                className="flex size-7 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-fill hover:text-ink [&>svg]:size-[15px]"
              >
                <Sigma />
              </button>
            </Tooltip>
          )}
          {gi === 0 && (
            <Tooltip label="Link" shortcut={["⌘", "K"]}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={link}
                aria-label="Link"
                className={cn(
                  "flex size-7 items-center justify-center rounded-[6px] transition-colors [&>svg]:size-[15px]",
                  formats.link ? "bg-fill-strong text-ink" : "text-ink-3 hover:bg-fill hover:text-ink",
                )}
              >
                <Link2 />
              </button>
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {toolbar === "full" && bar && <div className={cn("mb-3", toolbarClassName)}>{bar}</div>}
      <div className="relative">
        <div
          ref={host}
          className={cn("rt", reading && "rt-reading")}
          style={{ ["--rt-min" as string]: minHeight ? `${minHeight}px` : undefined }}
          onKeyDownCapture={(e) => {
            const menu = slashRef.current;
            if (menu) {
              const items = entries(menu);
              const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
              if (move && items.length) {
                e.preventDefault();
                e.stopPropagation();
                setSlash({ ...menu, active: (menu.active + move + items.length) % items.length });
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && items.length) {
                e.preventDefault();
                e.stopPropagation();
                runSlash(items[Math.min(menu.active, items.length - 1)]);
                return;
              }
              if (e.key === "Escape" && items.length) {
                e.preventDefault();
                e.stopPropagation();
                setSlash(null);
                return;
              }
            }
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e" && quillRef.current) {
              e.preventDefault();
              e.stopPropagation();
              void editFormula(quillRef.current, "", null);
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
              e.preventDefault();
              e.stopPropagation();
              void link();
            }
          }}
        />
        <AnimatePresence>
          {slash && shownEntries.length > 0 && (
            <SlashMenu
              slash={slash}
              items={shownEntries}
              onPick={runSlash}
              onHover={(active) => setSlash({ ...slash, active })}
            />
          )}
        </AnimatePresence>
      </div>
      {toolbar === "compact" && bar && <div className="mt-2">{bar}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maths and Markdown

interface QuillDelta {
  ops: DeltaOp[];
  retain(n: number): QuillDelta;
  delete(n: number): QuillDelta;
  insert(value: unknown, attrs?: Record<string, unknown>): QuillDelta;
  concat(other: QuillDelta): QuillDelta;
  length(): number;
}
type DeltaCtor = new (ops?: DeltaOp[]) => QuillDelta;

/** Inserts a formula at the cursor (index null), or edits the one at index. */
async function editFormula(quill: QuillType, tex: string, index: number | null) {
  const range = index == null ? quill.getSelection(true) : { index, length: 1 };
  // A selection becomes the formula's starting text.
  const initial = index == null && range.length ? quill.getText(range.index, range.length).trim() : tex;
  const result = await formulaDialog(initial, index != null);
  quill.focus();
  if (!result) {
    quill.setSelection(range.index + (index == null ? range.length : 1), 0, "silent");
    return;
  }
  quill.deleteText(range.index, range.length, "user");
  if ("remove" in result) {
    quill.setSelection(range.index, 0, "silent");
    return;
  }
  let at = range.index;
  const display = result.tex.startsWith(DISPLAY);
  // A formula on its own line gets a line to itself.
  if (display && index == null) {
    const [, offset] = quill.getLine(at) as unknown as [unknown, number];
    if (offset > 0) quill.insertText(at++, "\n", "user");
  }
  quill.insertEmbed(at, "formula", result.tex, "user");
  at++;
  if (index == null) {
    const next = quill.getText(at, 1);
    if (display && next !== "\n") quill.insertText(at, "\n", "user");
    else if (!display && next !== " ") quill.insertText(at, " ", "user");
    at += 1;
  }
  quill.setSelection(at, 0, "silent");
}

/** TeX of a rendered formula copied from a web page (KaTeX or MathML). */
function texFrom(el: HTMLElement): string | null {
  const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
  return annotation?.textContent?.trim() || el.getAttribute("data-value") || null;
}

/**
 * Pasting: rendered maths keeps its TeX; plain Markdown (what chat apps copy)
 * becomes rich text. Typing: `$…$`, `**…**`, `*…*`, `` `…` `` and `~~…~~`
 * format as they close; `#`, `##`, `>` and three backticks start a block.
 */
function installMathAndMarkdown(quill: QuillType, Delta: DeltaCtor, onFormula: (tex: string, index: number | null) => void) {
  quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
    const el = node as HTMLElement;
    const isMath = el.classList?.contains("katex") || el.localName === "math" || el.classList?.contains("ql-formula");
    if (!isMath) return delta;
    const tex = texFrom(el);
    if (!tex) return delta;
    const display = el.closest(".katex-display") != null || el.getAttribute("display") === "block";
    return new Delta().insert({ formula: display && !tex.startsWith(DISPLAY) ? DISPLAY + tex : tex }) as never;
  });

  quill.root.addEventListener(
    "paste",
    (e) => {
      const text = e.clipboardData?.getData("text/plain");
      const html = e.clipboardData?.getData("text/html") ?? "";
      if (!text || !looksLikeMarkdown(text)) return;
      // Rich HTML (from a web page or a doc) pastes as it is; Markdown or code-editor HTML is converted.
      if (html && /<(h[1-6]|ul|ol|li|strong|b|em|i|table|annotation|math)\b/i.test(html)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const range = quill.getSelection(true);
      const ops = markdownToDelta(text);
      const last = ops[ops.length - 1];
      if (last?.insert === "\n" && !last.attributes) ops.pop();
      const change = new Delta().retain(range.index).delete(range.length).concat(new Delta(ops));
      quill.updateContents(change as never, "user");
      quill.setSelection(range.index + new Delta(ops).length(), 0, "silent");
    },
    true,
  );

  // Line starts: "# " heading, "## " subheading, "> " quote, "``` " code block.
  const blocks: Record<string, [string, unknown]> = { "#": ["header", 1], "##": ["header", 2], ">": ["blockquote", true], "```": ["code-block", true] };
  quill.keyboard.addBinding(
    { key: " ", collapsed: true, format: { "code-block": false }, prefix: /^(#{1,2}|>|```)$/ },
    (range: { index: number }, context: { prefix: string }) => {
      const block = blocks[context.prefix];
      if (!block) return true;
      quill.deleteText(range.index - context.prefix.length, context.prefix.length, "user");
      quill.formatLine(range.index - context.prefix.length, 1, block[0], block[1], "user");
      return false;
    },
  );

  // Closing marks: turn the finished span into its format.
  const spans: [RegExp, (m: RegExpMatchArray) => { insert: unknown; attrs?: Record<string, unknown> }][] = [
    [/(?<![\\$\w])\$([^$\s](?:[^$]*[^$\s\\])?)\$$/, (m) => ({ insert: { formula: m[1] } })],
    [/\*\*([^*]+)\*\*$/, (m) => ({ insert: m[1], attrs: { bold: true } })],
    [/(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, (m) => ({ insert: m[1], attrs: { italic: true } })],
    [/`([^`]+)`$/, (m) => ({ insert: m[1], attrs: { code: true } })],
    [/~~([^~]+)~~$/, (m) => ({ insert: m[1], attrs: { strike: true } })],
  ];
  quill.on("text-change", (delta, _old, source) => {
    if (source !== "user") return;
    const ops = (delta as unknown as QuillDelta).ops;
    const typed = ops.find((op) => typeof op.insert === "string")?.insert as string | undefined;
    if (!typed || typed.length !== 1 || !"$*`~".includes(typed)) return;
    const at = cursorAfter(ops);
    if (at == null) return;
    const range = { index: at };
    if (quill.getFormat(range.index - 1, 1)["code-block"] || quill.getFormat(range.index - 1, 1).code) return;
    const [line, offset] = quill.getLine(range.index) as unknown as [{ domNode: HTMLElement } | null, number];
    if (!line) return;
    const before = quill.getText(range.index - offset, offset);
    for (const [pattern, make] of spans) {
      const m = before.match(pattern);
      if (!m) continue;
      const span = m[0];
      const start = range.index - span.length;
      const { insert, attrs } = make(m);
      // After this change, not during it.
      queueMicrotask(() => {
        quill.deleteText(start, span.length, "user");
        if (typeof insert === "string") {
          quill.insertText(start, insert, attrs ?? {}, "user");
          quill.setSelection(start + insert.length, 0, "silent");
          for (const key of Object.keys(attrs ?? {})) quill.format(key, false, "silent");
        } else {
          quill.insertEmbed(start, "formula", (insert as { formula: string }).formula, "user");
          quill.setSelection(start + 1, 0, "silent");
        }
      });
      return;
    }
  });

  // Clicking a formula edits it.
  quill.root.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest(".ql-formula") as HTMLElement | null;
    if (!el) return;
    const Q = quill.constructor as unknown as { find(node: Node): unknown };
    const blot = Q.find(el);
    if (!blot) return;
    onFormula(el.getAttribute("data-value") ?? "", quill.getIndex(blot as never));
  });
}

// ---------------------------------------------------------------------------
// Slash menu: "/" at the start of a line or after a space picks a block.

interface Slash {
  /** "/" for blocks, "[[" for a link to a note. */
  kind: "slash" | "link";
  /** Where the "/" or "[[" is. */
  index: number;
  query: string;
  active: number;
  left: number;
  top: number;
}

interface SlashItem {
  key: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  format?: string;
  value?: unknown;
  words: string;
}

const SLASH_ITEMS: SlashItem[] = [
  { key: "text", label: "Text", icon: <Pilcrow />, words: "text paragraph plain body" },
  { key: "h1", label: "Heading", hint: "#", icon: <Heading1 />, format: "header", value: 1, words: "heading title h1" },
  { key: "h2", label: "Subheading", hint: "##", icon: <Heading2 />, format: "header", value: 2, words: "subheading h2 section" },
  { key: "bullet", label: "Bulleted list", hint: "-", icon: <List />, format: "list", value: "bullet", words: "bulleted list bullets unordered" },
  { key: "ordered", label: "Numbered list", hint: "1.", icon: <ListOrdered />, format: "list", value: "ordered", words: "numbered list ordered" },
  { key: "check", label: "Checklist", hint: "[]", icon: <ListChecks />, format: "list", value: "unchecked", words: "checklist todo checkbox tasks" },
  { key: "quote", label: "Quote", hint: ">", icon: <Quote />, format: "blockquote", value: true, words: "quote blockquote" },
  { key: "code", label: "Code block", hint: "```", icon: <Code2 />, format: "code-block", value: true, words: "code block snippet" },
  { key: "formula", label: "Formula", hint: "$…$", icon: <Sigma />, words: "formula maths math equation latex" },
];

interface Entry {
  key: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  block?: SlashItem;
  note?: { id: string; title: string };
  create?: string;
}

function menuEntries(menu: Slash, links?: NoteLinks): Entry[] {
  if (menu.kind === "slash") {
    const q = menu.query.toLowerCase();
    return SLASH_ITEMS.filter((i) => !q || i.words.split(" ").some((w) => w.startsWith(q))).map((block) => ({
      key: block.key,
      label: block.label,
      hint: block.hint,
      icon: block.icon,
      block,
    }));
  }
  if (!links) return [];
  const query = menu.query.trim();
  const found: Entry[] = links.search(query).slice(0, 6).map((n) => ({
    key: n.id,
    label: n.title,
    hint: n.hint,
    icon: <FileText />,
    note: n,
  }));
  const exact = found.some((e) => e.label.toLowerCase() === query.toLowerCase());
  if (query && !exact) found.push({ key: "create", label: `New note “${query}”`, icon: <Plus />, create: query });
  return found;
}

/**
 * Where typing left the cursor. Quill's selection can lag a change by a tick
 * (the first letter on an empty line), so it is read from the change itself.
 */
function cursorAfter(ops: DeltaOp[]): number | undefined {
  let index = 0;
  for (const op of ops) {
    if (typeof op.retain === "number") index += op.retain;
    else if (typeof op.insert === "string") return index + op.insert.length;
    else if (op.insert) return index + 1;
    else if (typeof op.delete === "number") return index;
  }
  return undefined;
}

/** The open "/" or "[[" menu at the cursor, if any. */
function slashAt(quill: QuillType, at?: number, links = false): Slash | null {
  const selection = quill.getSelection();
  const range = at != null ? { index: at, length: 0 } : selection;
  if (!range || range.length) return null;
  const format = quill.getFormat(range.index, 0);
  if (format["code-block"] || format.code) return null;
  const [, offset] = quill.getLine(range.index) as unknown as [unknown, number];
  const before = quill.getText(range.index - offset, offset);
  const link = links ? before.match(/\[\[([^[\]\n]{0,60})$/) : null;
  const m = link ?? before.match(/(?:^|\s)\/([a-zA-Z]{0,12})$/);
  if (!m) return null;
  const index = range.index - m[1].length - (link ? 2 : 1);
  const bounds = quill.getBounds(index);
  if (!bounds) return null;
  return { kind: link ? "link" : "slash", index, query: m[1], active: 0, left: bounds.left, top: bounds.top + bounds.height };
}

function SlashMenu({
  slash,
  items,
  onPick,
  onHover,
}: {
  slash: Slash;
  items: Entry[];
  onPick: (item: Entry) => void;
  onHover: (active: number) => void;
}) {
  const active = Math.min(slash.active, items.length - 1);
  return (
    <motion.div
      role="listbox"
      aria-label={slash.kind === "link" ? "Notes" : "Blocks"}
      initial={{ opacity: 0, y: -4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
      transition={{ duration: 0.16, ease: [0.2, 0.9, 0.25, 1] }}
      style={{ left: Math.max(0, slash.left - 8), top: slash.top + 6, transformOrigin: "top left" }}
      className="glass-overlay absolute z-30 w-64 rounded-pop bg-raised p-1 shadow-pop"
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={item.key}
          type="button"
          role="option"
          aria-selected={i === active}
          onMouseMove={() => i !== active && onHover(i)}
          onClick={() => onPick(item)}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 rounded-[7px] px-2 text-left text-[13px] text-ink [&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-ink-3",
            i === active && "bg-fill",
          )}
        >
          {item.icon}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint && (
            <span className={cn("shrink-0 text-[11px] text-ink-4", slash.kind === "slash" && "font-mono")}>{item.hint}</span>
          )}
        </button>
      ))}
    </motion.div>
  );
}

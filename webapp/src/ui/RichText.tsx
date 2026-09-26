"use client";

import { useEffect, useRef, useState } from "react";
import type QuillType from "quill";
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { contentFromDelta, deltaFromContent, safeLink, withAutoLinks, type DeltaOp } from "@/lib/delta";
import { cn } from "./cn";
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
}

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
}: RichTextProps) {
  const host = useRef<HTMLDivElement>(null);
  const quillRef = useRef<QuillType | null>(null);
  const lastEmitted = useRef<string>(value);
  const onChangeRef = useRef(onChange);
  const [formats, setFormats] = useState<Record<string, unknown>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let disposed = false;
    const el = host.current;
    if (!el) return;
    void import("quill").then(({ default: Quill }) => {
      if (disposed || !host.current) return;
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
        ],
      });
      quill.setContents(deltaFromContent(value) as never, "silent");
      quill.history.clear();
      quillRef.current = quill;
      quill.on("text-change", (_d, _o, source) => {
        if (source !== "user") return;
        const ops = quill.getContents().ops as DeltaOp[];
        const content = contentFromDelta(withAutoLinks(ops));
        lastEmitted.current = content;
        onChangeRef.current(content);
        setFormats(quill.getFormat() as Record<string, unknown>);
      });
      quill.on("selection-change", (range) => {
        if (range) setFormats(quill.getFormat(range) as Record<string, unknown>);
      });
      // Cmd/Ctrl-click opens links; plain clicks keep editing.
      quill.root.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement).closest("a");
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
      <div
        ref={host}
        className={cn("rt", reading && "rt-reading")}
        style={{ ["--rt-min" as string]: minHeight ? `${minHeight}px` : undefined }}
        onKeyDownCapture={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            e.stopPropagation();
            void link();
          }
        }}
      />
      {toolbar === "compact" && bar && <div className="mt-2">{bar}</div>}
    </div>
  );
}

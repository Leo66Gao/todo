"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, MoreHorizontal, Plus, Search } from "lucide-react";
import { lookup, type Found } from "@/lib/sourceLookup";
import {
  bibliographyHeading,
  inText,
  plainReference,
  reference,
  type CitationStyle,
  type Run,
  type Source,
  type SourceKind,
} from "@/lib/sources";
import { cn } from "@/ui/cn";
import { Button, IconButton, Segmented, Spinner } from "@/ui/controls";
import { fade } from "@/ui/motion";
import { confirmDialog, Menu, Modal } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { closeSources, deleteSource, saveSource, setCitationStyle, useLibrary, useSourcesSheet } from "./library";

type Draft = Found & Partial<Pick<Source, "id" | "createdAt">>;

const KINDS: { value: SourceKind; label: string }[] = [
  { value: "web", label: "Website" },
  { value: "book", label: "Book" },
  { value: "article", label: "Article" },
  { value: "video", label: "Video" },
  { value: "other", label: "Other" },
];

export function Reference({ runs, className }: { runs: Run[]; className?: string }) {
  return (
    <span className={className}>
      {runs.map((r, i) => (r.italic ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>))}
    </span>
  );
}

async function copyReference(source: Source, style: CitationStyle) {
  const runs = reference(source, style);
  const html = runs.map((r) => (r.italic ? `<i>${escape(r.text)}</i>` : escape(r.text))).join("");
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainReference(source, style)], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(plainReference(source, style));
  }
  toast("Reference copied");
}
const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function SourcesHost() {
  const { open, target } = useSourcesSheet();
  const { sources, style } = useLibrary();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sources.filter((s) => plainReference(s, style).toLowerCase().includes(q)) : sources;
  }, [sources, style, query]);

  const add = async () => {
    if (!input.trim()) {
      setDraft({ kind: "web", title: "", authors: [] });
      return;
    }
    setBusy(true);
    try {
      const { found, complete } = await lookup(input);
      setDraft(found);
      setInput("");
      if (!complete) toast("Some details couldn’t be found. Fill in the rest.");
    } catch (error) {
      toast(error instanceof Error && error.message.startsWith("Paste") ? error.message : "Nothing was found for that. Add the details yourself.");
      if (!(error instanceof Error && error.message.startsWith("Paste"))) setDraft({ kind: "web", title: "", authors: [] });
    } finally {
      setBusy(false);
    }
  };

  const cite = (source: Source) => {
    if (!target) {
      setDraft(source);
      return;
    }
    const at = page.trim() || undefined;
    setPage("");
    closeSources();
    // Once the dialog lets go of focus, so the cursor lands back in the note.
    setTimeout(() => target.cite(source, style, at), 0);
  };

  const cited = target?.cited() ?? [];
  const reset = () => {
    setDraft(null);
    setQuery("");
    setInput("");
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          closeSources();
          reset();
        }
      }}
      width={620}
      label="Sources"
      initialFocus={(e) => e.preventDefault()}
      // Citing puts the cursor back in the note.
      returnFocus={!target}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {draft ? (
          <motion.div key="form" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={fade} className="flex min-h-0 flex-1 flex-col">
            <SourceForm
              draft={draft}
              style={style}
              onCancel={() => setDraft(null)}
              onSave={(saved) => {
                setDraft(null);
                if (target && !draft.id) {
                  // Added while citing: cite it straight away.
                  cite(saved);
                }
              }}
            />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={fade} className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-3 px-5 pt-4 pb-3">
              <h2 className="flex-1 text-base font-semibold">{target ? "Cite a source" : "Sources"}</h2>
              <Segmented<CitationStyle>
                size="sm"
                value={style}
                onChange={setCitationStyle}
                options={[
                  { value: "mla", label: "MLA" },
                  { value: "apa", label: "APA" },
                ]}
              />
            </div>
            <form
              className="flex gap-2 px-5 pb-3"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Paste a link, DOI or ISBN"
                // Ready to paste into on a computer; on a phone, no surprise keyboard.
                autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-9 min-w-0 flex-1 rounded-ctl border border-line-strong bg-card px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft"
              />
              <Button type="submit" variant="primary" disabled={busy} icon={busy ? <Spinner className="size-3.5" /> : <Plus className="size-4" />}>
                {input.trim() ? "Look up" : "Add"}
              </Button>
            </form>
            {sources.length > 6 && (
              <label className="mx-5 mb-2 flex h-8 items-center gap-2 rounded-ctl bg-fill px-2.5 text-sm">
                <Search className="size-3.5 text-ink-3" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sources" className="flex-1 bg-transparent outline-none placeholder:text-ink-3" />
              </label>
            )}
            <div className="scroll-area min-h-[120px] flex-1 border-t border-line">
              {sources.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-ink-3">
                  Keep the books, articles and pages you use here, and cite them in MLA or APA.
                </p>
              ) : (
                <ul className="p-1.5">
                  {shown.map((source) => (
                    <li key={source.id} className="group flex items-start gap-1 rounded-ctl transition-colors hover:bg-fill">
                      <button type="button" onClick={() => cite(source)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                        <Reference runs={reference(source, style)} className="block text-[13px] leading-5 text-ink" />
                        <span className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                          {inText(source, style)}
                          {cited.includes(source.id) && <span className="text-ink-2">Cited in this note</span>}
                        </span>
                      </button>
                      <Menu
                        align="end"
                        trigger={
                          <IconButton label="Source actions" size="sm" className="mt-2 mr-1.5 opacity-60 group-hover:opacity-100">
                            <MoreHorizontal className="size-4" />
                          </IconButton>
                        }
                        items={[
                          ...(target ? [{ label: "Cite", onSelect: () => cite(source) }] : []),
                          { label: "Copy reference", onSelect: () => void copyReference(source, style) },
                          {
                            label: "Copy in-text citation",
                            onSelect: () => void navigator.clipboard.writeText(inText(source, style)).then(() => toast("Citation copied")),
                          },
                          { label: "Edit…", onSelect: () => setDraft(source) },
                          { separator: true },
                          {
                            label: "Delete…",
                            destructive: true,
                            onSelect: async () => {
                              const ok = await confirmDialog({
                                title: "Delete this source?",
                                message: "Citations already in your notes stay as they are.",
                                confirmLabel: "Delete source",
                                destructive: true,
                              });
                              if (ok) deleteSource(source.id);
                            },
                          },
                        ]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {target && (
              <div className="flex items-center gap-2 border-t border-line px-5 py-3">
                <input
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  placeholder="Page"
                  inputMode="numeric"
                  aria-label="Page for the citation"
                  className="h-8 w-20 rounded-ctl border border-line-strong bg-card px-2.5 text-sm outline-none focus:border-accent"
                />
                <span className="flex-1 text-xs text-ink-3">Choose a source to cite it where your cursor was.</span>
                <Button
                  size="sm"
                  disabled={cited.length === 0}
                  onClick={() => {
                    closeSources();
                    setTimeout(() => target.bibliography(style), 0);
                  }}
                >
                  Add {bibliographyHeading(style)}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

function SourceForm({ draft, style, onCancel, onSave }: { draft: Draft; style: CitationStyle; onCancel: () => void; onSave: (saved: Source) => void }) {
  const [value, setValue] = useState<Draft>(draft);
  const [authors, setAuthors] = useState(draft.authors.join("\n"));
  const set = (patch: Partial<Draft>) => setValue((v) => ({ ...v, ...patch }));
  const current: Source = {
    ...value,
    authors: authors
      .split("\n")
      .map((a) => a.trim())
      .filter(Boolean),
    id: value.id ?? "draft",
    createdAt: value.createdAt ?? 0,
  };
  const kind = value.kind;
  const containerLabel = kind === "article" ? "Journal" : kind === "video" ? "Platform" : kind === "book" ? null : "Website";

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!current.title.trim()) return;
        const { id, createdAt, ...rest } = current;
        const saved = saveSource({ ...rest, ...(value.id ? { id, createdAt } : {}) });
        toast(value.id ? "Source saved" : "Source added");
        onSave(saved);
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <Button variant="ghost" size="sm" className="-ml-2" icon={<ChevronLeft className="size-4" />} onClick={onCancel}>
          Sources
        </Button>
        <span className="flex-1" />
        <Button type="submit" size="sm" variant="primary" disabled={!current.title.trim()}>
          {value.id ? "Save" : "Add source"}
        </Button>
      </div>
      <div className="scroll-area min-h-0 flex-1 px-5 py-4">
        <div className="rounded-pop bg-fill px-4 py-3 text-[13px] leading-5">
          {current.title.trim() ? <Reference runs={reference(current, style)} /> : <span className="text-ink-3">The reference shows here as you fill it in.</span>}
        </div>
        <Segmented<SourceKind> className="mt-4 w-full" size="sm" value={kind} onChange={(k) => set({ kind: k })} options={KINDS} />
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
          <Field label="Title" className="col-span-2">
            <input autoFocus={!value.title} value={value.title} onChange={(e) => set({ title: e.target.value })} className={inputClass} />
          </Field>
          <Field label={kind === "video" ? "Creators" : "Authors"} hint="One per line, as Surname, First name" className="col-span-2">
            <textarea rows={Math.min(4, Math.max(2, authors.split("\n").length))} value={authors} onChange={(e) => setAuthors(e.target.value)} className={cn(inputClass, "h-auto py-2 leading-5")} />
          </Field>
          <Field label="Published" hint="2024, 2024-05 or 2024-05-03">
            <input value={value.date ?? ""} onChange={(e) => set({ date: e.target.value || undefined })} inputMode="numeric" className={inputClass} />
          </Field>
          {containerLabel ? (
            <Field label={containerLabel}>
              <input value={value.container ?? ""} onChange={(e) => set({ container: e.target.value || undefined })} className={inputClass} />
            </Field>
          ) : (
            <Field label="Publisher">
              <input value={value.publisher ?? ""} onChange={(e) => set({ publisher: e.target.value || undefined })} className={inputClass} />
            </Field>
          )}
          {kind === "video" && (
            <Field label="Uploaded by">
              <input value={value.publisher ?? ""} onChange={(e) => set({ publisher: e.target.value || undefined })} className={inputClass} />
            </Field>
          )}
          {kind === "book" && (
            <Field label="Edition">
              <input value={value.edition ?? ""} onChange={(e) => set({ edition: e.target.value || undefined })} placeholder="e.g. 2nd" className={inputClass} />
            </Field>
          )}
          {kind === "article" && (
            <>
              <Field label="Volume">
                <input value={value.volume ?? ""} onChange={(e) => set({ volume: e.target.value || undefined })} className={inputClass} />
              </Field>
              <Field label="Issue">
                <input value={value.issue ?? ""} onChange={(e) => set({ issue: e.target.value || undefined })} className={inputClass} />
              </Field>
              <Field label="Pages">
                <input value={value.pages ?? ""} onChange={(e) => set({ pages: e.target.value || undefined })} placeholder="e.g. 12–19" className={inputClass} />
              </Field>
              <Field label="DOI">
                <input value={value.doi ?? ""} onChange={(e) => set({ doi: e.target.value || undefined })} autoCapitalize="off" className={inputClass} />
              </Field>
            </>
          )}
          {kind !== "book" && (
            <Field label="Link" className="col-span-2">
              <input value={value.url ?? ""} onChange={(e) => set({ url: e.target.value || undefined })} inputMode="url" autoCapitalize="off" className={inputClass} />
            </Field>
          )}
          {kind === "web" && (
            <Field label="Accessed" hint="When you read it">
              <input type="date" value={value.accessed ?? ""} onChange={(e) => set({ accessed: e.target.value || undefined })} className={inputClass} />
            </Field>
          )}
        </div>
      </div>
    </form>
  );
}

const inputClass =
  "h-9 w-full rounded-ctl border border-line-strong bg-card px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft";

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-ink-2">
        {label}
        {hint && <span className="truncate font-normal text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookMarked, Camera, ChevronDown, FileUp, NotebookPen, Plus, Search } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { plainText } from "@/lib/delta";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { useWorkspace } from "@/store/workspace";
import { useGlass } from "@/glass/registry";
import { Button, IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { Menu, Tooltip } from "@/ui/overlay";
import { openSources } from "@/features/sources/library";
import { createNote, importNote, noteGroup, pinnedFirst } from "./noteActions";
import { NoteRow } from "./NoteRow";
import { noteFromPhotos } from "@/features/ai/openers";

export function NotesView() {
  const navigate = useNavigate();
  const notes = useWorkspace((s) => s.notes);
  const projects = useWorkspace((s) => s.projects);
  const [query, setQuery] = useState("");
  const searchWell = useGlass<HTMLLabelElement>({ level: 2, kind: "plate", inScroll: true });
  const subjectPlate = useGlass<HTMLButtonElement>({ level: 2, kind: "plate", interactive: true, inScroll: true });
  // The three tools share one box of glass, like the arrows on Today.
  const tools = useGlass<HTMLDivElement>({ level: 2, kind: "ink" });
  const [subjectId, setSubjectId] = useState<string | "all">("all");
  const fileInput = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = notes
      .filter((n) => subjectId === "all" || n.subjectId === subjectId)
      .filter((n) => !q || n.title.toLowerCase().includes(q) || plainText(n.content).toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const out: { title: string; items: typeof filtered }[] = [];
    const pinned = filtered.filter((n) => n.pinnedAt).sort(pinnedFirst);
    if (pinned.length) out.push({ title: "Pinned", items: pinned });
    for (const n of filtered) {
      if (n.pinnedAt) continue;
      const title = noteGroup(n.updatedAt);
      const last = out[out.length - 1];
      if (last?.title === title) last.items.push(n);
      else out.push({ title, items: [n] });
    }
    return out;
  }, [notes, query, subjectId]);

  const subject = projects.find((p) => p.id === subjectId);

  return (
    <>
      <PageHeader
        title="Notes"
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importNote(file, navigate, subject?.id ?? null);
              }}
            />
            {/* (On phones each tool is its own round glass button, like the
                other headers' buttons; grouped, the header's styling missed them.) */}
            <div
              ref={tools}
              className="flex items-center md:rounded-ctl md:px-0.5 max-md:gap-2 max-md:[&_button]:size-11 max-md:[&_button]:rounded-full max-md:[&_button]:lens-chip max-md:[&_button]:text-ink"
            >
              <Tooltip label="Sources">
                <IconButton label="Sources" onClick={() => openSources()}>
                  <BookMarked className="size-4" />
                </IconButton>
              </Tooltip>
              <Tooltip label="Note from a photo">
                <IconButton label="Note from a photo" onClick={() => void noteFromPhotos(navigate, { subjectId: subject?.id ?? null })}>
                  <Camera className="size-4" />
                </IconButton>
              </Tooltip>
              <Tooltip label="Import a Word document">
                <IconButton label="Import a Word document" onClick={() => fileInput.current?.click()}>
                  <FileUp className="size-4" />
                </IconButton>
              </Tooltip>
            </div>
            <Button
              variant="primary"
              className="max-md:hidden"
              icon={<Plus className="size-4" />}
              onClick={() => createNote(navigate, { subjectId: subject?.id ?? null })}
            >
              <span className="max-sm:hidden">New note</span>
            </Button>
          </>
        }
      />
      <div className="scroll-area flex-1 pb-bar">
        <div className="mx-auto w-full max-w-[760px] px-6 max-md:px-5 max-md:pt-4">
          <div className="flex items-center gap-2">
            <label ref={searchWell} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-ctl bg-card px-2.5 text-sm shadow-card transition-colors max-md:h-12 max-md:gap-2.5 max-md:rounded-full max-md:border max-md:border-line max-md:px-4 max-md:text-[15px]">
              <Search className="size-3.5 text-ink-3 max-md:size-[18px]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
              />
            </label>
            {projects.length > 0 && (
              <Menu
                align="end"
                trigger={
                  <button ref={subjectPlate} type="button" className="flex h-8 max-w-[45%] min-w-0 shrink-0 items-center gap-2 rounded-ctl bg-card px-2.5 text-sm whitespace-nowrap shadow-card transition-colors hover:bg-fill data-[state=open]:bg-fill max-md:h-12 max-md:rounded-full max-md:border max-md:border-line max-md:pr-3.5 max-md:pl-4 max-md:font-medium">
                    {subject && <span className="size-2 shrink-0 rounded-full" style={{ background: argbToCss(subject.colorValue) }} />}
                    <span className="truncate">{subject?.title ?? "All subjects"}</span>
                    <ChevronDown className="size-3.5 shrink-0 text-ink-3" />
                  </button>
                }
                items={[
                  { label: "All subjects", checked: subjectId === "all", onSelect: () => setSubjectId("all") },
                  { separator: true },
                  ...projects.map((p) => ({
                    label: p.title,
                    swatch: argbToCss(p.colorValue),
                    checked: p.id === subjectId,
                    onSelect: () => setSubjectId(p.id),
                  })),
                ]}
              />
            )}
          </div>

          {groups.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center max-md:pt-28">
              <NotebookPen className="size-11 text-ink-4 md:hidden" strokeWidth={1.2} />
              <p className="text-sm font-medium max-md:mt-6 max-md:font-display max-md:text-[26px] max-md:font-bold max-md:tracking-[-0.02em]">
                {query ? "No notes match your search" : "No notes yet"}
              </p>
              <p className="mt-1 text-xs text-ink-3 max-md:mt-2.5 max-md:max-w-[260px] max-md:text-[15px] max-md:text-ink-2">
                {query ? "Try another word, or clear the search." : "Notes can belong to a subject and sit in folders."}
              </p>
              {!query && (
                <>
                  <Button className="mt-4 max-md:hidden" icon={<Plus className="size-4" />} onClick={() => createNote(navigate, { subjectId: subject?.id ?? null })}>
                    New note
                  </Button>
                  <button
                    type="button"
                    onClick={() => createNote(navigate, { subjectId: subject?.id ?? null })}
                    className="mt-6 flex h-12 items-center gap-2 rounded-full bg-ink pr-5 pl-4 text-[15px] font-semibold text-on-ink transition-transform pointer-fine:active:scale-[0.97] md:hidden"
                  >
                    <Plus className="size-[18px]" strokeWidth={2.2} />
                    New note
                  </button>
                </>
              )}
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.title} className="mt-6">
                <h2 className="flex items-baseline gap-2 px-1 pb-2.5 text-[11px] font-semibold tracking-[0.11em] text-ink-3 uppercase">
                  {g.title}
                  <span className="text-ink-3/70 tnum">{g.items.length}</span>
                </h2>
                <AnimatePresence initial={false}>
                  {g.items.map((n) => (
                    <motion.div
                      key={n.id}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={springs.layout}
                    >
                      <NoteRow note={n} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}

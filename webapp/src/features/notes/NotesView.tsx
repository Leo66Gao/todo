"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BookMarked, ChevronDown, FileUp, Plus, Search } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { plainText } from "@/lib/delta";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { useWorkspace } from "@/store/workspace";
import { Button, IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { Menu, Tooltip } from "@/ui/overlay";
import { openSources } from "@/features/sources/library";
import { createNote, importNote, noteGroup } from "./noteActions";
import { NoteRow } from "./NoteRow";

export function NotesView() {
  const navigate = useNavigate();
  const notes = useWorkspace((s) => s.notes);
  const projects = useWorkspace((s) => s.projects);
  const [query, setQuery] = useState("");
  const [subjectId, setSubjectId] = useState<string | "all">("all");
  const fileInput = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = notes
      .filter((n) => subjectId === "all" || n.subjectId === subjectId)
      .filter((n) => !q || n.title.toLowerCase().includes(q) || plainText(n.content).toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const out: { title: string; items: typeof filtered }[] = [];
    for (const n of filtered) {
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
        detail={notes.length > 0 ? `${notes.length} ${notes.length === 1 ? "note" : "notes"}` : undefined}
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
            <Tooltip label="Sources">
              <IconButton label="Sources" onClick={() => openSources()}>
                <BookMarked className="size-4" />
              </IconButton>
            </Tooltip>
            <Tooltip label="Import a Word document">
              <IconButton label="Import a Word document" onClick={() => fileInput.current?.click()}>
                <FileUp className="size-4" />
              </IconButton>
            </Tooltip>
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
        <div className="mx-auto w-full max-w-[760px] px-6 max-md:px-4">
          <div className="flex items-center gap-2">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-ctl bg-card px-2.5 text-sm shadow-card transition-colors">
              <Search className="size-3.5 text-ink-3" />
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
                  <button type="button" className="flex h-8 max-w-[45%] min-w-0 shrink-0 items-center gap-2 rounded-ctl bg-card px-2.5 text-sm whitespace-nowrap shadow-card transition-colors hover:bg-fill data-[state=open]:bg-fill">
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
            <div className="flex flex-col items-center py-20 text-center">
              <p className="text-sm font-medium">{query ? "No notes match your search" : "No notes yet"}</p>
              <p className="mt-1 text-xs text-ink-3">Notes can belong to a subject and sit in folders.</p>
              {!query && (
                <Button className="mt-4" icon={<Plus className="size-4" />} onClick={() => createNote(navigate, { subjectId: subject?.id ?? null })}>
                  New note
                </Button>
              )}
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.title} className="mt-6">
                <h2 className="px-3 pb-2 text-xs font-semibold text-ink-2 max-md:px-4 max-md:text-[13.5px]">{g.title}</h2>
                <div className="note-group card">
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
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}

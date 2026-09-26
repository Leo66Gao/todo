"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { plainText } from "@/lib/delta";
import { useNavigate } from "@/shell/nav";
import { PageHeader } from "@/shell/Shell";
import { useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { Menu } from "@/ui/overlay";
import { createNote, noteGroup } from "./noteActions";
import { NoteRow } from "./NoteRow";

export function NotesView() {
  const navigate = useNavigate();
  const notes = useWorkspace((s) => s.notes);
  const projects = useWorkspace((s) => s.projects);
  const [query, setQuery] = useState("");
  const [subjectId, setSubjectId] = useState<string | "all">("all");

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
          <Button
            variant="primary"
            className="max-md:hidden"
            icon={<Plus className="size-4" />}
            onClick={() => createNote(navigate, { subjectId: subject?.id ?? null })}
          >
            <span className="max-sm:hidden">New note</span>
          </Button>
        }
      />
      <div className="scroll-area flex-1 pb-24">
        <div className="mx-auto w-full max-w-[760px] px-6 max-sm:px-3">
          <div className="flex items-center gap-2">
            <label className="flex h-8 flex-1 items-center gap-2 rounded-ctl bg-fill px-2.5 text-sm transition-colors focus-within:bg-fill-strong/70">
              <Search className="size-3.5 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes"
                className="flex-1 bg-transparent outline-none placeholder:text-ink-3"
              />
            </label>
            {projects.length > 0 && (
              <Menu
                align="end"
                trigger={
                  <button type="button" className="flex h-8 items-center gap-2 rounded-ctl bg-fill px-2.5 text-sm transition-colors hover:bg-fill-strong data-[state=open]:bg-fill-strong">
                    {subject && <span className="size-2 rounded-full" style={{ background: argbToCss(subject.colorValue) }} />}
                    {subject?.title ?? "All subjects"}
                    <ChevronDown className="size-3.5 text-ink-3" />
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
                <h2 className="px-3 pb-1 text-xs font-semibold text-ink-2">{g.title}</h2>
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

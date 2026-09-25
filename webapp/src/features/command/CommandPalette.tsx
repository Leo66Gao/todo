"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  BookOpen,
  CalendarDays,
  Columns3,
  CornerDownLeft,
  FileText,
  GraduationCap,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  SquareCheck,
} from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { plainText } from "@/lib/delta";
import { relativeDay } from "@/lib/time";
import { useNavigate, type Route } from "@/shell/nav";
import { ui, useUI } from "@/shell/ui";
import { openTask } from "@/features/tasks/actions";
import { useAllTasks } from "@/features/tasks/meta";
import { createNote } from "@/features/notes/noteActions";
import { createSubject } from "@/features/subjects/subjectActions";
import { setThemeMode, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Kbd } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { Modal } from "@/ui/overlay";

interface Command {
  id: string;
  group: string;
  title: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s—–-]+/).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  // Every query word appears somewhere.
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 30;
  return 0;
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  return (
    <Modal open={open} onOpenChange={(o) => ui.set({ paletteOpen: o })} width={620} label="Search" className="max-h-[min(72vh,560px)]">
      {open && <Palette />}
    </Modal>
  );
}

function Palette() {
  const navigate = useNavigate();
  const all = useAllTasks();
  const projects = useWorkspace((s) => s.projects);
  const notes = useWorkspace((s) => s.notes);
  const themeMode = useWorkspace((s) => s.settings.themeMode);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const close = () => ui.set({ paletteOpen: false });
  const go = (route: Route) => {
    close();
    navigate(route);
  };

  const commands = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Command[] = [];
    if (q) {
      out.push({
        id: "create",
        group: "",
        title: `New task “${query.trim()}”`,
        hint: "Opens the task form",
        icon: <Plus />,
        run: () => {
          close();
          ui.newTask({ title: query.trim() });
        },
      });
    }
    const tasks = all
      .map((t) => ({ t, s: Math.max(score(t.title, q), q.length > 2 && plainText(t.notes).toLowerCase().includes(q) ? 20 : 0) }))
      .filter((x) => x.s > 0 && (q || !x.t.isDone))
      .sort((a, b) => b.s - a.s || Number(a.t.isDone) - Number(b.t.isDone) || a.t.date.getTime() - b.t.date.getTime())
      .slice(0, q ? 7 : 0);
    for (const { t } of tasks) {
      out.push({
        id: `task:${t.id}`,
        group: "Tasks",
        title: t.title,
        hint: t.isDone ? "Completed" : relativeDay(t.date),
        icon: t.type === "assignment" ? <GraduationCap /> : <SquareCheck />,
        run: () => {
          close();
          if (t.type !== "assignment" && !t.parentTaskId) {
            navigate({ view: "today" });
            ui.set({ day: t.date });
          }
          openTask(t, navigate);
        },
      });
    }
    for (const p of projects.filter((p) => q && score(p.title, q) > 0).slice(0, 4)) {
      out.push({
        id: `subject:${p.id}`,
        group: "Subjects",
        title: p.title,
        icon: <span className="size-2.5 rounded-full" style={{ background: argbToCss(p.colorValue) }} />,
        run: () => go({ view: "subject", id: p.id }),
      });
    }
    const matchingNotes = notes
      .map((n) => ({ n, s: Math.max(score(n.title, q), q.length > 2 && plainText(n.content).toLowerCase().includes(q) ? 20 : 0) }))
      .filter((x) => q && x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);
    for (const { n } of matchingNotes) {
      out.push({
        id: `note:${n.id}`,
        group: "Notes",
        title: n.title || "Untitled note",
        icon: <FileText />,
        run: () => go({ view: "note", id: n.id }),
      });
    }
    const actions: Command[] = [
      { id: "a:new", group: "Actions", title: "New task", hint: "N", icon: <Plus />, run: () => { close(); ui.newTask({}); } },
      { id: "a:assignment", group: "Actions", title: "New assignment", icon: <GraduationCap />, run: () => { close(); ui.newTask({ type: "assignment", durationMinutes: 120 }); } },
      { id: "a:note", group: "Actions", title: "New note", icon: <FileText />, run: () => { close(); createNote(navigate); } },
      { id: "a:subject", group: "Actions", title: "New subject", icon: <BookOpen />, run: () => { close(); void createSubject(); } },
      {
        id: "a:theme",
        group: "Actions",
        title: themeMode === "dark" ? "Use light appearance" : "Use dark appearance",
        icon: themeMode === "dark" ? <Sun /> : <Moon />,
        run: () => { close(); setThemeMode(themeMode === "dark" ? "light" : "dark"); },
      },
      { id: "g:today", group: "Go to", title: "Today", hint: "1", icon: <Sun />, run: () => go({ view: "today" }) },
      { id: "g:week", group: "Go to", title: "Week", hint: "2", icon: <Columns3 />, run: () => go({ view: "week" }) },
      { id: "g:calendar", group: "Go to", title: "Calendar", hint: "3", icon: <CalendarDays />, run: () => go({ view: "calendar" }) },
      { id: "g:assignments", group: "Go to", title: "Assignments", hint: "4", icon: <GraduationCap />, run: () => go({ view: "assignments" }) },
      { id: "g:subjects", group: "Go to", title: "Subjects", hint: "5", icon: <BookOpen />, run: () => go({ view: "subjects" }) },
      { id: "g:notes", group: "Go to", title: "Notes", hint: "6", icon: <FileText />, run: () => go({ view: "notes" }) },
      { id: "g:settings", group: "Go to", title: "Settings", icon: <Settings />, run: () => go({ view: "settings" }) },
    ];
    out.push(...actions.filter((a) => score(a.title, q) > 0 || (q && a.group.toLowerCase().startsWith(q))));
    return out;
  }, [query, all, projects, notes, themeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setActive(0);
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastGroup = "";
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
        <Search className="size-4 text-ink-3" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(commands.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              commands[active]?.run();
            }
          }}
          placeholder="Search tasks, subjects and notes"
          className="h-full flex-1 bg-transparent text-base outline-none placeholder:text-ink-3"
        />
        <Kbd>esc</Kbd>
      </div>
      <div ref={listRef} className="scroll-area min-h-0 flex-1 p-1.5">
        {commands.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-3">No results</p>}
        {commands.map((c, i) => {
          const heading = c.group && c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {heading && <div className="px-3 pt-3 pb-1 text-2xs font-medium text-ink-3">{heading}</div>}
              <button
                type="button"
                data-index={i}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => c.run()}
                className="relative flex h-9 w-full items-center gap-3 rounded-[8px] px-3 text-left text-sm"
              >
                {active === i && (
                  <motion.span layoutId="palette-active" transition={springs.snappy} className="absolute inset-0 rounded-[8px] bg-fill" />
                )}
                <span className="relative flex size-4 items-center justify-center text-ink-3 [&>svg]:size-4">{c.icon}</span>
                <span className={cn("relative min-w-0 flex-1 truncate", c.id === "create" && "font-medium")}>{c.title}</span>
                {c.hint && <span className="relative shrink-0 text-xs text-ink-3">{c.hint}</span>}
                {active === i && <CornerDownLeft className="relative size-3.5 text-ink-3" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { format } from "date-fns";
import { AiError, chatJson, useAiKey } from "@/lib/ai";
import { plainText } from "@/lib/delta";
import { uuid, type Task } from "@/lib/model";
import { daysFromToday, formatDuration, sameDay, startOfDay, today } from "@/lib/time";
import { readSteps, workBackMessages, type Step } from "@/lib/workBack";
import { useNavigate } from "@/shell/nav";
import { addSubtaskFull, useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, Spinner } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { Modal } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { DateField } from "./fields";
import { useAllTasks } from "./meta";
import { TaskCheck } from "./TaskCheck";

interface Suggestion extends Step {
  key: string;
  include: boolean;
}

/**
 * Suggests the steps of an assignment, dated back from its deadline. The
 * suggestions are only a draft: each can be renamed, moved or left out
 * before any are added.
 */
export function WorkBack({ task, open, onOpenChange }: { task: Task; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const hasKey = useAiKey((s) => !!s.key);
  const projects = useWorkspace((s) => s.projects);
  const all = useAllTasks();
  const [request, setRequest] = useState("");
  const [steps, setSteps] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) abort.current?.abort();
  }, [open]);

  const load = useMemo(() => {
    const map = new Map<number, number>();
    for (const t of all) {
      if (t.isDone || t.id === task.id) continue;
      const key = startOfDay(t.date).getTime();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [all, task.id]);
  const busyDay = (d: Date) => (load.get(startOfDay(d).getTime()) ?? 0) > 0;

  const suggest = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const answer = await chatJson<unknown>(
        workBackMessages({
          title: task.title,
          subject: projects.find((p) => p.id === task.projectId)?.title,
          notes: plainText(task.notes),
          deadline: task.date,
          today: today(),
          minutes: task.durationMinutes,
          existing: task.subtasks.map((s) => s.title),
          load,
          request,
        }),
        controller.signal,
        // Planning backwards from a deadline is worth a moment's thought.
        "think",
      );
      const found = readSteps(answer, task.date, today());
      if (found.length === 0) throw new AiError("No steps came back. Try again, or add a note about the assignment.");
      setSteps(found.map((s) => ({ ...s, key: uuid(), include: true })));
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof AiError ? e.message : "Something went wrong. Try again.");
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  };

  const chosen = steps?.filter((s) => s.include && s.title.trim()) ?? [];
  const add = () => {
    for (const s of chosen) {
      addSubtaskFull(task.id, {
        id: uuid(),
        title: s.title.trim(),
        isDone: false,
        date: startOfDay(s.date),
        priority: null,
        difficulty: null,
        ...(s.minutes ? { extra: { minutes: s.minutes } } : {}),
      });
    }
    toast(`Added ${chosen.length} ${chosen.length === 1 ? "step" : "steps"}. Each shows on its day.`);
    onOpenChange(false);
    setSteps(null);
  };
  const update = (key: string, patch: Partial<Suggestion>) =>
    setSteps((list) => list?.map((s) => (s.key === key ? { ...s, ...patch } : s)) ?? null);

  const away = daysFromToday(task.date);
  return (
    <Modal open={open} onOpenChange={onOpenChange} width={560} label="Work back from the deadline" initialFocus={(e) => e.preventDefault()}>
      <div className="flex min-h-0 flex-col">
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-base font-semibold">Work back from the deadline</h2>
          <p className="mt-1 text-sm text-ink-2">
            {task.title} is due {format(task.date, "EEEE d MMMM")}
            {away > 1 ? `, in ${away} days` : away === 1 ? ", tomorrow" : away === 0 ? ", today" : ""}.
          </p>
        </div>
        {!hasKey ? (
          <div className="border-t border-line px-5 py-5">
            <p className="text-sm text-ink-2">
              Steps are suggested by DeepSeek, using your own API key. The key stays on this device.
            </p>
            <Button
              className="mt-3"
              variant="primary"
              onClick={() => {
                onOpenChange(false);
                navigate({ view: "settings" });
              }}
            >
              Add a key in Settings
            </Button>
          </div>
        ) : (
          <>
            <div className="border-t border-line px-5 py-4">
              <textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                rows={2}
                placeholder="Anything to keep in mind? For example: the data is already collected, or no work on Wednesdays."
                className="w-full resize-none rounded-ctl border border-line-strong bg-card px-3 py-2 text-sm leading-5 outline-none transition-[border-color,box-shadow] placeholder:text-ink-4 focus:border-accent focus:ring-3 focus:ring-accent-soft"
              />
              <div className="mt-2.5 flex items-center gap-3">
                <Button variant={steps ? "secondary" : "primary"} onClick={() => void suggest()} disabled={busy} icon={busy ? <Spinner className="size-3.5" /> : undefined}>
                  {busy ? "Planning…" : steps ? "Suggest again" : "Suggest steps"}
                </Button>
                {error && <span className="text-xs text-danger">{error}</span>}
              </div>
            </div>
            <AnimatePresence initial={false}>
              {steps && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={springs.layout}
                  className="min-h-0 overflow-hidden border-t border-line"
                >
                  <ul className={cn("scroll-area max-h-[46vh] px-3 py-2 transition-opacity", busy && "opacity-50")}>
                    {steps.map((s) => (
                      <li key={s.key} className="flex items-center gap-2.5 rounded-ctl px-2 py-1.5 transition-colors hover:bg-fill/60">
                        <TaskCheck size={16} checked={s.include} onToggle={() => update(s.key, { include: !s.include })} />
                        <div className={cn("min-w-0 flex-1", !s.include && "opacity-45")}>
                          <input
                            value={s.title}
                            onChange={(e) => update(s.key, { title: e.target.value })}
                            aria-label="Step"
                            className="w-full bg-transparent text-sm outline-none"
                          />
                          {s.minutes && <span className="text-2xs text-ink-3">About {formatDuration(s.minutes)}</span>}
                        </div>
                        <DateField
                          value={s.date}
                          onChange={(d) => update(s.key, { date: d })}
                          marks={busyDay}
                          className={cn("w-[150px] shrink-0", !s.include && "opacity-45", sameDay(s.date, task.date) && "text-danger")}
                        />
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                    <span className="text-xs text-ink-3">Dots in the calendar mark days that already have tasks.</span>
                    <Button variant="primary" onClick={add} disabled={chosen.length === 0 || busy}>
                      Add {chosen.length} {chosen.length === 1 ? "step" : "steps"}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </Modal>
  );
}

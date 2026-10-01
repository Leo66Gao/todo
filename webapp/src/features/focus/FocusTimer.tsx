"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pause, Play, Plus, Square } from "lucide-react";
import {
  advanceFocus,
  announceEnd,
  extendFocus,
  focusRound,
  totalLeft,
  pauseFocus,
  resumeFocus,
  setFocusExpanded,
  startFocus,
  stopFocus,
  timeLeft,
  useFocus,
  type FocusSession,
} from "@/lib/focus";
import { useWorkspace, toggleTask } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, IconButton } from "@/ui/controls";
import { springs } from "@/ui/motion";
import { Modal } from "@/ui/overlay";
import { toast } from "@/ui/toast";

const clock = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

/** Re-renders every second while a session runs; announces its end once. */
function useTick(session: FocusSession | null) {
  const [now, setNow] = useState(() => Date.now());
  const announced = useRef<number | null>(null);
  useEffect(() => {
    if (!session?.endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session?.endsAt]);
  useEffect(() => {
    if (!session?.endsAt) return;
    const left = session.endsAt - now;
    if (left <= 0 && announced.current !== session.endsAt) {
      announced.current = session.endsAt;
      announceEnd(session);
      // A planned session rolls on into its break, or its next round.
      advanceFocus();
    }
  }, [now, session]);
  return now;
}

function Ring({ progress, size = 18 }: { progress: number; size?: number }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - progress)}
        style={{ transition: "stroke-dashoffset 1s linear" }}
      />
    </svg>
  );
}

export function FocusTimer() {
  const session = useFocus((s) => s.session);
  const expanded = useFocus((s) => s.expanded);
  const now = useTick(session);
  const task = useWorkspace((s) => (session?.taskId ? s.tasks.find((t) => t.id === session.taskId) : undefined));
  const left = session ? timeLeft(session, now) : 0;
  const finished = !!session && left <= 0;
  const paused = !!session && session.endsAt == null && !finished;
  const progress = session ? 1 - left / session.length : 0;
  const isBreak = session?.kind === "break";
  const title = isBreak ? "Break" : session?.title || "Focus";
  const round = session ? focusRound(session) : null;
  const roundLine = round
    ? [
        `Round ${round.round} of ${round.of}`,
        round.next
          ? round.next.kind === "break"
            ? `then a ${Math.round(round.next.ms / 60_000)}-minute break`
            : `then ${Math.round(round.next.ms / 60_000)} minutes of focus`
          : "the last one",
      ].join(", ")
    : null;

  return (
    <>
      <AnimatePresence>
        {session && !expanded && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.15 } }}
            transition={springs.panel}
            className="pointer-events-none fixed inset-x-0 bottom-[calc(max(10px,env(safe-area-inset-bottom))+72px)] z-40 flex justify-center px-4 md:bottom-5"
          >
            <div
              className={cn(
                "glass-overlay float-glass pointer-events-auto flex h-11 max-w-full items-center gap-2 rounded-full bg-raised py-1 pr-1 pl-3.5 shadow-pop",
                finished && "text-accent",
              )}
            >
              <button type="button" onClick={() => setFocusExpanded(true)} className="flex min-w-0 items-center gap-2.5 text-left">
                <Ring progress={finished ? 1 : progress} />
                <span className={cn("text-sm font-semibold tnum", paused && "text-ink-3")}>{finished ? (isBreak ? "Break’s over" : "Time’s up") : clock(left)}</span>
                <span className="max-w-[40vw] truncate text-sm text-ink-2 md:max-w-[260px]">{title}</span>
              </button>
              {finished ? (
                <Button size="sm" variant="primary" className="rounded-full" onClick={() => setFocusExpanded(true)}>
                  Next
                </Button>
              ) : (
                <IconButton label={paused ? "Resume" : "Pause"} className="rounded-full" onClick={paused ? resumeFocus : pauseFocus}>
                  {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                </IconButton>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={!!session && expanded} onOpenChange={setFocusExpanded} width={400} label="Focus" initialFocus={(e) => e.preventDefault()}>
        {session && (
          <div className="flex flex-col items-center px-6 pt-7 pb-6 text-center">
            <span className="text-xs font-medium text-ink-3">{isBreak ? "Break" : paused ? "Paused" : finished ? "Done" : "Focusing"}</span>
            <p className="mt-1 line-clamp-2 max-w-full text-base font-semibold">{isBreak && session.title ? session.title : title}</p>
            {roundLine && <p className="mt-1 text-xs text-ink-3">{roundLine}</p>}
            <div className={cn("mt-6 font-display text-[56px] leading-none font-semibold tracking-[-0.03em] tnum", paused && "text-ink-3")}>
              {finished ? "0:00" : clock(left)}
            </div>
            <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-fill-strong">
              <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, progress * 100)}%`, transition: "width 1s linear" }} />
            </div>
            {session.plan && !finished && (
              <p className="mt-3 text-sm text-ink-2">
                <span className="font-medium text-ink tnum">{clock(totalLeft(session, now))}</span> left in total, breaks included
              </p>
            )}
            {finished ? (
              <div className="mt-6 flex w-full flex-col gap-2">
                {!isBreak && task && !task.isDone && (
                  <Button
                    variant="primary"
                    onClick={() => {
                      toggleTask(task.id);
                      stopFocus();
                      toast(`Completed “${task.title}”`);
                    }}
                  >
                    Mark as done
                  </Button>
                )}
                {!isBreak && (
                  <Button onClick={() => startFocus(5, session.taskId ? { id: session.taskId, title: session.title } : null, "break")}>
                    Take a 5-minute break
                  </Button>
                )}
                {isBreak && session.taskId && (
                  <Button variant="primary" onClick={() => startFocus(25, { id: session.taskId!, title: session.title })}>
                    Focus for another 25 minutes
                  </Button>
                )}
                <div className="flex gap-2">
                  <Button className="flex-1" variant="ghost" onClick={() => extendFocus(5)}>
                    5 more minutes
                  </Button>
                  <Button className="flex-1" variant="ghost" onClick={stopFocus}>
                    Finish
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex items-center gap-2">
                <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => extendFocus(5)}>
                  5 min
                </Button>
                <Button variant="primary" className="min-w-28" icon={paused ? <Play className="size-4" /> : <Pause className="size-4" />} onClick={paused ? resumeFocus : pauseFocus}>
                  {paused ? "Resume" : "Pause"}
                </Button>
                <Button variant="ghost" icon={<Square className="size-3.5" />} onClick={stopFocus}>
                  Stop
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

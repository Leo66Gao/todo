"use client";

import { useEffect, useMemo } from "react";
import { motion } from "motion/react";
import { format } from "date-fns";
import type { Task } from "@/lib/model";
import { relativeDay, sameDay, today } from "@/lib/time";
import { gapLabel, upcomingRows } from "@/lib/upcoming";
import { ui } from "@/shell/ui";
import { TaskList } from "@/features/tasks/TaskList";
import { springs } from "@/ui/motion";

export function Upcoming({ all }: { all: Task[] }) {
  const rows = useMemo(() => upcomingRows(all), [all]);
  useEffect(() => {
    ui.set({ visibleOrder: rows.flatMap((r) => (r.kind === "day" ? r.tasks.map((t) => t.id) : [])) });
  }, [rows]);
  if (rows.length === 0) {
    return (
      <div className="card mx-auto mt-2 flex w-full max-w-[720px] flex-col items-center px-4 py-10 text-center">
        <p className="text-sm text-ink-2">Nothing planned from today on</p>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[720px]">
      {rows.map((row) =>
        row.kind === "gap" ? (
          <div key={`gap-${row.from.getTime()}`} className="flex items-center gap-3 px-2 py-2.5 text-2xs text-ink-3">
            <span className="h-px flex-1 bg-line" />
            <span className="tnum">{gapLabel(row.from, row.to)}</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        ) : (
          <motion.section key={row.date.getTime()} layout="position" transition={springs.layout} className="pt-2">
            <div className="flex min-w-0 items-baseline gap-2 px-2 pb-2">
              <h3 className={`truncate text-sm font-semibold ${sameDay(row.date, today()) ? "text-accent" : ""}`}>
                {format(row.date, "EEEE d MMMM")}
              </h3>
              <span className="shrink-0 text-xs text-ink-3">{relativeLabel(row.date)}</span>
              <span className="ml-auto shrink-0 text-xs text-ink-3 tnum">{row.tasks.filter((t) => !t.isDone).length || ""}</span>
            </div>
            <TaskList tasks={row.tasks} />
          </motion.section>
        ),
      )}
    </div>
  );
}

function relativeLabel(date: Date) {
  const rel = relativeDay(date);
  return rel === "Today" || rel === "Tomorrow" ? rel : "";
}

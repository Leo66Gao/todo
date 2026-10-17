"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { addDays, formatDuration, relativeDay, sameDay, today } from "@/lib/time";
import { useEvents } from "@/lib/googleEvents";
import { EventRow } from "@/features/events/EventSheet";
import { PageHeader, Stepper } from "@/shell/Shell";
import { ui, useUI } from "@/shell/ui";
import { overdueTasks, tasksForDay, useAllTasks, workMinutes } from "@/features/tasks/meta";
import { Section, TaskList } from "@/features/tasks/TaskList";
import { moveTask } from "@/features/tasks/actions";
import { rescheduleTask } from "@/store/workspace";
import { Button } from "@/ui/controls";
import { fade, springs } from "@/ui/motion";
import { Tooltip } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { useMedia } from "@/ui/useMedia";
import { useNavigate } from "@/shell/nav";
import { argbToCss } from "@/lib/dart";
import { useWorkspace } from "@/store/workspace";
import { examLabel, upcomingExams } from "@/features/subjects/exams";
import { DayStrip } from "./DayStrip";
import { ScheduleRail } from "./ScheduleRail";

export function TodayView() {
  const day = useUI((s) => s.day);
  const all = useAllTasks();
  const { timed, untimed, done } = useMemo(() => tasksForDay(all, day), [all, day]);
  const events = useEvents(day, addDays(day, 1));
  const now = useUI((s) => s.today);
  const isToday = sameDay(day, now);
  const overdue = useMemo(() => (isToday ? overdueTasks(all, now) : []), [all, isToday, now]);
  const [reviewing, setReviewing] = useState(false);

  const open = timed.length + untimed.length;
  const total = open + done.length;
  const planned = [...timed, ...untimed].reduce((sum, t) => sum + workMinutes(t), 0);

  useEffect(() => {
    ui.set({ visibleOrder: [...(reviewing ? overdue : []), ...timed, ...untimed, ...done].map((t) => t.id) });
  }, [timed, untimed, done, overdue, reviewing]);

  const setDay = (d: Date) => ui.set({ day: d });
  const phone = useMedia("(max-width: 767px)");
  // The title is the weekday; "Today", "Tomorrow" or "Yesterday" goes with the date.
  const relative = relativeDay(day);
  const nearWord = ["Today", "Tomorrow", "Yesterday"].includes(relative) ? relative : null;

  const moveAllOverdue = () => {
    const moved = overdue.map((t) => ({ id: t.id, date: t.date }));
    for (const t of overdue) moveTask(t, today(), true);
    setReviewing(false);
    toast(`Moved ${moved.length} ${moved.length === 1 ? "task" : "tasks"} to today`, {
      label: "Undo",
      run: () => moved.forEach((m) => rescheduleTask(m.id, m.date)),
    });
  };

  return (
    <>
      <PageHeader
        title={format(day, "EEEE")}
        detail={nearWord ? `${nearWord}, ${format(day, "d MMMM")}` : format(day, "d MMMM yyyy")}
        eyebrow={nearWord ? `${nearWord} · ${format(day, "d MMM")}` : format(day, "d MMM yyyy")}
        actions={
          <>
            <Stepper
              prev="Previous day"
              next="Next day"
              prevShortcut={["←"]}
              nextShortcut={["→"]}
              onPrev={() => setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1))}
              onNext={() => setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1))}
              present="Today"
              atPresent={isToday}
              onPresent={() => setDay(today())}
            />
            <Tooltip label="New task" shortcut={["N"]}>
              <Button variant="primary" className="max-md:hidden" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ date: day })}>
                <span className="max-sm:hidden">New task</span>
              </Button>
            </Tooltip>
          </>
        }
      />
      <div className="@container flex min-h-0 flex-1 flex-col">
        {!phone && (
          <div className="mx-auto w-full max-w-[820px] shrink-0 px-6 @min-[1060px]:max-w-[1160px]">
            <div className="card p-1.5">
              <DayStrip day={day} onPick={setDay} tasks={all} />
            </div>
          </div>
        )}
        <div className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 gap-8 px-6 max-sm:px-3 @min-[1060px]:max-w-[1160px]">
          {/* The list reaches into the page margin, so the cards' shadows fade out before its edge. */}
          <div className="scroll-area -mx-6 min-w-0 flex-1 px-6 pb-bar max-sm:-mx-3 max-sm:px-3">
            {/* On phones the strip floats over the list, which scrolls past its lower corners. */}
            {phone && (
              // The page colour fills behind its top corners; below, the list shows through.
              <div className="sticky top-0 z-10 bg-[linear-gradient(var(--canvas)_50%,transparent_50%)]">
                <div className="rounded-[26px] border border-line bg-card p-1.5">
                  <DayStrip day={day} onPick={setDay} tasks={all} />
                </div>
              </div>
            )}
            <div className="mt-4 flex items-center gap-5 px-2 text-xs whitespace-nowrap text-ink-3 max-sm:gap-4">
              <span>
                <span className="font-semibold text-ink tnum">{open}</span> open
              </span>
              {planned > 0 && (
                <span>
                  <span className="font-semibold text-ink tnum">{formatDuration(planned)}</span> planned
                </span>
              )}
              {total > 0 && (
                <span className="ml-auto flex items-center gap-2.5">
                  <span className="relative h-1 w-24 overflow-hidden rounded-full bg-fill-strong max-sm:w-12">
                    <motion.span
                      className="absolute inset-y-0 left-0 rounded-full bg-ink"
                      initial={false}
                      animate={{ width: `${(done.length / total) * 100}%` }}
                      transition={springs.panel}
                    />
                  </span>
                  <span className="tnum">
                    {done.length} of {total} done
                  </span>
                </span>
              )}
            </div>

            {isToday && <ExamsSoon />}

            <AnimatePresence initial={false}>
              {overdue.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={springs.layout}
                  className="overflow-hidden"
                >
                  <div className="card mt-4 px-2 py-2">
                    <div className="flex items-center gap-2 pl-2">
                      <span className="size-1.5 rounded-full bg-danger" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-2">
                        <span className="font-medium text-ink tnum">{overdue.length}</span> overdue
                        <span className="max-[400px]:hidden"> {overdue.length === 1 ? "task" : "tasks"}</span>
                        <span className="max-sm:hidden"> from earlier days</span>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => setReviewing((v) => !v)}>
                        {reviewing ? "Hide" : "Review"}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={moveAllOverdue}>
                        Move all to today
                      </Button>
                    </div>
                    <AnimatePresence initial={false}>
                      {reviewing && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={springs.layout}
                          className="overflow-hidden"
                        >
                          <div className="mt-1.5 border-t border-line pt-1.5">
                            <TaskList
                              tasks={overdue}
                              plain
                              showDate
                              trailing={(t) => (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="mt-0.5 hover-reveal opacity-0 group-hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveTask(t, today());
                                  }}
                                >
                                  Today
                                </Button>
                              )}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* A new day's list arrives whole, with a short fade: rows
                animating in and out one by one read as an accordion. */}
            <motion.div key={day.getTime()} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade} className="mt-5">
              {events.length > 0 && (
                <Section title="Calendar" count={events.length}>
                  <div className="space-y-px">
                    {events.map((e) => (
                      <EventRow key={e.key} event={e} />
                    ))}
                  </div>
                </Section>
              )}
              {total === 0 ? (
                events.length === 0 && <EmptyDay day={day} />
              ) : (
                <>
                  {timed.length > 0 && (
                    <Section title="Scheduled" count={timed.length}>
                      <TaskList tasks={timed} />
                    </Section>
                  )}
                  {untimed.length > 0 && (
                    <Section title="Tasks" count={untimed.length}>
                      <TaskList tasks={untimed} sortable id="today-untimed" />
                    </Section>
                  )}
                  {done.length > 0 && (
                    <Section
                      key={day.getTime()}
                      title="Completed"
                      count={done.length}
                      collapsible
                      defaultOpen={day.getTime() < today().getTime()}
                    >
                      <TaskList tasks={done} />
                    </Section>
                  )}
                  <button
                    type="button"
                    onClick={() => ui.newTask({ date: day })}
                    className="mt-1 flex h-11 w-full items-center gap-2.5 rounded-card px-3.5 text-sm text-ink-3 transition-colors hover:bg-card hover:text-ink-2"
                  >
                    <Plus className="size-4" />
                    Add a task
                  </button>
                </>
              )}
            </motion.div>
          </div>
          <div className="hidden pt-4 pb-6 @min-[1060px]:flex">
            <ScheduleRail day={day} tasks={all} events={events} />
          </div>
        </div>
      </div>
    </>
  );
}

function EmptyDay({ day }: { day: Date }) {
  const isToday = sameDay(day, today());
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <p className="text-sm font-medium">{isToday ? "Nothing planned for today" : `Nothing planned for ${relativeDay(day)}`}</p>
      <p className="mt-1 text-xs text-ink-3">Add a task, or drag one here from another day.</p>
      <Button variant="secondary" className="mt-4" icon={<Plus className="size-4" />} onClick={() => ui.newTask({ date: day })}>
        New task
      </Button>
    </div>
  );
}

/** Exams in the next two weeks, soonest first; each opens its subject. */
function ExamsSoon() {
  const navigate = useNavigate();
  const projects = useWorkspace((s) => s.projects);
  const exams = upcomingExams(projects, 14);
  if (exams.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 px-1">
      {exams.map(({ project, days }) => (
        <button
          key={project.id}
          type="button"
          onClick={() => navigate({ view: "subject", id: project.id })}
          className="flex h-7 items-center gap-1.5 rounded-full bg-fill px-2.5 text-xs text-ink-2 transition-colors hover:bg-fill-strong hover:text-ink"
        >
          <span className="size-[7px] rounded-full" style={{ background: argbToCss(project.colorValue) }} />
          <span className="font-medium text-ink">{project.title}</span>
          <span className={days <= 3 ? "font-medium text-ink" : undefined}>{examLabel(days)!.replace(/^Exam/, "exam")}</span>
        </button>
      ))}
    </div>
  );
}

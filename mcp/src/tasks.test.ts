import { describe, expect, it } from "vitest";
import { isDay, isTime, newTask, notesText, patchTask, scheduleMilestone, scheduleTask, splitId, viewTask } from "./tasks";

const stored = () => ({
  id: "t1",
  title: "Econ",
  notes: "",
  isDone: false,
  date: "2026-11-17T00:00:00.000",
  type: "TaskType.todo",
  priority: "TaskPriority.medium",
  difficulty: 1,
  durationMinutes: 60,
  projectId: "p1",
  parentTaskId: null,
  category: "General",
  startTime: "2026-11-17T13:00:00.000",
  remainingMinutes: 0,
  subtasks: [],
  googleEventId: null,
  calendarEventRevision: 0,
  isConflictCopy: false,
  futureField: { kept: true },
});

describe("tasks", () => {
  it("reads a task as days and wall-clock times", () => {
    expect(viewTask(stored(), new Map([["p1", "Economics"]]))).toMatchObject({
      id: "t1",
      date: "2026-11-17",
      start: "13:00",
      durationMinutes: 60,
      priority: "medium",
      subject: "Economics",
      done: false,
    });
  });

  it("moves a task to another day keeping its time, as the app does", () => {
    const t = scheduleTask(stored(), { date: "2026-11-20" });
    expect(t.date).toBe("2026-11-20T00:00:00.000");
    expect(t.startTime).toBe("2026-11-20T13:00:00.000");
    expect(t.futureField).toEqual({ kept: true });
  });

  it("sets or clears the start time and length", () => {
    expect(scheduleTask(stored(), { date: "2026-11-18", start: "09:30", durationMinutes: 45 })).toMatchObject({
      startTime: "2026-11-18T09:30:00.000",
      durationMinutes: 45,
    });
    expect(scheduleTask(stored(), { date: "2026-11-18", start: null }).startTime).toBeNull();
  });

  it("moves an assignment's milestone", () => {
    const t = { ...stored(), type: "TaskType.assignment", subtasks: [{ id: "s1", title: "Draft", isDone: false, date: null }] };
    expect(scheduleMilestone(t, "s1", "2026-11-25")).toBe(true);
    expect((t.subtasks[0] as { date: unknown }).date).toBe("2026-11-25T00:00:00.000");
    expect(scheduleMilestone(t, "nope", "2026-11-25")).toBe(false);
    expect(viewTask(t, new Map()).milestones).toEqual([{ id: "t1/s1", title: "Draft", date: "2026-11-25", done: false }]);
    expect(splitId("t1/s1")).toEqual({ taskId: "t1", subtaskId: "s1" });
  });

  it("edits only the fields given", () => {
    const t = patchTask(stored(), { done: true, priority: "high" });
    expect(t).toMatchObject({ isDone: true, priority: "TaskPriority.high", title: "Econ", durationMinutes: 60 });
  });

  it("writes new tasks in the apps' field order", () => {
    const keys = Object.keys(stored()).filter((k) => k !== "futureField");
    expect(Object.keys(newTask({ id: "n", title: "Read", date: "2026-11-19", start: "18:00", durationMinutes: 30 }))).toEqual(keys);
    expect(newTask({ id: "n", title: "Read", date: "2026-11-19", start: "18:00" }).startTime).toBe("2026-11-19T18:00:00.000");
  });

  it("validates days and times", () => {
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isTime("24:00")).toBe(false);
    expect(isTime("07:05")).toBe(true);
  });

  it("reads notes as plain text", () => {
    expect(notesText(JSON.stringify([{ insert: "Chapter 4\n" }]))).toBe("Chapter 4");
    expect(notesText("plain")).toBe("plain");
  });
});

import { describe, expect, it } from "vitest";
import { decodeSettings, decodeTask, defaultSettings, encodeSettings, encodeTask, hasExplicitDifficulty } from "@/lib/model";

// Exactly what Flutter's Task.toJson() writes (see lib/models/task.dart).
const flutterTask = {
  id: "t1",
  title: "History essay",
  notes: "",
  isDone: false,
  date: "2026-09-26T00:00:00.000",
  type: "TaskType.assignment",
  priority: "TaskPriority.high",
  difficulty: 3,
  durationMinutes: 240,
  projectId: "hist",
  parentTaskId: null,
  category: "Homework",
  startTime: "2026-09-26T15:30:00.000",
  remainingMinutes: 180,
  subtasks: [
    { id: "s1", title: "Outline", isDone: true, date: "2026-09-22T00:00:00.000", priority: null, difficulty: null },
    { id: "s2", title: "Draft", isDone: false, date: null, priority: "TaskPriority.low", difficulty: 2 },
  ],
  googleEventId: null,
  calendarEventRevision: 2,
  isConflictCopy: false,
};

describe("task records", () => {
  it("round-trips a Flutter task byte for byte", () => {
    const task = decodeTask(flutterTask);
    expect(task.type).toBe("assignment");
    expect(task.priority).toBe("high");
    expect(task.startTime?.getHours()).toBe(15);
    expect(task.subtasks[1].priority).toBe("low");
    expect(JSON.stringify(encodeTask(task))).toBe(JSON.stringify(flutterTask));
  });

  it("keeps fields it does not know about", () => {
    const task = decodeTask({ ...flutterTask, futureField: { a: 1 } });
    expect(encodeTask(task).futureField).toEqual({ a: 1 });
  });

  it("round-trips an explicitly selected Level 1 without changing legacy unset tasks", () => {
    const legacy = decodeTask({ ...flutterTask, difficulty: 1 });
    const selected = decodeTask({ ...flutterTask, difficulty: 1, difficultySelected: true });
    expect(hasExplicitDifficulty(legacy)).toBe(false);
    expect(hasExplicitDifficulty(selected)).toBe(true);
    expect(encodeTask(selected)).toMatchObject({ difficulty: 1, difficultySelected: true });
  });

  it("fills Flutter's defaults for missing fields", () => {
    const task = decodeTask({ id: "t2", title: "Gym", date: "2026-09-25T00:00:00" });
    expect(task).toMatchObject({
      notes: "",
      isDone: false,
      type: "todo",
      priority: "none",
      difficulty: 1,
      durationMinutes: 0,
      category: "General",
      startTime: null,
      subtasks: [],
    });
    expect(encodeTask(task).date).toBe("2026-09-25T00:00:00.000");
  });

  it("rejects unreadable dates", () => {
    expect(() => decodeTask({ ...flutterTask, date: "soon" })).toThrow();
  });
});

describe("settings records", () => {
  it("round-trips the defaults", () => {
    const encoded = encodeSettings(defaultSettings());
    expect(encodeSettings(decodeSettings(encoded))).toEqual(encoded);
  });
});

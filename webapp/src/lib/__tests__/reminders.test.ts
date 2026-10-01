import { expect, it } from "vitest";
import { newTask } from "@/store/workspace";
import { planReminders, type ReminderPrefs } from "../reminders";

const prefs: ReminderPrefs = { timed: true, lead: 10, summary: false, summaryAt: 450 };
const now = new Date(2026, 8, 28, 9, 0);
const at = (h: number, m = 0, day = 28) => new Date(2026, 8, day, h, m);
const task = (title: string, start: Date | null, extra = {}) =>
  newTask({ title, date: new Date(2026, 8, start?.getDate() ?? 28), startTime: start, ...extra });
const noSubject = () => null;

it("reminds before upcoming timed tasks only", () => {
  const plan = planReminders(
    [
      task("Maths", at(15), { projectId: "p1" }),
      task("Past", at(8, 30)),
      task("Done", at(16), { isDone: true }),
      task("No time", null),
      task("Too far", at(15, 0, 28 + 20)),
    ],
    prefs,
    now,
    (id) => (id === "p1" ? { title: "Maths AA", color: "#5B7FA6" } : null),
  );
  expect(plan.map((r) => r.title)).toEqual(["Maths"]);
  expect(plan[0].at).toEqual(at(14, 50));
  expect(plan[0].body).toBe("15.00 · starts in 10 min");
  expect(plan[0].summary).toBe("Maths AA");
  expect(plan[0].color).toBe("#5B7FA6");
  expect(plan[0].actions).toBe(true);
});

it("keeps one stable id per task", () => {
  const t = task("Essay", at(11));
  const a = planReminders([t], prefs, now, noSubject)[0];
  const b = planReminders([{ ...t, title: "Essay draft" }], prefs, now, noSubject)[0];
  expect(a.id).toBe(b.id);
  expect(a.id).toBeGreaterThan(0);
});

it("adds a morning summary on days with tasks", () => {
  const plan = planReminders([task("Lab", at(13, 30, 29))], { ...prefs, timed: false, summary: true }, now, noSubject);
  expect(plan).toHaveLength(1);
  expect(plan[0].at).toEqual(at(7, 30, 29));
  expect(plan[0].title).toBe("Tuesday · 1 task");
  expect(plan[0].body).toBe("First up: Lab at 13.30");
  expect(plan[0].lines).toEqual(["13.30 · Lab"]);
  expect(plan[0].actions).toBe(false);
});

it("shows the whole time slot and what the task involves", () => {
  const essay = task("Essay", at(20), {
    durationMinutes: 60,
    notes: "\nOutline first, then the intro.\nMore",
    subtasks: [
      { id: "s1", title: "Outline", isDone: true, date: null, priority: null, difficulty: null },
      { id: "s2", title: "Intro", isDone: false, date: null, priority: null, difficulty: null },
    ],
  });
  const reading = task("Reading", at(21, 30));
  const [first, second] = planReminders([reading, essay], prefs, now, noSubject);
  expect(first.title).toBe("Essay");
  expect(first.body).toBe("20.00–21.00 · starts in 10 min");
  expect(first.largeBody).toBe(
    ["20.00–21.00 · 1 h · starts in 10 min", "1 of 2 steps done · next: Intro", "Outline first, then the intro.", "Then Reading at 21.30"].join("\n"),
  );
  expect(second.largeBody).toBe(["21.30 · starts in 10 min", "Last one today"].join("\n"));
  expect(planReminders([essay], { ...prefs, lead: 0 }, now, noSubject)[0].body).toBe("20.00–21.00 · starting now");
});

it("lists the day in order in the morning summary", () => {
  const plan = planReminders(
    [
      task("Problem set", null, { date: new Date(2026, 8, 29) }),
      task("Lecture", at(10, 0, 29), { durationMinutes: 90, projectId: "p1" }),
      task("Lab", at(8, 0, 29), { durationMinutes: 30 }),
    ],
    { ...prefs, timed: false, summary: true },
    now,
    (id) => (id === "p1" ? { title: "Physics", color: "#000000" } : null),
  );
  expect(plan[0].title).toBe("Tuesday · 3 tasks");
  expect(plan[0].body).toBe("First up: Lab at 08.00");
  expect(plan[0].lines).toEqual(["08.00–08.30 · Lab", "10.00–11.30 · Lecture · Physics", "Problem set"]);
  expect(plan[0].summary).toBe("2 h planned");
});

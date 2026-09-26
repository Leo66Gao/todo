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
    (id) => (id === "p1" ? "Maths AA" : null),
  );
  expect(plan.map((r) => r.title)).toEqual(["Maths"]);
  expect(plan[0].at).toEqual(at(14, 50));
  expect(plan[0].body).toBe("In 10 min · 15.00 · Maths AA");
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
  expect(plan[0].title).toBe("1 task today");
  expect(plan[0].body).toBe("First: Lab at 13.30");
});

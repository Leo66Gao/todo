import { afterEach, expect, it, vi } from "vitest";
import { dayString, describeRepeat, readRepeat, repeatDays, type RepeatRule } from "../repeat";
import { applyToUpcoming, changesShared, endSeriesBefore, setRepeat, topUpRepeats, upcomingOf } from "@/store/repeat";
import { newTask, useWorkspace } from "@/store/workspace";
import { addDays } from "../time";

vi.mock("@/ui/toast", () => ({ toast: vi.fn() }));

const d = (s: string) => new Date(`${s}T00:00:00`);
const days = (rule: RepeatRule, from: string, to: string) => repeatDays(rule, d(from), d(to)).map(dayString);

afterEach(() => {
  vi.useRealTimers();
  useWorkspace.setState({ user: null, tasks: [], side: {} });
});

it("finds a rule's days", () => {
  // 2026-10-11 is a Sunday.
  const weekdays: RepeatRule = { kind: "rule", every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5], start: "2026-10-11" };
  expect(days(weekdays, "2026-10-11", "2026-10-18")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  const fortnightly: RepeatRule = { kind: "rule", every: 2, unit: "week", start: "2026-10-11" };
  expect(days(fortnightly, "2026-10-01", "2026-11-10")).toEqual(["2026-10-11", "2026-10-25", "2026-11-08"]);
  const every3: RepeatRule = { kind: "rule", every: 3, unit: "day", start: "2026-10-11", until: "2026-10-20" };
  expect(days(every3, "2026-10-13", "2026-10-31")).toEqual(["2026-10-14", "2026-10-17", "2026-10-20"]);
  // The 31st falls on each month's last day when it's shorter, then back on the 31st.
  const monthly: RepeatRule = { kind: "rule", every: 1, unit: "month", start: "2026-01-31" };
  expect(days(monthly, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

it("describes a choice in words", () => {
  expect(describeRepeat({ kind: "rule", every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5], start: "2026-10-11" })).toBe("Every weekday");
  expect(describeRepeat({ kind: "rule", every: 2, unit: "week", weekdays: [0, 3], start: "2026-10-11", until: "2026-12-18" })).toBe("Every 2 weeks on Wed, Sun, until 18 Dec");
  expect(describeRepeat({ kind: "days", days: ["2026-10-11", "2026-10-13", "2026-10-14", "2026-10-15"] })).toBe("4 days: Sun 11 Oct, Tue 13 – Thu 15 Oct");
});

it("ignores a stored repeat that isn't valid", () => {
  expect(readRepeat({ extra: { repeat: { series: "s", rule: { kind: "rule", unit: "fortnight", start: "2026-10-11" } } } })).toBeNull();
  expect(readRepeat({ extra: { repeat: { series: "s", rev: 1, rule: { kind: "days", days: ["2026-10-12", "nope", "2026-10-11"] } } } })?.rule).toEqual({
    kind: "days",
    days: ["2026-10-11", "2026-10-12"],
  });
});

it("puts the task on each picked day and takes off the days unpicked", () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 10, 12), toFake: ["Date"] });
  const task = newTask({ title: "Revise", date: d("2026-10-11"), startTime: new Date(2026, 9, 11, 17, 30), durationMinutes: 45 });
  useWorkspace.setState({ tasks: [task] });
  // This Sunday and every day next week.
  const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
  expect(setRepeat(task.id, { kind: "days", days: ["2026-10-11", ...week] })).toEqual({ added: 7, removed: 0 });
  const tasks = useWorkspace.getState().tasks;
  expect(tasks.map((t) => dayString(t.date))).toEqual(["2026-10-11", ...week]);
  expect(tasks.every((t) => t.title === "Revise" && t.startTime?.getHours() === 17 && t.startTime.getMinutes() === 30)).toBe(true);
  expect(new Set(tasks.map((t) => readRepeat(t)?.series)).size).toBe(1);

  // Done ones stay; unpicked open ones go.
  const wednesday = tasks.find((t) => dayString(t.date) === "2026-10-14")!;
  useWorkspace.setState({ tasks: tasks.map((t) => (t.id === wednesday.id ? { ...t, isDone: true } : t)) });
  expect(setRepeat(task.id, { kind: "days", days: ["2026-10-11", "2026-10-12"] })).toEqual({ added: 0, removed: 5 });
  expect(useWorkspace.getState().tasks.map((t) => dayString(t.date))).toEqual(["2026-10-11", "2026-10-12", "2026-10-14"]);

  // Stopping removes the open ones after this task.
  expect(setRepeat(task.id, null)).toEqual({ added: 0, removed: 1 });
  expect(useWorkspace.getState().tasks.every((t) => !readRepeat(t))).toBe(true);
});

it("changes the upcoming ones too when asked", () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 10, 12), toFake: ["Date"] });
  const task = newTask({ title: "Run", date: d("2026-10-10") });
  useWorkspace.setState({ tasks: [task] });
  setRepeat(task.id, { kind: "rule", every: 1, unit: "day", start: "2026-10-10" });
  const first = useWorkspace.getState().tasks.find((t) => t.id === task.id)!;
  expect(upcomingOf(first).length).toBe(21);
  const edited = { ...first, title: "Run 5k", startTime: new Date(2026, 9, 10, 7, 0) };
  expect(changesShared(first, edited)).toBe(true);
  applyToUpcoming(edited);
  const later = upcomingOf(first);
  expect(later.every((t) => t.title === "Run 5k" && t.startTime?.getHours() === 7 && t.startTime.getDate() === t.date.getDate())).toBe(true);
});

it("tops a rule up as days pass, without bringing back a deleted day", () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 10, 12), toFake: ["Date"] });
  const task = newTask({ title: "Vocab", date: d("2026-10-10") });
  useWorkspace.setState({ tasks: [task] });
  setRepeat(task.id, { kind: "rule", every: 1, unit: "day", start: "2026-10-10" });
  const before = useWorkspace.getState().tasks.length;
  expect(before).toBe(22);
  // Nothing to do while the series still reaches far enough ahead.
  topUpRepeats(d("2026-10-12"));
  expect(useWorkspace.getState().tasks.length).toBe(before);
  // Two weeks on (the last one under a week away), the series is extended to three weeks ahead again.
  const last = useWorkspace.getState().tasks.at(-1)!;
  useWorkspace.setState({ side: { [`settings:trash:task:${last.id.replace(/\d{8}$/, "20261103")}`]: "{}" } });
  topUpRepeats(d("2026-10-25"));
  const after = useWorkspace.getState().tasks.map((t) => dayString(t.date));
  expect(after.at(-1)).toBe("2026-11-15");
  expect(after).not.toContain("2026-11-03");
  // Running it again adds nothing more.
  const count = after.length;
  topUpRepeats(d("2026-10-25"));
  expect(useWorkspace.getState().tasks.length).toBe(count);
});

it("stays ended after deleting a day and the ones after it", () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 10, 12), toFake: ["Date"] });
  const task = newTask({ title: "Vocab", date: d("2026-10-10") });
  useWorkspace.setState({ tasks: [task] });
  setRepeat(task.id, { kind: "rule", every: 1, unit: "day", start: "2026-10-10" });
  // "Delete this and upcoming" on the 14th: those tasks go, and the series ends on the 13th.
  const from = useWorkspace.getState().tasks.find((t) => dayString(t.date) === "2026-10-14")!;
  const gone = [from, ...upcomingOf(from)].map((t) => t.id);
  const undo = endSeriesBefore(from);
  useWorkspace.setState((st) => ({ tasks: st.tasks.filter((t) => !gone.includes(t.id)) }));
  topUpRepeats(d("2026-10-12"));
  topUpRepeats(d("2026-11-20"));
  expect(useWorkspace.getState().tasks.map((t) => dayString(t.date)).at(-1)).toBe("2026-10-13");
  // Undo gives the series its open end back.
  undo();
  expect(readRepeat(useWorkspace.getState().tasks[0])?.rule).not.toHaveProperty("until", "2026-10-13");
});

it("keeps a change to the last task on that task alone when topping up", () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 10, 12), toFake: ["Date"] });
  const task = newTask({ title: "Run", date: d("2026-10-10") });
  useWorkspace.setState({ tasks: [task] });
  setRepeat(task.id, { kind: "rule", every: 1, unit: "day", start: "2026-10-10" });
  const byDate = () => [...useWorkspace.getState().tasks].sort((a, b) => a.date.getTime() - b.date.getTime());
  // "Only this one" on the last day made so far.
  const last = byDate().at(-1)!;
  useWorkspace.setState((st) => ({ tasks: st.tasks.map((t) => (t.id === last.id ? { ...t, title: "Long run" } : t)) }));
  topUpRepeats(addDays(last.date, -1));
  const after = byDate().filter((t) => t.date > last.date);
  expect(after.length).toBeGreaterThan(0);
  expect(after.every((t) => t.title === "Run")).toBe(true);
  // "This and upcoming" changes the days still to be made too.
  const first = byDate()[0];
  applyToUpcoming({ ...first, title: "Easy run" });
  const end = byDate().at(-1)!;
  topUpRepeats(addDays(end.date, -1));
  expect(byDate().filter((t) => t.date > end.date).every((t) => t.title === "Easy run")).toBe(true);
});

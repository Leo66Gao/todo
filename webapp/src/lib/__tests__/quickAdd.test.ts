import { expect, it } from "vitest";
import { parseQuickAdd } from "../quickAdd";

// Saturday 26 September 2026, mid-afternoon.
const now = new Date(2026, 8, 26, 15, 0);
const projects = [
  { id: "phys", title: "Physics HL" },
  { id: "math", title: "Maths AA" },
  { id: "eng", title: "English Lit" },
];
const parse = (text: string) => parseQuickAdd(text, { now, projects });
const day = (d: Date | undefined) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

it("reads a day, a time and how long", () => {
  const r = parse("physics IA draft fri 3pm 2h");
  expect(r.title).toBe("physics IA draft");
  expect(day(r.date)).toBe("2026-10-2");
  expect(r.time).toEqual({ hour: 15, minute: 0 });
  expect(r.minutes).toBe(120);
  expect(r.projectId).toBe("phys");
});

it("reads deadlines, relative days and dates", () => {
  const essay = parse("English essay due 12 oct");
  expect(essay).toMatchObject({ title: "English essay", due: true, projectId: "eng" });
  expect(day(essay.date)).toBe("2026-10-12");
  expect(day(parse("call gran tomorrow at 7").date)).toBe("2026-9-27");
  expect(parse("call gran tomorrow at 7").time).toEqual({ hour: 7, minute: 0 });
  expect(day(parse("revise in 3 days").date)).toBe("2026-9-29");
  expect(day(parse("mock exam next monday").date)).toBe("2026-10-5");
  expect(day(parse("hand in 3/10").date)).toBe("2026-10-3");
  expect(day(parse("lab report oct 1st").date)).toBe("2026-10-1");
  // Already past this year: next year.
  expect(day(parse("renew passport 1 jan").date)).toBe("2027-1-1");
});

it("reads subjects, priorities and durations", () => {
  const r = parse("problem set #maths !! 45 min");
  expect(r).toMatchObject({ title: "problem set", projectId: "math", priority: "high", minutes: 45 });
  expect(parse("reading for 1.5 hours").minutes).toBe(90);
  expect(parse("reading 1h30").minutes).toBe(90);
  expect(parse("gym 18.30").time).toEqual({ hour: 18, minute: 30 });
  // The phone app's rule: a bare hour at the end.
  expect(parse("gym 18")).toMatchObject({ title: "gym", time: { hour: 18, minute: 0 } });
});

it("leaves ordinary words alone", () => {
  expect(parse("SAT prep").date).toBeUndefined();
  expect(parse("May the force").date).toBeUndefined();
  expect(parse("Read chapter 12 of Macbeth")).toMatchObject({ title: "Read chapter 12 of Macbeth" });
  expect(parse("Revise physics ch 3").time).toBeUndefined();
  expect(parse("Maths exercise 12").time).toBeUndefined();
  expect(parse("Gym 18").time).toEqual({ hour: 18, minute: 0 });
  expect(parse("Buy 2 notebooks").minutes).toBeUndefined();
  expect(parse("Mark answers").date).toBeUndefined();
});

it("skips what it's told to ignore", () => {
  const r = parseQuickAdd("gym tomorrow 18", { now, projects, ignore: ["time"] });
  expect(r.title).toBe("gym 18");
  expect(r.time).toBeUndefined();
  expect(day(r.date)).toBe("2026-9-27");
});

it("reads time ranges as a start and a length", () => {
  const r = parse("physics review fri 18-20 urgent");
  expect(r).toMatchObject({ title: "physics review", projectId: "phys", time: { hour: 18, minute: 0 }, minutes: 120, priority: "critical" });
  expect(day(r.date)).toBe("2026-10-2");
  expect(parse("essay 6-8pm")).toMatchObject({ title: "essay", time: { hour: 18, minute: 0 }, minutes: 120 });
  expect(parse("lab 9.15–10.45")).toMatchObject({ title: "lab", time: { hour: 9, minute: 15 }, minutes: 90 });
  expect(parse("revise from 4 to 5:30pm")).toMatchObject({ title: "revise", time: { hour: 16, minute: 0 }, minutes: 90 });
  // A set length wins over the range's.
  expect(parse("run 7-9 1h").minutes).toBe(60);
  // Ranges of other things stay in the title.
  expect(parse("read pages 12-14")).toMatchObject({ title: "read pages 12-14" });
  expect(parse("questions 3-7 tomorrow").time).toBeUndefined();
});

it("reads priority in words", () => {
  expect(parse("tok essay high priority").priority).toBe("high");
  expect(parse("tok essay high priority").title).toBe("tok essay");
  expect(parse("call school asap").priority).toBe("high");
  expect(parse("chem lab write-up critical")).toMatchObject({ title: "chem lab write-up", priority: "critical" });
  expect(parse("critical thinking essay").priority).toBeUndefined();
  expect(parse("low prio: tidy desk").priority).toBe("low");
});

it("reads section and exercise numbers as numbers, not times", () => {
  for (const text of ["Read section 2.30", "Do exercises 1.10 to 1.20", "Maths 3.1-3.4"]) {
    const r = parse(text);
    expect(r.title).toBe(text);
    expect(r.time).toBeUndefined();
    expect(r.minutes).toBeUndefined();
  }
  expect(parse("Read pages 12-14").time).toBeUndefined();
});

it("still reads times that can only be hours", () => {
  expect(parse("Physics lab 14.00-16.00")).toMatchObject({ time: { hour: 14, minute: 0 }, minutes: 120 });
  expect(parse("Gym 18.30").time).toEqual({ hour: 18, minute: 30 });
  expect(parse("Run at 5.30").time).toEqual({ hour: 5, minute: 30 });
  expect(parse("Run 5.30am").time).toEqual({ hour: 5, minute: 30 });
  expect(parse("physics review fri 18-20").minutes).toBe(120);
});

it("reads 'this' and a bare weekday on that day like the AI does", () => {
  // `now` is a Saturday.
  expect(day(parse("brunch this sat").date)).toBe("2026-9-26");
  expect(day(parse("brunch sat").date)).toBe("2026-10-3");
  expect(day(parse("brunch next sat").date)).toBe("2026-10-3");
});

import { expect, it } from "vitest";
import { lastStepDay, readSteps, workBackMessages } from "../workBack";

const today = new Date(2026, 8, 27);
const deadline = new Date(2026, 9, 9);

it("asks with the deadline, the free days and what exists", () => {
  const [, user] = workBackMessages({
    title: "Physics IA",
    subject: "Physics HL",
    deadline,
    today,
    minutes: 600,
    existing: ["Collect data"],
    load: new Map([[new Date(2026, 8, 28).getTime(), 4]]),
  });
  expect(user.content).toContain("Deadline: 2026-10-09 (Friday)");
  expect(user.content).toContain("2026-09-28 Mon: 4");
  expect(user.content).toContain("- Collect data");
  expect(user.content).toContain("Dates from 2026-09-27 to 2026-10-08");
});

it("keeps the answer's steps within range and in order", () => {
  const steps = readSteps(
    {
      steps: [
        { title: "Write the conclusion.", date: "2026-10-20", minutes: 90 },
        { title: "Plan the method", date: "2026-09-20" },
        { title: "", date: "2026-10-01" },
        { title: "Analyse the data", date: "not a date", minutes: -5 },
      ],
    },
    deadline,
    today,
  );
  expect(steps.map((s) => [s.title, s.date.getDate(), s.minutes])).toEqual([
    ["Plan the method", 27, undefined],
    ["Write the conclusion", 8, 90],
    ["Analyse the data", 8, undefined],
  ]);
  expect(readSteps({ nope: true }, deadline, today)).toEqual([]);
  // Due tomorrow or today: steps go on today.
  expect(lastStepDay(new Date(2026, 8, 27), today)).toEqual(today);
});

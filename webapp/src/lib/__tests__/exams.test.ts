import { expect, it } from "vitest";
import { decodeProject, encodeProject } from "@/lib/model";
import { newTask } from "@/store/workspace";
import { examIn, examLabel, reviewDays, upcomingExams } from "@/features/subjects/exams";

// Friday 2 October 2026, evening.
const now = new Date(2026, 9, 2, 19, 0);
const chem = { id: "c", title: "Chemistry", colorValue: 1, examDate: "2026-10-14" };
const day = (d: Date) => `${d.getMonth() + 1}-${d.getDate()}`;

it("counts days to the exam by calendar day", () => {
  expect(examIn(chem, now)).toBe(12);
  expect(examLabel(12)).toBe("Exam in 12 days");
  expect(examLabel(1)).toBe("Exam tomorrow");
  expect(examLabel(0)).toBe("Exam today");
  expect(examLabel(-2)).toBeNull();
  expect(examIn({ examDate: undefined }, now)).toBeNull();
});

it("lists exams coming up, soonest first", () => {
  const bio = { id: "b", title: "Biology", colorValue: 1, examDate: "2026-10-05" };
  const past = { id: "p", title: "Past", colorValue: 1, examDate: "2026-09-30" };
  const far = { id: "f", title: "Far", colorValue: 1, examDate: "2026-12-01" };
  expect(upcomingExams([chem, past, far, bio], 14, now).map((e) => e.project.id)).toEqual(["b", "c"]);
});

it("spreads reviews before the exam, skipping past days and days already planned", () => {
  const planned = newTask({ title: "Chemistry review", date: new Date(2026, 9, 8), projectId: "c" });
  expect(reviewDays(chem, [], now).map(day)).toEqual(["10-4", "10-8", "10-11", "10-13"]);
  expect(reviewDays(chem, [planned], now).map(day)).toEqual(["10-4", "10-11", "10-13"]);
});

it("keeps the exam date through sync encoding", () => {
  expect(decodeProject(encodeProject(chem)).examDate).toBe("2026-10-14");
  expect("examDate" in encodeProject({ id: "x", title: "X", colorValue: 1 })).toBe(false);
  expect(decodeProject({ id: "x", title: "X", colorValue: 1, examDate: "soon" }).examDate).toBeUndefined();
});

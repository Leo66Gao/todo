import { describe, expect, it } from "vitest";
import { decodeTask } from "@/lib/model";
import { gapLabel, upcomingRows } from "@/lib/upcoming";

const task = (id: string, date: Date, extra: Record<string, unknown> = {}) =>
  decodeTask({ id, title: id, date: date.toISOString(), ...extra });

describe("upcoming list", () => {
  const from = new Date(2026, 8, 27);
  it("groups days from today on and folds empty stretches", () => {
    const rows = upcomingRows(
      [
        task("past", new Date(2026, 8, 20)),
        task("a", new Date(2026, 8, 27, 12)),
        task("b", new Date(2026, 8, 28)),
        task("c", new Date(2026, 9, 3)),
      ],
      from,
    );
    expect(rows.map((r) => (r.kind === "day" ? r.tasks.map((t) => t.id).join() : gapLabel(r.from, r.to)))).toEqual([
      "a",
      "b",
      "29 Sep – 2 Oct",
      "c",
    ]);
  });

  it("puts timed tasks first and done ones last", () => {
    const day = new Date(2026, 8, 27);
    const rows = upcomingRows(
      [
        task("done", day, { isDone: true }),
        task("untimed", day),
        task("late", day, { startTime: new Date(2026, 8, 27, 15).toISOString() }),
        task("early", day, { startTime: new Date(2026, 8, 27, 9).toISOString() }),
      ],
      from,
    );
    expect(rows[0].kind === "day" && rows[0].tasks.map((t) => t.id)).toEqual(["early", "late", "untimed", "done"]);
  });

  it("labels one free day and ranges", () => {
    expect(gapLabel(new Date(2026, 9, 5), new Date(2026, 9, 5))).toBe("5 Oct");
    expect(gapLabel(new Date(2026, 9, 3), new Date(2026, 9, 9))).toBe("3 – 9 Oct");
  });
});

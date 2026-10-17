import { describe, expect, it } from "vitest";
import { rollOver } from "@/shell/ui";

const d = (day: number) => new Date(2026, 9, day);

describe("rollOver", () => {
  it("does nothing on the same day", () => {
    expect(rollOver({ today: d(16), day: d(16), weekOf: d(16), calendarDay: d(16) }, d(16))).toBeNull();
  });

  it("moves views that showed the old today onto the new one", () => {
    expect(rollOver({ today: d(16), day: d(16), weekOf: d(16), calendarDay: d(16) }, d(17))).toEqual({
      today: d(17),
      day: d(17),
      weekOf: d(17),
      calendarDay: d(17),
    });
  });

  it("leaves views that were on another day where they are", () => {
    expect(rollOver({ today: d(16), day: d(20), weekOf: d(9), calendarDay: d(16) }, d(17))).toEqual({
      today: d(17),
      day: d(20),
      weekOf: d(9),
      calendarDay: d(17),
    });
  });
});

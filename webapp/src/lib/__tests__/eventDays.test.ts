import { expect, it } from "vitest";
import { eventTimeLabel } from "@/features/events/EventSheet";
import { decodeEvent } from "@/lib/googleEvents";

// Days are counted by the calendar, not 24 hours: the day the clocks go
// forward is 23 hours long.
process.env.TZ = "Europe/Helsinki";

it("labels all-day events right across the clock change", () => {
  const calendar = { id: "c" } as never;
  const one = decodeEvent({ id: "1", start: { date: "2027-03-28" }, end: { date: "2027-03-29" } } as never, calendar)!;
  const two = decodeEvent({ id: "2", start: { date: "2027-03-27" }, end: { date: "2027-03-29" } } as never, calendar)!;
  const noEnd = decodeEvent({ id: "3", start: { date: "2027-03-28" } } as never, calendar)!;
  expect(eventTimeLabel(one)).toBe("All day");
  expect(eventTimeLabel(two)).toBe("27 Mar – 28 Mar");
  expect(noEnd.end.getDate()).toBe(29);
});

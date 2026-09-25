import { describe, expect, it } from "vitest";
import { argbToCss, decodePriority, hexToArgb, parseDartDate, toDartIso } from "@/lib/dart";

describe("Dart dates", () => {
  it("writes local time without an offset", () => {
    expect(toDartIso(new Date(2026, 8, 5, 7, 3, 9, 42))).toBe("2026-09-05T07:03:09.042");
  });

  it("reads local, UTC and microsecond forms", () => {
    expect(parseDartDate("2026-09-05T07:03:09.042")?.getTime()).toBe(new Date(2026, 8, 5, 7, 3, 9, 42).getTime());
    expect(parseDartDate("2026-09-05")?.getTime()).toBe(new Date(2026, 8, 5).getTime());
    expect(parseDartDate("2026-09-05T07:03:09.042123")?.getMilliseconds()).toBe(42);
    expect(parseDartDate("2026-09-05T07:03:09.000Z")?.toISOString()).toBe("2026-09-05T07:03:09.000Z");
    expect(parseDartDate("nope")).toBeNull();
    expect(parseDartDate(null)).toBeNull();
  });
});

describe("enums and colours", () => {
  it("decodes priorities", () => {
    expect(decodePriority("TaskPriority.critical")).toBe("critical");
    expect(decodePriority("TaskPriority.unknown")).toBeNull();
  });

  it("converts ARGB ints", () => {
    const argb = hexToArgb("#2f5fd0");
    expect(argb).toBe(0xff2f5fd0);
    expect(argbToCss(argb)).toBe("rgb(47 95 208)");
  });
});

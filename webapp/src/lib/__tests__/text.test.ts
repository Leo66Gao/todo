import { describe, expect, it } from "vitest";
import { deltaFromContent, isEmptyContent, plainText, safeLink, withAutoLinks } from "@/lib/delta";
import { parseTimeFromTitle, parseTimeToken } from "@/lib/timeParse";

describe("time entry", () => {
  it.each([
    ["16", { hour: 16, minute: 0 }],
    ["18.30", { hour: 18, minute: 30 }],
    ["18:30", { hour: 18, minute: 30 }],
    ["6pm", { hour: 18, minute: 0 }],
    ["12am", { hour: 0, minute: 0 }],
    ["9.15am", { hour: 9, minute: 15 }],
    ["1530", { hour: 15, minute: 30 }],
  ])("reads %s", (input, expected) => {
    expect(parseTimeToken(input)).toEqual(expected);
  });

  it.each(["25", "13pm", "9.75", "noon"])("rejects %s", (input) => {
    expect(parseTimeToken(input)).toBeNull();
  });

  it("splits a trailing time off a title", () => {
    expect(parseTimeFromTitle("Gym 18.30")).toEqual({ title: "Gym", time: { hour: 18, minute: 30 } });
    expect(parseTimeFromTitle("Physics past paper 2 17")).toEqual({
      title: "Physics past paper 2",
      time: { hour: 17, minute: 0 },
    });
    expect(parseTimeFromTitle("18.30")).toEqual({ title: "18.30", time: null });
    expect(parseTimeFromTitle("Read chapter 40")).toEqual({ title: "Read chapter 40", time: null });
  });
});

describe("note content", () => {
  it("reads plain text from deltas and Markdown", () => {
    expect(plainText(JSON.stringify([{ insert: "Hello\n" }, { insert: "world\n" }]))).toBe("Hello world");
    expect(plainText("# Title\n- [x] **done** [link](https://a.b)")).toBe("Title done link");
    expect(isEmptyContent(JSON.stringify([{ insert: "\n" }]))).toBe(true);
    expect(isEmptyContent("")).toBe(true);
  });

  it("links bare URLs", () => {
    expect(withAutoLinks([{ insert: "see example.com now" }])).toEqual([
      { insert: "see " },
      { insert: "example.com", attributes: { link: "https://example.com" } },
      { insert: " now" },
    ]);
  });

  it("only opens web and mail links", () => {
    expect(safeLink("https://example.com")).toBe("https://example.com/");
    expect(safeLink("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeLink("javascript:alert(1)")).toBeNull();
  });
});

describe("legacy note text", () => {
  it("shows old Markdown notes formatted", () => {
    const ops = deltaFromContent("# Plan\n- **one**\n- two");
    expect(ops).toContainEqual({ insert: "one", attributes: { bold: true } });
    expect(ops.some((op) => (op.attributes as Record<string, unknown> | undefined)?.header === 1)).toBe(true);
    expect(ops.some((op) => (op.attributes as Record<string, unknown> | undefined)?.list === "bullet")).toBe(true);
  });

  it("keeps plain text as it is", () => {
    expect(deltaFromContent("Buy milk")).toEqual([{ insert: "Buy milk\n" }]);
  });
});

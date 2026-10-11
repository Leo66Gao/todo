import { expect, it } from "vitest";
import { markdownLines, sectionAt, toMarkdown } from "@/lib/noteMarkdown";
import { DISPLAY } from "@/lib/markdownPaste";

const ops = [
  { insert: "Waves" },
  { insert: "\n", attributes: { header: 1 } },
  { insert: "Speed " },
  { insert: "v", attributes: { bold: true } },
  { insert: " is " },
  { insert: { formula: "f\\lambda" } },
  { insert: "\n" },
  { insert: "Types" },
  { insert: "\n", attributes: { header: 2 } },
  { insert: "transverse" },
  { insert: "\n", attributes: { list: "ordered" } },
  { insert: "longitudinal" },
  { insert: "\n", attributes: { list: "ordered" } },
  { insert: "revise" },
  { insert: "\n", attributes: { list: "unchecked" } },
  { insert: "Sound" },
  { insert: "\n", attributes: { header: 2 } },
  { insert: { formula: `${DISPLAY}v = 343` } },
  { insert: "\n" },
];

it("writes a note as Markdown that keeps its structure", () => {
  expect(toMarkdown(markdownLines(ops))).toBe(
    ["# Waves", "Speed **v** is $f\\lambda$", "## Types", "1. transverse", "2. longitudinal", "- [ ] revise", "## Sound", "$$v = 343$$"].join("\n"),
  );
});

it("finds the section the cursor is in", () => {
  const lines = markdownLines(ops);
  const types = lines.find((l) => l.md === "1. transverse")!;
  const section = sectionAt(lines, types.start + 2)!;
  expect(section.title).toBe("Types");
  expect(section.lines.map((l) => l.md)).toEqual(["## Types", "1. transverse", "2. longitudinal", "- [ ] revise"]);
  // Under the top heading, its section runs to the end.
  expect(sectionAt(lines, 2)!.lines).toHaveLength(lines.length);
  expect(sectionAt(markdownLines([{ insert: "no headings\n" }]), 0)).toBeNull();
});

import { expect, it } from "vitest";
import { DISPLAY, inlineOps, looksLikeMarkdown, markdownToDelta } from "../markdownPaste";

it("turns a typical chat answer into rich text with formulas", () => {
  const md = [
    "## Kinematics",
    "",
    "The **displacement** is $s = ut + \\tfrac{1}{2}at^2$, so:",
    "",
    "$$",
    "v^2 = u^2 + 2as",
    "$$",
    "",
    "- Use *SI units*",
    "- [ ] Check signs",
    "1. Draw a diagram",
    "> Energy is conserved.",
    "```",
    "print(9.81)",
    "```",
  ].join("\n");
  const ops = markdownToDelta(md);
  expect(ops).toContainEqual({ insert: "\n", attributes: { header: 2 } });
  expect(ops).toContainEqual({ insert: "displacement", attributes: { bold: true } });
  expect(ops).toContainEqual({ insert: { formula: "s = ut + \\tfrac{1}{2}at^2" } });
  expect(ops).toContainEqual({ insert: { formula: `${DISPLAY}v^2 = u^2 + 2as` } });
  expect(ops).toContainEqual({ insert: "SI units", attributes: { italic: true } });
  expect(ops).toContainEqual({ insert: "\n", attributes: { list: "unchecked" } });
  expect(ops).toContainEqual({ insert: "\n", attributes: { list: "ordered" } });
  expect(ops).toContainEqual({ insert: "\n", attributes: { blockquote: true } });
  expect(ops).toContainEqual({ insert: "print(9.81)" });
  expect(ops).toContainEqual({ insert: "\n", attributes: { "code-block": true } });
});

it("reads \\( \\) and \\[ \\] maths too", () => {
  expect(inlineOps("where \\(F = ma\\) holds")).toEqual([{ insert: "where " }, { insert: { formula: "F = ma" } }, { insert: " holds" }]);
  expect(markdownToDelta("\\[\\int_0^1 x\\,dx\\]")).toEqual([{ insert: { formula: `${DISPLAY}\\int_0^1 x\\,dx` } }, { insert: "\n" }]);
});

it("leaves prices and ordinary text alone", () => {
  expect(inlineOps("It costs $5 and $10 today")).toEqual([{ insert: "It costs $5 and $10 today" }]);
  expect(looksLikeMarkdown("Just a normal sentence.")).toBe(false);
  expect(looksLikeMarkdown("Energy is $E = mc^2$.")).toBe(true);
  expect(looksLikeMarkdown("# Notes\n- one")).toBe(true);
});

it("keeps links and nested emphasis", () => {
  expect(inlineOps("see [the docs](https://example.com) and **very *important***")).toEqual([
    { insert: "see " },
    { insert: "the docs", attributes: { link: "https://example.com" } },
    { insert: " and " },
    { insert: "very ", attributes: { bold: true } },
    { insert: "important", attributes: { bold: true, italic: true } },
  ]);
});

it("keeps paragraph breaks but not the ones around headings and display maths", () => {
  const ops = markdownToDelta("One\n\n\nTwo\n\n## Head\n\nThree\n\n$$x$$\n\nFour\n");
  const text = ops.map((o) => (typeof o.insert === "string" ? o.insert : "[f]")).join("");
  expect(text).toBe("One\n\nTwo\nHead\nThree\n[f]\nFour\n");
});

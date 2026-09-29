import { expect, it } from "vitest";
import { DISPLAY, inlineOps, looksLikeMarkdown, markdownToDelta, shouldParseMarkdownPaste } from "../markdownPaste";

it("formats an AI study list pasted with both Markdown text and rich clipboard HTML", () => {
  const text = [
    "**Derivative meaning + power rule**",
    "",
    "1. **Chain rule**",
    "2. **Product + quotient**",
    "3. **\\(e^x,\\ln x,\\sin x,\\cos x\\)**",
    "4. **Tangents/normals**",
    "5. **Stationary points +\u00a0\\(f''\\)**",
    "6. **Optimisation**",
    "7. **Basic integration**",
    "8. **Definite integrals + areas**",
    "9. **Kinematics**",
  ].join("\n");
  expect(shouldParseMarkdownPaste(text, "<p><strong>Derivative meaning + power rule</strong></p><ol><li>Chain rule</li></ol>"))
    .toBe(true);
  const ops = markdownToDelta(text);
  expect(ops).toContainEqual({ insert: "Derivative meaning + power rule", attributes: { bold: true } });
  expect(ops).toContainEqual({ insert: "Chain rule", attributes: { bold: true } });
  expect(ops).toContainEqual({ insert: { formula: "e^x,\\ln x,\\sin x,\\cos x" }, attributes: { bold: true } });
  expect(ops).toContainEqual({ insert: { formula: "f''" }, attributes: { bold: true } });
  expect(ops.filter((op) => op.attributes?.list === "ordered")).toHaveLength(9);
  expect(ops.some((op) => typeof op.insert === "string" && op.insert.includes("**"))).toBe(false);
});

it("keeps already rendered rich HTML when its plain text has no Markdown delimiters", () => {
  expect(shouldParseMarkdownPaste("1. Chain rule", "<ol><li><strong>Chain rule</strong></li></ol>")).toBe(false);
  expect(shouldParseMarkdownPaste("1. **Chain rule**", "<ol><li><strong>Chain rule</strong></li></ol>")).toBe(true);
  expect(shouldParseMarkdownPaste("*important*", "<p><em>important</em></p>")).toBe(true);
  expect(shouldParseMarkdownPaste("# Heading", "<h1># Heading</h1>")).toBe(true);
  expect(shouldParseMarkdownPaste("ordinary text", "<p>ordinary text</p>")).toBe(false);
});

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

import { expect, it } from "vitest";
import { deltaLines, deltaToHtml } from "../deltaHtml";
import { markdownToDelta } from "../markdownPaste";

const opts = { formula: (tex: string, display: boolean) => `[${display ? "D" : "I"}:${tex}]` };

it("renders blocks, lists and formulas as clean HTML", () => {
  const ops = markdownToDelta(
    ["# Title", "Some **bold** and <b>not html</b> with $x^2$", "- one", "  - nested", "1. first", "- [x] done", "> quote", "$$E=mc^2$$", "```", "a < b", "c", "```", "[link](https://example.com) and [bad](javascript:alert(1))"].join("\n"),
  );
  const html = deltaToHtml(ops, opts);
  expect(html).toContain("<h1>Title</h1>");
  expect(html).toContain("<strong>bold</strong> and &lt;b&gt;not html&lt;/b&gt; with [I:x^2]");
  expect(html).toContain("<ul>\n<li>one</li>\n<ul>\n<li>nested</li>\n</ul>\n</ul>\n<ol>\n<li>first</li>\n</ol>");
  expect(html).toContain('<ul class="checklist">\n<li class="done">☑ done</li>\n</ul>');
  expect(html).toContain("<blockquote>quote</blockquote>");
  expect(html).toContain('<div class="math">[D:E=mc^2]</div>');
  expect(html).toContain("<pre><code>a &lt; b\nc</code></pre>");
  expect(html).toContain('<a href="https://example.com/">link</a>');
  expect(html).not.toContain('href="javascript');
});

it("splits text into lines with their block formats", () => {
  const lines = deltaLines([{ insert: "a\nb" }, { insert: "\n", attributes: { header: 1 } }, { insert: "c\n" }]);
  expect(lines.map((l) => [l.segments.map((s) => s.text).join(""), l.attrs.header ?? null])).toEqual([
    ["a", null],
    ["b", 1],
    ["c", null],
  ]);
});

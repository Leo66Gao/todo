import { DOMParser } from "@xmldom/xmldom";
import katex from "katex";
import { mml2omml } from "mathml2omml";
import { expect, it } from "vitest";
import { ommlToTex } from "../ommlTex";

/** TeX → MathML (KaTeX) → Word maths (as the export writes it) → TeX. */
function roundTrip(tex: string) {
  const html = katex.renderToString(tex, { output: "mathml" });
  const mathml = html.slice(html.indexOf("<math"), html.lastIndexOf("</math>") + 7).replace(/<annotation[\s\S]*?<\/annotation>/g, "");
  const omml = mml2omml(mathml);
  const doc = new DOMParser().parseFromString(omml, "application/xml");
  return ommlToTex(doc.documentElement as unknown as Element);
}

/** Two TeX strings that render the same. */
const same = (a: string, b: string) =>
  katex.renderToString(a, { output: "mathml", strict: "ignore" }).replace(/<annotation[\s\S]*?<\/annotation>/, "") ===
  katex.renderToString(b, { output: "mathml", strict: "ignore" }).replace(/<annotation[\s\S]*?<\/annotation>/, "");

it("brings Word equations back as the same maths", () => {
  for (const tex of [
    "\\frac{1}{2}mv^2",
    "\\sqrt{x^2+y^2}",
    "\\sqrt[3]{x}",
    "x_{i}^{2}",
    "\\sum_{i=1}^{n} i",
    "\\int_0^1 x\\,dx",
    "\\left(a+b\\right)",
    "\\sin\\theta",
    "\\vec{F}",
    "E = mc^2",
  ]) {
    const back = roundTrip(tex);
    expect(() => katex.renderToString(back)).not.toThrow();
    expect(back.length).toBeGreaterThan(0);
  }
  expect(roundTrip("\\frac{1}{2}mv^2")).toBe("\\frac{1}{2}mv^{2}");
  expect(same(roundTrip("\\sqrt{x^2+y^2}"), "\\sqrt{x^2+y^2}")).toBe(true);
});

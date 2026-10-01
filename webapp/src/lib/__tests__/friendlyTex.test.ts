import { expect, it } from "vitest";
import { friendlyFromTex, friendlyTex } from "../friendlyTex";

it("turns everyday maths into TeX", () => {
  expect(friendlyTex("sqrt(x^2 + y^2)")).toBe("\\sqrt{x^2 + y^2}");
  expect(friendlyTex("1/2 m v^2")).toBe("\\frac{1}{2} m v^2");
  expect(friendlyTex("(a+b)/(c-d)")).toBe("\\frac{a+b}{c-d}");
  expect(friendlyTex("x >= 2 pi")).toBe("x \\ge 2 \\pi");
  expect(friendlyTex("F = m * a")).toBe("F = m \\cdot a");
  expect(friendlyTex("theta -> 0")).toBe("\\theta \\to 0");
  expect(friendlyTex("x^10")).toBe("x^{10}");
  expect(friendlyTex("30 deg")).toBe("30 ^\\circ");
});

it("leaves real TeX alone", () => {
  expect(friendlyTex("\\frac{1}{2}mv^2")).toBe("\\frac{1}{2}mv^2");
  expect(friendlyTex("\\int_0^1 x\\,dx")).toBe("\\int_0^1 x\\,dx");
  expect(friendlyTex("\\sin\\theta")).toBe("\\sin\\theta");
  expect(friendlyTex("\\text{mass}")).toBe("\\text{mass}");
});

it("shows a formula in everyday spelling when that round-trips", () => {
  for (const typed of ["1/2 m v^2", "sqrt(x^2 + y^2)", "x >= 2 pi", "F = m * a", "(a+b)/(c-d)", "theta -> 0", "x^10"]) {
    const tex = friendlyTex(typed);
    expect(friendlyTex(friendlyFromTex(tex))).toBe(tex);
    expect(friendlyFromTex(tex)).not.toContain("\\");
  }
  // TeX with no everyday spelling stays TeX.
  expect(friendlyFromTex("\\int_0^1 x\\,dx")).toBe("\\int_0^1 x\\,dx");
  expect(friendlyFromTex("\\begin{pmatrix}1\\\\2\\end{pmatrix}")).toBe("\\begin{pmatrix}1\\\\2\\end{pmatrix}");
});

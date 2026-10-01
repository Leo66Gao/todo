// Word equations (Office Math, OMML) to TeX, for importing Word documents.
// Covers what school maths and science use: fractions, powers and indices,
// roots, sums and integrals, brackets, functions, accents and matrices.

const ESCAPES: Record<string, string> = {
  "\\": "\\backslash ",
  "{": "\\{",
  "}": "\\}",
  "#": "\\#",
  "%": "\\%",
  "&": "\\&",
  $: "\\$",
  _: "\\_",
  "^": "\\hat{}",
  "~": "\\sim ",
  "−": "-",
  "·": "\\cdot ",
  "⋅": "\\cdot ",
  "×": "\\times ",
  "÷": "\\div ",
  "∞": "\\infty ",
  "→": "\\to ",
  "≤": "\\le ",
  "≥": "\\ge ",
  "≠": "\\ne ",
  "≈": "\\approx ",
  "±": "\\pm ",
  "∂": "\\partial ",
  "∇": "\\nabla ",
};

const NARY: Record<string, string> = {
  "∑": "\\sum",
  "∏": "\\prod",
  "∫": "\\int",
  "∬": "\\iint",
  "∭": "\\iiint",
  "∮": "\\oint",
  "⋃": "\\bigcup",
  "⋂": "\\bigcap",
};

const ACCENTS: Record<string, string> = {
  "̂": "\\hat",
  "̃": "\\tilde",
  "̇": "\\dot",
  "̈": "\\ddot",
  "⃗": "\\vec",
  "→": "\\vec",
  "̄": "\\bar",
  "̅": "\\bar",
  "̌": "\\check",
  "̆": "\\breve",
};

const DELIMITERS: Record<string, string> = {
  "": ".",
  "{": "\\{",
  "}": "\\}",
  "‖": "\\|",
  "⟨": "\\langle",
  "⟩": "\\rangle",
  "⌊": "\\lfloor",
  "⌋": "\\rfloor",
  "⌈": "\\lceil",
  "⌉": "\\rceil",
};

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "deg", "arg",
]);

const elements = (el: Element) => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
const child = (el: Element, name: string) => elements(el).find((c) => c.localName === name);
const prop = (el: Element, pr: string, name: string): string | null => {
  const node = child(el, pr) && child(child(el, pr)!, name);
  if (!node) return null;
  return node.getAttribute("m:val") ?? node.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/math", "val") ?? "";
};
const on = (value: string | null) => value != null && value !== "0" && value !== "off" && value !== "false";

/** Text in an equation; function names ("sin", "lim") become their commands. */
function escapeText(text: string) {
  // A name before the function-application mark is a function: "sin⁡x".
  const parts = text.split(/([A-Za-z]+)\u2061/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return FUNCTIONS.has(part) ? `\\${part} ` : `\\operatorname{${part}} `;
      // Drop the other invisible operators (invisible times, separator, plus).
      const clean = part.replace(/[\u2061-\u2064]/g, "");
      if (FUNCTIONS.has(clean.trim())) return `\\${clean.trim()} `;
      return Array.from(clean)
        .map((ch) => ESCAPES[ch] ?? ch)
        .join("");
    })
    .join("");
}
/** Braces for a base or script, unless it's one character or one command. */
const group = (tex: string) => (tex.length === 1 || /^\\[a-zA-Z]+ ?$/.test(tex) ? tex.trim() : `{${tex}}`);

/** TeX for an OMML element (m:oMath, m:oMathPara, or any part of one). */
export function ommlToTex(el: Element): string {
  const inner = (name: string) => {
    const part = child(el, name);
    return part ? ommlToTex(part).trim() : "";
  };
  switch (el.localName) {
    case "r": {
      const text = elements(el)
        .filter((c) => c.localName === "t")
        .map((c) => c.textContent ?? "")
        .join("");
      const plain = on(prop(el, "rPr", "nor"));
      return plain && text.trim() ? `\\text{${text.replace(/[{}\\]/g, "")}}` : escapeText(text);
    }
    case "f": {
      const num = inner("num");
      const den = inner("den");
      const type = prop(el, "fPr", "type");
      if (type === "lin") return `${group(num)}/${group(den)}`;
      if (type === "noBar") return `\\binom{${num}}{${den}}`;
      return `\\frac{${num}}{${den}}`;
    }
    case "sSup":
      return `${group(inner("e"))}^{${inner("sup")}}`;
    case "sSub":
      return `${group(inner("e"))}_{${inner("sub")}}`;
    case "sSubSup":
      return `${group(inner("e"))}_{${inner("sub")}}^{${inner("sup")}}`;
    case "sPre":
      return `{}_{${inner("sub")}}^{${inner("sup")}}${group(inner("e"))}`;
    case "rad": {
      const deg = inner("deg");
      return on(prop(el, "radPr", "degHide")) || !deg ? `\\sqrt{${inner("e")}}` : `\\sqrt[${deg}]{${inner("e")}}`;
    }
    case "nary": {
      const chr = prop(el, "naryPr", "chr") || "∫";
      let tex = NARY[chr] ?? escapeText(chr);
      const sub = on(prop(el, "naryPr", "subHide")) ? "" : inner("sub");
      const sup = on(prop(el, "naryPr", "supHide")) ? "" : inner("sup");
      if (sub) tex += `_{${sub}}`;
      if (sup) tex += `^{${sup}}`;
      return `${tex} ${inner("e")}`;
    }
    case "d": {
      const beg = prop(el, "dPr", "begChr") ?? "(";
      const end = prop(el, "dPr", "endChr") ?? ")";
      const sep = prop(el, "dPr", "sepChr") ?? "|";
      const parts = elements(el)
        .filter((c) => c.localName === "e")
        .map((e) => ommlToTex(e).trim());
      return `\\left${DELIMITERS[beg] ?? beg}${parts.join(sep === "|" ? " \\mid " : escapeText(sep))}\\right${DELIMITERS[end] ?? end}`;
    }
    case "func": {
      const name = inner("fName");
      const fn = /^[A-Za-z]+$/.test(name) ? `\\operatorname{${name}}` : name;
      return `${fn} ${inner("e")}`;
    }
    case "limLow":
      return `${inner("e")}_{${inner("lim")}}`;
    case "limUpp":
      return `${inner("e")}^{${inner("lim")}}`;
    case "acc": {
      const chr = prop(el, "accPr", "chr") ?? "̂";
      return `${ACCENTS[chr] ?? "\\hat"}{${inner("e")}}`;
    }
    case "bar":
      return `${prop(el, "barPr", "pos") === "top" ? "\\overline" : "\\underline"}{${inner("e")}}`;
    case "groupChr": {
      const chr = prop(el, "groupChrPr", "chr") ?? "⏟";
      return `${chr === "⏞" ? "\\overbrace" : "\\underbrace"}{${inner("e")}}`;
    }
    case "borderBox":
      return `\\boxed{${inner("e")}}`;
    case "eqArr":
      return `\\begin{aligned}${elements(el)
        .filter((c) => c.localName === "e")
        .map((e) => ommlToTex(e).trim())
        .join(" \\\\ ")}\\end{aligned}`;
    case "m":
      return `\\begin{matrix}${elements(el)
        .filter((c) => c.localName === "mr")
        .map((row) =>
          elements(row)
            .filter((c) => c.localName === "e")
            .map((e) => ommlToTex(e).trim())
            .join(" & "),
        )
        .join(" \\\\ ")}\\end{matrix}`;
    default:
      // Containers (oMath, e, num, den, sub, sup, fName, box, …): their parts
      // in order. Property elements carry no content.
      if (el.localName.endsWith("Pr")) return "";
      return elements(el)
        .map(ommlToTex)
        .join("")
        .replace(/\\([a-zA-Z]+) (?=[^a-zA-Z\u0080-\uffff])/g, "\\$1");
  }
}

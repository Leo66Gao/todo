// Maths typed the way you'd write it in a message, turned into TeX:
// "sqrt(x)", "1/2", "pi", ">=", "+-", "->", "*". Real TeX passes through.

const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "pi", "rho", "sigma", "tau", "phi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Sigma", "Phi", "Omega",
];
const WORDS: Record<string, string> = Object.fromEntries([
  ...GREEK.map((g) => [g, `\\${g}`]),
  ["inf", "\\infty"],
  ["infinity", "\\infty"],
  ["deg", "^\\circ"],
  ["sin", "\\sin"],
  ["cos", "\\cos"],
  ["tan", "\\tan"],
  ["ln", "\\ln"],
  ["log", "\\log"],
]);

/** A fraction operand: a number, a word, x^2, or a (bracketed group). */
const OPERAND = String.raw`(?:\([^()]*\)|[A-Za-z0-9.\\]+(?:\^\{?[A-Za-z0-9]+\}?)?)`;
const strip = (s: string) => (s.startsWith("(") && s.endsWith(")") ? s.slice(1, -1) : s);

export function friendlyTex(input: string): string {
  let tex = input.trim();
  // Functions first, so their brackets become braces.
  for (let i = 0; i < 3; i++) tex = tex.replace(/(?<!\\)\bsqrt\(([^()]*)\)/g, "\\sqrt{$1}");
  tex = tex.replace(new RegExp(`(${OPERAND})\\s*/\\s*(${OPERAND})`, "g"), (_, a: string, b: string) => `\\frac{${strip(a)}}{${strip(b)}}`);
  tex = tex
    .replace(/>=|≥/g, "\\ge ")
    .replace(/<=|≤/g, "\\le ")
    .replace(/!=|≠/g, "\\ne ")
    .replace(/\+-|±/g, "\\pm ")
    .replace(/->|→/g, "\\to ")
    .replace(/~=|≈/g, "\\approx ")
    .replace(/(?<![\\*])\*(?!\*)/g, "\\cdot ")
    .replace(/×/g, "\\times ")
    .replace(/(?<![\\A-Za-z])([A-Za-z]+)(?![A-Za-z])/g, (word: string) => WORDS[word] ?? word)
    // x^10 → x^{10}, so multi-digit powers stay together.
    .replace(/\^([0-9]{2,}|[A-Za-z]{2,})(?![}\w])/g, "^{$1}")
    .replace(/_([0-9]{2,}|[A-Za-z]{2,})(?![}\w])/g, "_{$1}");
  return tex.replace(/ +/g, " ").trim();
}

/** Spacing that TeX ignores, so two spellings can be compared. */
const normal = (tex: string) => tex.replace(/\s+/g, " ").replace(/ ?([^A-Za-z\\ ]) ?/g, "$1").trim();

/**
 * The everyday spelling of a formula, for editing it again: the reverse of
 * friendlyTex, used only when it turns back into exactly the same formula.
 */
export function friendlyFromTex(tex: string): string {
  const REVERSE: Record<string, string> = { infty: "inf", ge: ">=", le: "<=", ne: "!=", pm: "+-", to: "->", approx: "~=", cdot: "*", times: "×" };
  let text = tex;
  for (let i = 0; i < 3; i++) text = text.replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)");
  text = text
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => {
      const simple = (s: string) => new RegExp(`^${OPERAND}$`).test(s) && !s.startsWith("(");
      return `${simple(a) ? a : `(${a})`}/${simple(b) ? b : `(${b})`}`;
    })
    .replace(/\^\\circ/g, " deg")
    .replace(/\\([A-Za-z]+) ?/g, (whole, name: string) => {
      if (REVERSE[name]) return ` ${REVERSE[name]} `;
      return name in WORDS ? `${name} ` : whole;
    })
    .replace(/([\^_])\{([A-Za-z0-9]+)\}/g, "$1$2")
    .replace(/ +/g, " ")
    .trim();
  return normal(friendlyTex(text)) === normal(tex) ? text : tex;
}

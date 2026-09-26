"use client";

// Notes in and out of the app: Word documents (with real, editable Word
// equations), PDF through the system print dialog, and Word import. The
// heavy libraries load only when used.

import { registerPlugin } from "@capacitor/core";
import { deltaFromContent, type DeltaOp } from "./delta";
import { deltaLines, deltaToHtml, exportLink, isDisplayFormula, type Line } from "./deltaHtml";
import { DISPLAY } from "./markdownPaste";
import { isNative } from "./native";

const NotePrinter = registerPlugin<{ print(options: { html: string; name: string }): Promise<void> }>("NotePrinter");

/** A file name from a note title. */
export function fileName(title: string, extension: string) {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Note";
  return `${base}.${extension}`;
}

async function katexMathml(tex: string, display: boolean) {
  const katex = (await import("katex")).default;
  const html = katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: false, strict: "ignore" });
  const start = html.indexOf("<math");
  return start < 0 ? null : html.slice(start, html.lastIndexOf("</math>") + 7);
}

// ---------------------------------------------------------------------------
// PDF (print)

const PRINT_CSS = `
@page { margin: 22mm 20mm; }
* { box-sizing: border-box; }
body { font: 11pt/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
h1.title { font-size: 20pt; line-height: 1.25; margin: 0 0 14pt; letter-spacing: -0.01em; }
h1 { font-size: 15pt; margin: 16pt 0 6pt; }
h2 { font-size: 12.5pt; margin: 13pt 0 4pt; }
p { margin: 0 0 6pt; }
p.gap { height: 4pt; margin: 0; }
ul, ol { margin: 0 0 6pt; padding-left: 18pt; }
ul.checklist { list-style: none; padding-left: 4pt; }
li.done { color: #777; text-decoration: line-through; }
blockquote { margin: 0 0 6pt; padding-left: 10pt; border-left: 2pt solid #ccc; color: #444; }
pre { font: 9.5pt/1.45 ui-monospace, Menlo, Consolas, monospace; background: #f4f4f4; padding: 8pt 10pt; border-radius: 4pt; white-space: pre-wrap; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
a { color: inherit; }
.math { text-align: center; margin: 8pt 0; }
math { font-size: 1.08em; }
.math math { font-size: 1.2em; }
`;

async function printableHtml(title: string, content: string) {
  const ops = deltaFromContent(content);
  const formulas = new Map<string, string>();
  for (const line of deltaLines(ops)) {
    for (const s of line.segments) {
      if (s.formula == null || formulas.has(s.formula)) continue;
      const display = s.formula.startsWith(DISPLAY);
      const tex = display ? s.formula.slice(DISPLAY.length) : s.formula;
      formulas.set(s.formula, (await katexMathml(tex, display)) ?? tex);
    }
  }
  const body = deltaToHtml(ops, {
    formula: (tex, display) => formulas.get(display ? DISPLAY + tex : tex) ?? "",
  });
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title><style>${PRINT_CSS}</style></head><body><h1 class="title">${safeTitle}</h1>${body}</body></html>`;
}

/** Opens the print dialog, where "Save as PDF" makes the PDF. */
export async function printNote(title: string, content: string) {
  const html = await printableHtml(title || "Untitled note", content);
  if (isNative()) {
    await NotePrinter.print({ html, name: title || "Note" });
    return;
  }
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
  frame.srcdoc = html;
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => (frame.onload = () => resolve()));
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  // The dialog blocks until closed in most browsers; remove the frame after.
  setTimeout(() => frame.remove(), 1000);
}

// ---------------------------------------------------------------------------
// Word

export async function noteToDocx(title: string, content: string): Promise<Blob> {
  const docx = await import("docx");
  const { mml2omml } = await import("mathml2omml");
  const { Paragraph, TextRun, ExternalHyperlink, HeadingLevel, AlignmentType, LevelFormat, BorderStyle, ShadingType, ImportedXmlComponent } =
    docx;

  const math = async (formula: string) => {
    const display = formula.startsWith(DISPLAY);
    const tex = display ? formula.slice(DISPLAY.length) : formula;
    const mathml = await katexMathml(tex, display);
    if (!mathml) return new TextRun({ text: tex, font: "Cambria Math" });
    try {
      let omml = mml2omml(mathml.replace(/<annotation[\s\S]*?<\/annotation>/g, ""));
      if (display) omml = `<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${omml}</m:oMathPara>`;
      // fromXmlString wraps the parsed document; its first child is the equation.
      const wrapper = ImportedXmlComponent.fromXmlString(omml) as unknown as { root: unknown[] };
      return wrapper.root[0] as InstanceType<typeof TextRun>;
    } catch {
      return new TextRun({ text: tex, font: "Cambria Math" });
    }
  };

  const runs = async (line: Line, base: { font?: string } = {}) => {
    const out: unknown[] = [];
    for (const s of line.segments) {
      if (s.formula != null) {
        out.push(await math(s.formula));
        continue;
      }
      const a = s.attrs;
      const run = new TextRun({
        text: s.text ?? "",
        bold: !!a.bold,
        italics: !!a.italic,
        underline: a.underline ? {} : undefined,
        strike: !!a.strike,
        font: a.code ? "Consolas" : base.font,
        style: exportLink(a.link) ? "Hyperlink" : undefined,
      });
      const href = exportLink(a.link);
      out.push(href ? new ExternalHyperlink({ link: href, children: [run] }) : run);
    }
    return out as InstanceType<typeof TextRun>[];
  };

  const lines = deltaLines(deltaFromContent(content) as DeltaOp[]);
  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title || "Untitled note")] }),
  ];
  // Each run of numbered lines restarts at 1.
  let instance = 0;
  let previousOrdered = false;
  for (const line of lines) {
    const a = line.attrs;
    const indent = typeof a.indent === "number" ? a.indent : 0;
    const ordered = a.list === "ordered";
    if (ordered && !previousOrdered) instance++;
    previousOrdered = ordered;
    if (a.list === "bullet" || ordered) {
      children.push(
        new Paragraph({
          children: await runs(line),
          numbering: { reference: ordered ? "numbers" : "bullets", level: Math.min(indent, 4), ...(ordered ? { instance } : {}) },
        }),
      );
    } else if (a.list === "checked" || a.list === "unchecked") {
      const done = a.list === "checked";
      children.push(
        new Paragraph({
          indent: { left: 360 * (indent + 1), hanging: 300 },
          children: [new TextRun({ text: done ? "☑\t" : "☐\t" }), ...(await runs(line))],
        }),
      );
    } else if (a["code-block"]) {
      children.push(
        new Paragraph({
          style: "Code",
          children: await runs(line, { font: "Consolas" }),
        }),
      );
    } else if (a.blockquote) {
      children.push(
        new Paragraph({
          style: "Quote",
          children: await runs(line),
        }),
      );
    } else if (a.header) {
      children.push(new Paragraph({ heading: a.header === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: await runs(line) }));
    } else {
      children.push(
        new Paragraph({ alignment: isDisplayFormula(line) ? AlignmentType.CENTER : undefined, children: await runs(line) }),
      );
    }
  }

  const level = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (l: number) => string) =>
    [0, 1, 2, 3, 4].map((l) => ({
      level: l,
      format,
      text: text(l),
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 360 * (l + 1), hanging: 300 } } },
    }));
  const document = new docx.Document({
    creator: "Todo",
    title: title || "Untitled note",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      // Named styles, so importing the document back restores quotes and code.
      paragraphStyles: [
        {
          id: "Quote",
          name: "Quote",
          basedOn: "Normal",
          paragraph: {
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "C8C8C8", space: 10 } },
          },
          run: { color: "444444" },
        },
        {
          id: "Code",
          name: "Code",
          basedOn: "Normal",
          paragraph: { spacing: { after: 0 }, shading: { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" } },
          run: { font: "Consolas", size: 19 },
        },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: level(LevelFormat.BULLET, (l) => ["•", "◦", "▪"][l % 3]) },
        { reference: "numbers", levels: level(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) },
      ],
    },
    sections: [{ children }],
  });
  return docx.Packer.toBlob(document);
}

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
/** Stands in for an equation while the document goes through HTML. */
const mark = (i: number) => `\uE000${i}\uE001`;

/**
 * Swaps each equation in the document for a marker, so the equations survive
 * the conversion to HTML (which drops them) and come back as formulas.
 */
async function liftEquations(buffer: ArrayBuffer): Promise<{ buffer: ArrayBuffer; formulas: string[] }> {
  const [{ default: JSZip }, { ommlToTex }] = await Promise.all([import("jszip"), import("./ommlTex")]);
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file("word/document.xml");
  if (!entry) return { buffer, formulas: [] };
  const doc = new DOMParser().parseFromString(await entry.async("string"), "application/xml");
  const formulas: string[] = [];
  const equations = Array.from(doc.getElementsByTagNameNS(MATH_NS, "*")).filter(
    (el) => el.localName === "oMathPara" || (el.localName === "oMath" && el.parentElement?.localName !== "oMathPara"),
  );
  if (equations.length === 0) return { buffer, formulas };
  for (const el of equations) {
    const tex = ommlToTex(el).trim();
    const run = doc.createElementNS(WORD_NS, "w:r");
    const text = doc.createElementNS(WORD_NS, "w:t");
    text.textContent = tex ? mark(formulas.length) : "";
    run.appendChild(text);
    el.replaceWith(run);
    if (tex) formulas.push(el.localName === "oMathPara" ? DISPLAY + tex : tex);
  }
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  return { buffer: await zip.generateAsync({ type: "arraybuffer" }), formulas };
}

/** Puts the formulas back where their markers are. */
function dropEquations(ops: DeltaOp[], formulas: string[]): DeltaOp[] {
  if (formulas.length === 0) return ops;
  const out: DeltaOp[] = [];
  for (const op of ops) {
    if (typeof op.insert !== "string" || !op.insert.includes("\uE000")) {
      out.push(op);
      continue;
    }
    op.insert.split(/\uE000(\d+)\uE001/).forEach((part, i) => {
      if (i % 2 === 1) {
        const formula = formulas[Number(part)];
        if (formula) out.push({ insert: { formula } });
      } else if (part) {
        out.push(op.attributes ? { insert: part, attributes: op.attributes } : { insert: part });
      }
    });
  }
  return out;
}

/** A Word document as note content (a delta), with its title. */
export async function docxToContent(file: File): Promise<{ title: string; ops: DeltaOp[] }> {
  const [mammoth, { default: Quill }] = await Promise.all([import("mammoth"), import("quill")]);
  const { buffer, formulas } = await liftEquations(await file.arrayBuffer());
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1.doc-title:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
        "p[style-name='Code'] => pre:separator('\\n')",
      ],
    },
  );
  const page = new DOMParser().parseFromString(html, "text/html");
  // The document's title becomes the note's.
  const heading = page.querySelector("h1.doc-title");
  const title = heading?.textContent?.trim() || file.name.replace(/\.docx$/i, "").trim() || "Imported note";
  heading?.remove();
  // "☐ item" and "☑ item" lines (how checklists export) become checklists again.
  for (const p of Array.from(page.querySelectorAll("p"))) {
    const m = p.innerHTML.match(/^\s*([☐☑])\s*/);
    if (!m) continue;
    p.innerHTML = p.innerHTML.slice(m[0].length);
    const list = page.createElement("ol");
    const li = page.createElement("li");
    li.setAttribute("data-list", m[1] === "☑" ? "checked" : "unchecked");
    li.innerHTML = p.innerHTML;
    list.appendChild(li);
    p.replaceWith(list);
  }
  // A detached editor turns the HTML into the same delta the editor keeps.
  const host = document.createElement("div");
  const quill = new Quill(host, {
    formats: ["bold", "italic", "underline", "strike", "link", "code", "header", "list", "blockquote", "code-block", "indent"],
  });
  const delta = quill.clipboard.convert({ html: page.body.innerHTML }) as unknown as { ops: DeltaOp[] };
  const ops = dropEquations(
    delta.ops.map((op) =>
      op.attributes?.header && Number(op.attributes.header) > 2 ? { ...op, attributes: { ...op.attributes, header: 2 } } : op,
    ),
    formulas,
  );
  const last = ops[ops.length - 1];
  if (!(typeof last?.insert === "string" && last.insert.endsWith("\n"))) ops.push({ insert: "\n" });
  return { title, ops };
}

// ---------------------------------------------------------------------------
// Saving

/** Downloads a file on the web; on the phone, opens the share sheet. */
export async function saveFile(name: string, blob: Blob) {
  if (isNative()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    await Share.share({ title: name, files: [uri] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

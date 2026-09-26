// Sources and citations: MLA 9 and APA 7 references and in-text citations
// for websites, books, journal articles and videos.

export type SourceKind = "web" | "book" | "article" | "video" | "other";
export type CitationStyle = "mla" | "apa";

export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  /** People as "Last, First Middle"; an organisation as its name, no comma. */
  authors: string[];
  /** Published: "2024", "2024-05" or "2024-05-03". */
  date?: string;
  /** Website, journal, or channel. */
  container?: string;
  publisher?: string;
  edition?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  doi?: string;
  isbn?: string;
  /** When a web page was read: "2024-05-03". */
  accessed?: string;
  createdAt: number;
}

/** A piece of a formatted reference. */
export interface Run {
  text: string;
  italic?: boolean;
}

const MLA_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Name {
  last: string;
  first: string;
  /** An organisation (or a single name). */
  group: boolean;
}

export function parseName(name: string): Name {
  const text = name.trim();
  const comma = text.indexOf(",");
  if (comma > 0) return { last: text.slice(0, comma).trim(), first: text.slice(comma + 1).trim(), group: false };
  return { last: text, first: "", group: true };
}

/** "Jane Q. Smith" → "Smith, Jane Q."; organisations stay as they are. */
export function personName(name: string): string {
  const text = name.replace(/\s+/g, " ").trim();
  if (!text || text.includes(",")) return text;
  const words = text.split(" ");
  const particles = new Set(["van", "von", "de", "da", "del", "der", "di", "la", "le"]);
  const looksLikePerson =
    words.length >= 2 &&
    words.length <= 4 &&
    words.every((w) => particles.has(w) || /^[\p{Lu}][\p{L}'’.-]*$/u.test(w)) &&
    !/^(the|news|university|institute|organi[sz]ation|association|society|council|department|ministry|bbc|cnn)$/i.test(words[words.length - 1]);
  if (!looksLikePerson) return text;
  let split = words.length - 1;
  while (split > 1 && particles.has(words[split - 1].toLowerCase())) split--;
  return `${words.slice(split).join(" ")}, ${words.slice(0, split).join(" ")}`;
}

const initials = (first: string) =>
  first
    .split(/[\s]+/)
    .filter(Boolean)
    .map((part) =>
      part
        .split("-")
        .map((p) => `${p[0].toUpperCase()}.`)
        .join("-"),
    )
    .join(" ");

const parts = (date?: string) => {
  const m = date?.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  return m ? { year: m[1], month: m[2] ? Number(m[2]) : undefined, day: m[3] ? Number(m[3]) : undefined } : null;
};

const end = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);
const bareUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const doiUrl = (doi: string) => `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`;
const pageRange = (pages: string) => pages.replace(/\s*[-–—]+\s*/g, "–");

/** Joins runs, merging neighbours with the same style. */
function runs(...items: (Run | string | false | undefined | null)[]): Run[] {
  const out: Run[] = [];
  for (const item of items) {
    if (!item) continue;
    const run = typeof item === "string" ? { text: item } : item;
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && !!last.italic === !!run.italic) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

// ---------------------------------------------------------------------------
// MLA 9

function mlaAuthors(authors: string[]): string {
  const names = authors.map(parseName);
  if (names.length === 0) return "";
  const firstName = (n: Name) => (n.group ? n.last : `${n.last}, ${n.first}`);
  const plain = (n: Name) => (n.group ? n.last : `${n.first} ${n.last}`);
  if (names.length === 1) return firstName(names[0]);
  if (names.length === 2) return `${firstName(names[0])}, and ${plain(names[1])}`;
  return `${firstName(names[0])}, et al`;
}

function mlaDate(date?: string) {
  const p = parts(date);
  if (!p) return "";
  if (p.day && p.month) return `${p.day} ${MLA_MONTHS[p.month - 1]} ${p.year}`;
  if (p.month) return `${MLA_MONTHS[p.month - 1]} ${p.year}`;
  return p.year;
}

function mla(s: Source): Run[] {
  const author = mlaAuthors(s.authors);
  const lead = author ? `${end(author)} ` : "";
  const date = mlaDate(s.date);
  if (s.kind === "book") {
    const details = [s.edition && `${s.edition} ed.`, s.publisher, date].filter(Boolean).join(", ");
    return runs(lead, { text: s.title, italic: true }, ". ", details && `${end(details)}`);
  }
  if (s.kind === "article") {
    const bits = [
      s.volume && `vol. ${s.volume}`,
      s.issue && `no. ${s.issue}`,
      date,
      s.pages && `pp. ${pageRange(s.pages)}`,
    ].filter(Boolean);
    const link = s.doi ? doiUrl(s.doi) : s.url ? bareUrl(s.url) : "";
    return runs(
      lead,
      `“${end(s.title)}” `,
      s.container && { text: s.container, italic: true },
      bits.length ? `, ${bits.join(", ")}` : "",
      link ? `, ${link}.` : ".",
    );
  }
  // Websites, videos and anything else.
  const titled = s.kind === "other" && !s.url ? [{ text: s.title, italic: true }, ". "] : [`“${end(s.title)}” `];
  const details = [
    s.kind === "video" && s.authors.length === 0 && s.publisher ? `uploaded by ${s.publisher}` : "",
    date,
    s.url && bareUrl(s.url),
  ].filter(Boolean);
  const accessed = !date && s.accessed ? ` Accessed ${mlaDate(s.accessed)}.` : "";
  return runs(
    lead,
    ...titled,
    s.container && { text: s.container, italic: true },
    details.length ? `${s.container ? ", " : ""}${details.join(", ")}.` : s.container ? "." : "",
    accessed,
  ).map((r, i, all) => (i === all.length - 1 ? { ...r, text: r.text.trimEnd() } : r));
}

function mlaInText(s: Source, page?: string) {
  const names = s.authors.map(parseName);
  const who =
    names.length === 0
      ? `“${shortTitle(s.title)}”`
      : names.length === 1
        ? names[0].last
        : names.length === 2
          ? `${names[0].last} and ${names[1].last}`
          : `${names[0].last} et al.`;
  return `(${who}${page ? ` ${page}` : ""})`;
}

// ---------------------------------------------------------------------------
// APA 7

function apaName(n: Name) {
  return n.group ? n.last : `${n.last}, ${initials(n.first)}`.trim().replace(/,$/, "");
}

function apaAuthors(authors: string[]): string {
  const names = authors.map(parseName).map(apaName);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length <= 20) return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
}

function apaDate(date: string | undefined, full: boolean) {
  const p = parts(date);
  if (!p) return "(n.d.)";
  if (full && p.month) return `(${p.year}, ${MONTHS[p.month - 1]}${p.day ? ` ${p.day}` : ""})`;
  return `(${p.year})`;
}

function apa(s: Source): Run[] {
  const author = apaAuthors(s.authors);
  const full = s.kind === "web" || s.kind === "video";
  const date = apaDate(s.date, full);
  const link = s.doi ? doiUrl(s.doi) : s.url ?? "";
  if (s.kind === "article") {
    const source = runs(
      author ? `${end(author)} ${date}. ${end(s.title)} ` : `${end(s.title)} ${date}. `,
      s.container && { text: s.container, italic: true },
      s.volume && ", ",
      s.volume && { text: s.volume, italic: true },
      s.issue && `(${s.issue})`,
      s.pages && `, ${pageRange(s.pages)}`,
      s.container || s.volume || s.pages ? "." : "",
      link && ` ${link}`,
    );
    return source;
  }
  const title: Run = { text: s.title, italic: true };
  const edition = s.kind === "book" && s.edition ? ` (${s.edition} ed.)` : "";
  const where = s.kind === "book" ? s.publisher : s.container && s.container !== author ? s.container : "";
  return runs(
    author ? `${end(author)} ${date}. ` : "",
    title,
    edition,
    s.kind === "video" ? " [Video]" : "",
    ".",
    !author ? ` ${date}.` : "",
    where && ` ${end(where)}`,
    link && ` ${link}`,
  );
}

function apaInText(s: Source, page?: string) {
  const names = s.authors.map(parseName);
  const who =
    names.length === 0
      ? s.kind === "book"
        ? shortTitle(s.title)
        : `“${shortTitle(s.title)}”`
      : names.length === 1
        ? names[0].last
        : names.length === 2
          ? `${names[0].last} & ${names[1].last}`
          : `${names[0].last} et al.`;
  const year = parts(s.date)?.year ?? "n.d.";
  return `(${who}, ${year}${page ? `, p. ${page}` : ""})`;
}

// ---------------------------------------------------------------------------

function shortTitle(title: string) {
  const words = title.split(/\s+/);
  return words.length > 4 ? `${words.slice(0, 4).join(" ")}…` : title;
}

/** The full reference, for a bibliography. */
export function reference(source: Source, style: CitationStyle): Run[] {
  return style === "mla" ? mla(source) : apa(source);
}

/** The citation in the text, like (Smith 12) or (Smith, 2024). */
export function inText(source: Source, style: CitationStyle, page?: string): string {
  return style === "mla" ? mlaInText(source, page) : apaInText(source, page);
}

export const plainReference = (source: Source, style: CitationStyle) =>
  reference(source, style)
    .map((r) => r.text)
    .join("");

/** Sources in bibliography order. */
export function bibliography(sources: Source[], style: CitationStyle): Source[] {
  const key = (s: Source) => plainReference(s, style).replace(/^[“"']/, "").toLowerCase();
  return [...sources].sort((a, b) => key(a).localeCompare(key(b)));
}

export const bibliographyHeading = (style: CitationStyle) => (style === "mla" ? "Works Cited" : "References");

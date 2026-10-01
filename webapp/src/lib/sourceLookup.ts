"use client";

// Fills in a source from a DOI (Crossref), an ISBN (Open Library), or a web
// address (the page's own citation metadata). Anything a lookup can't find
// is left for the user to type.

import { CapacitorHttp } from "@capacitor/core";
import { isNative } from "./native";
import { personName, type Source, type SourceKind } from "./sources";

export type Found = Omit<Source, "id" | "createdAt">;

export type Identified = { doi: string } | { isbn: string } | { url: string };

export function identify(input: string): Identified | null {
  const text = input.trim();
  const doi = text.match(/\b(10\.\d{4,9}\/[^\s"<>]+[^\s"<>.,;)])/);
  if (doi) return { doi: decodeURIComponent(doi[1]) };
  const digits = text.replace(/^isbn[:\s]*/i, "").replace(/[\s-]/g, "");
  if (/^(97[89]\d{10}|\d{9}[\dXx])$/.test(digits)) return { isbn: digits.toUpperCase() };
  if (/^https?:\/\/\S+$/i.test(text)) return { url: text };
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text)) return { url: `https://${text}` };
  return null;
}

const today = () => new Date().toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

/** A date as "2024", "2024-05" or "2024-05-03". */
export function isoDate(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const [y, m, d] = value as number[];
    return y ? [String(y), m && pad(m), d && pad(d)].filter(Boolean).join("-") : undefined;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const iso = value.match(/^(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?/);
  if (iso) return [iso[1], iso[2] && pad(Number(iso[2])), iso[3] && pad(Number(iso[3]))].filter(Boolean).join("-");
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  const year = value.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return year?.[1];
}

interface CrossrefWork {
  type?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: number[][] };
  published?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  URL?: string;
  DOI?: string;
  ISBN?: string[];
}

export function fromCrossref(work: CrossrefWork): Found {
  const type = work.type ?? "";
  const kind: SourceKind = type.startsWith("book") || type === "monograph" ? "book" : type.includes("article") || type === "proceedings-article" ? "article" : "other";
  return {
    kind,
    title: (work.title?.[0] ?? "").replace(/\s+/g, " ").trim(),
    authors: (work.author ?? []).map((a) => (a.family ? `${a.family}${a.given ? `, ${a.given}` : ""}` : (a.name ?? ""))).filter(Boolean),
    date: isoDate((work.issued ?? work.published)?.["date-parts"]?.[0]),
    container: work["container-title"]?.[0],
    publisher: kind === "book" ? work.publisher : undefined,
    volume: work.volume,
    issue: work.issue,
    pages: work.page,
    doi: work.DOI,
    isbn: work.ISBN?.[0],
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

async function byDoi(doi: string): Promise<Found> {
  const { message } = await getJson<{ message: CrossrefWork }>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  return fromCrossref(message);
}

async function byIsbn(isbn: string): Promise<Found> {
  const book = await getJson<{
    title?: string;
    subtitle?: string;
    authors?: { key: string }[];
    publishers?: string[];
    publish_date?: string;
    edition_name?: string;
  }>(`https://openlibrary.org/isbn/${isbn}.json`);
  const authors = await Promise.all(
    (book.authors ?? []).slice(0, 6).map(async (a) => {
      try {
        const author = await getJson<{ name?: string; personal_name?: string }>(`https://openlibrary.org${a.key}.json`);
        return personName(author.name ?? author.personal_name ?? "");
      } catch {
        return "";
      }
    }),
  );
  return {
    kind: "book",
    title: [book.title, book.subtitle].filter(Boolean).join(": "),
    authors: authors.filter(Boolean),
    publisher: book.publishers?.[0],
    date: isoDate(book.publish_date),
    edition: book.edition_name?.replace(/\s*ed(ition|\.)?\s*$/i, ""),
    isbn,
  };
}

async function fetchPage(url: string): Promise<string> {
  if (isNative()) {
    const response = await CapacitorHttp.get({ url, responseType: "text", headers: { Accept: "text/html" } });
    if (response.status >= 400) throw new Error(`${response.status}`);
    return typeof response.data === "string" ? response.data : "";
  }
  const response = await fetch(url, { headers: { Accept: "text/html" } });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.text();
}

/** What a page says about itself: scholarly tags, JSON-LD, then Open Graph. */
function fromPage(html: string, url: string): Found & { citationDoi?: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = (...names: string[]) => {
    for (const name of names) {
      const el = doc.querySelector(`meta[name="${name}" i], meta[property="${name}" i], meta[itemprop="${name}" i]`);
      const content = el?.getAttribute("content")?.trim();
      if (content) return content;
    }
    return undefined;
  };
  const metaAll = (name: string) =>
    Array.from(doc.querySelectorAll(`meta[name="${name}" i]`))
      .map((el) => el.getAttribute("content")?.trim() ?? "")
      .filter(Boolean);

  // JSON-LD: the first article-like object.
  let ld: Record<string, unknown> | undefined;
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? "");
      const items: Record<string, unknown>[] = (Array.isArray(data) ? data : data["@graph"] ?? [data]) as Record<string, unknown>[];
      ld = items.find((i) => /Article|Posting|Report|VideoObject|WebPage|Book/.test(String(i["@type"])));
      if (ld) break;
    } catch {
      // Not valid JSON: ignore.
    }
  }
  const ldNames = (value: unknown): string[] => {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    return list
      .map((v) => (typeof v === "string" ? v : typeof v === "object" && v ? String((v as { name?: unknown }).name ?? "") : ""))
      .filter((n) => n && !/^https?:/.test(n));
  };

  const host = new URL(url).hostname.replace(/^www\./, "");
  const video = /(^|\.)youtube\.com$|^youtu\.be$|(^|\.)vimeo\.com$/.test(host);
  const site =
    meta("citation_journal_title") ??
    meta("og:site_name") ??
    ldNames((ld?.publisher as unknown) ?? [])[0] ??
    (video && host.includes("youtube") ? "YouTube" : host);
  let title = meta("citation_title") ?? (ld?.headline as string | undefined) ?? meta("og:title", "twitter:title") ?? doc.title.trim();
  // "Title | Site" and "Title - Site": keep the title.
  if (site) title = title.replace(new RegExp(`\\s*[|\\-–—]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  const people = metaAll("citation_author");
  const authors = (people.length ? people : ldNames(ld?.author).length ? ldNames(ld?.author) : [meta("author")].filter(Boolean) as string[])
    .map(personName)
    .filter((a) => a && a !== site);
  const channel = video ? doc.querySelector('link[itemprop="name"]')?.getAttribute("content") ?? undefined : undefined;
  return {
    kind: meta("citation_journal_title") ? "article" : video ? "video" : "web",
    title: title.replace(/\s+/g, " ").trim(),
    authors: video ? [] : authors,
    publisher: channel,
    date: isoDate(
      meta("citation_publication_date", "citation_date", "article:published_time", "datePublished", "date", "uploadDate") ??
        (ld?.datePublished as string | undefined),
    ),
    container: site,
    volume: meta("citation_volume"),
    issue: meta("citation_issue"),
    pages: [meta("citation_firstpage"), meta("citation_lastpage")].filter(Boolean).join("–") || undefined,
    url,
    accessed: today(),
    citationDoi: meta("citation_doi", "dc.identifier")?.replace(/^doi:/i, ""),
  };
}

/** Fills in what it can; throws only when the input isn't a DOI, ISBN or address. */
export async function lookup(input: string): Promise<{ found: Found; complete: boolean }> {
  const id = identify(input);
  if (!id) throw new Error("Paste a web address, a DOI or an ISBN.");
  if ("doi" in id) return { found: await byDoi(id.doi), complete: true };
  if ("isbn" in id) return { found: await byIsbn(id.isbn), complete: true };
  const host = new URL(id.url).hostname.replace(/^www\./, "");
  try {
    const page = fromPage(await fetchPage(id.url), id.url);
    const { citationDoi, ...found } = page;
    if (citationDoi && identify(citationDoi)) {
      try {
        return { found: { ...(await byDoi(citationDoi)), url: id.url }, complete: true };
      } catch {
        // Use what the page said.
      }
    }
    return { found, complete: Boolean(found.title) };
  } catch {
    // Most sites don't let a web page read them; the phone app can.
    return { found: { kind: "web", title: "", authors: [], container: host, url: id.url, accessed: today() }, complete: false };
  }
}

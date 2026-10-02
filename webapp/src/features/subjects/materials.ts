"use client";

import type { Material, Project } from "@/lib/model";
import { uuid } from "@/lib/model";
import { updateProject, useWorkspace } from "@/store/workspace";

// A subject's description and materials live on the subject record itself,
// so they sync, back up and restore with it.

function withSubject(id: string, change: (project: Project) => Project) {
  const current = useWorkspace.getState().projects.find((p) => p.id === id);
  if (current) updateProject(change(current));
}

export function setDescription(id: string, description: string) {
  const text = description.trim();
  withSubject(id, (p) => {
    const next: Project = { ...p, description: text };
    if (!text) delete next.description;
    return next;
  });
}

export function saveMaterial(subjectId: string, material: Omit<Material, "id" | "addedAt"> & Partial<Pick<Material, "id" | "addedAt">>) {
  const saved: Material = {
    id: material.id ?? uuid(),
    title: material.title.trim(),
    addedAt: material.addedAt ?? Date.now(),
    ...(material.url?.trim() ? { url: normalizeUrl(material.url) } : {}),
    ...(material.path?.trim() ? { path: cleanPath(material.path) } : {}),
    ...(material.detail?.trim() ? { detail: material.detail.trim() } : {}),
  };
  withSubject(subjectId, (p) => {
    const list = p.materials ?? [];
    const exists = list.some((m) => m.id === saved.id);
    return { ...p, materials: exists ? list.map((m) => (m.id === saved.id ? saved : m)) : [...list, saved] };
  });
  return saved;
}

export function removeMaterial(subjectId: string, id: string) {
  withSubject(subjectId, (p) => ({ ...p, materials: (p.materials ?? []).filter((m) => m.id !== id) }));
}

/** Moves a material to another place in the list. */
export function moveMaterial(subjectId: string, id: string, to: number) {
  withSubject(subjectId, (p) => {
    const list = [...(p.materials ?? [])];
    const from = list.findIndex((m) => m.id === id);
    if (from < 0) return p;
    const [item] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(to, list.length)), 0, item);
    return { ...p, materials: list };
  });
}

/** "moodle.uni.fi/course" → "https://moodle.uni.fi/course". */
export function normalizeUrl(text: string): string {
  const value = text.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}

/** True for text that reads as a file on a computer: "/Users/…", "~/…", "C:\\…" or a file: link. */
export function looksLikePath(text: string): boolean {
  const value = text.trim();
  return /^(\/|~\/|[a-z]:[\\/]|\\\\|file:\/\/)/i.test(value) && value.length > 2;
}

/** A pasted path without quotes (Finder's "Copy as Pathname" adds none, Terminal may) or file: prefix. */
export function cleanPath(text: string): string {
  let value = text.trim().replace(/^["']|["']$/g, "");
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname).replace(/^\/([a-z]:)/i, "$1");
    } catch {
      // Left as typed.
    }
  }
  return value;
}

/** "notes.pdf" for "/Users/leo/Physics/notes.pdf". */
export function fileName(path: string): string {
  return cleanPath(path).split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** A readable title for a file: its name without the extension. */
export function titleFromPath(path: string): string {
  const name = fileName(path).replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_]+/g, " ").trim();
  return name ? name[0].toUpperCase() + name.slice(1) : fileName(path);
}

/** True for text that reads as a web address. */
export function looksLikeUrl(text: string): boolean {
  const value = text.trim();
  if (!value || /\s/.test(value)) return false;
  try {
    const url = new URL(normalizeUrl(value));
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** The site's name for display: "youtube.com", "docs.google.com". */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Path words that say nothing about what a link is.
const GENERIC = /^(edit|view|viewer|preview|index|home|main|watch|d|u|\d|file|files|document|presentation|spreadsheets|forms|open|share|shared|course|courses|view\.php|default|page|pages|embed|present|pub)$/i;

/** A readable title from a link when none was given. */
export function titleFromUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(normalizeUrl(url));
  } catch {
    return url;
  }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname;
  if (host === "docs.google.com") {
    if (path.startsWith("/presentation")) return "Google Slides";
    if (path.startsWith("/spreadsheets")) return "Google Sheet";
    if (path.startsWith("/forms")) return "Google Form";
    return "Google Doc";
  }
  if (host === "drive.google.com") return "Google Drive file";
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return "YouTube video";
  const segments = path.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (host === "github.com" && segments.length >= 2) return `${segments[0]}/${segments[1]}`;
  for (const part of segments.reverse()) {
    const words = part.replace(/\.(pdf|docx?|pptx?|xlsx?|html?|php|aspx?)$/i, "").replace(/[-_+]+/g, " ").trim();
    const idLike = /^[\w-]{16,}$/.test(part) && /\d/.test(part) && !/\s/.test(words);
    if (!words || GENERIC.test(words) || idLike || /^\d+$/.test(words)) continue;
    return words[0].toUpperCase() + words.slice(1);
  }
  return host;
}

export type MaterialKind = "video" | "doc" | "slides" | "sheet" | "pdf" | "code" | "link" | "file" | "item";

export function materialKind(material: Pick<Material, "url" | "path">): MaterialKind {
  if (material.path) {
    const ext = fileName(material.path).split(".").pop()?.toLowerCase() ?? "";
    if (ext === "pdf") return "pdf";
    if (/^(pptx?|key|odp)$/.test(ext)) return "slides";
    if (/^(xlsx?|csv|numbers|ods)$/.test(ext)) return "sheet";
    if (/^(docx?|pages|odt|rtf|txt|md)$/.test(ext)) return "doc";
    if (/^(mp4|mov|m4v|webm|mkv)$/.test(ext)) return "video";
    if (/^(py|js|ts|java|c|cpp|ipynb|r|m)$/.test(ext)) return "code";
    return "file";
  }
  if (!material.url) return "item";
  let host = "";
  let path = "";
  try {
    const u = new URL(material.url);
    host = u.hostname;
    path = u.pathname.toLowerCase();
  } catch {
    return "link";
  }
  if (/youtube\.com|youtu\.be|vimeo\.com|panopto|loom\.com/.test(host)) return "video";
  if (path.endsWith(".pdf")) return "pdf";
  if (/docs\.google\.com/.test(host)) {
    if (path.startsWith("/presentation")) return "slides";
    if (path.startsWith("/spreadsheets")) return "sheet";
    return "doc";
  }
  if (/\.pptx?$/.test(path)) return "slides";
  if (/\.xlsx?$|\.csv$/.test(path)) return "sheet";
  if (/\.docx?$/.test(path) || /notion\.so|onedrive|sharepoint/.test(host)) return "doc";
  if (/github\.com|gitlab\.com|replit\.com|colab\.research/.test(host)) return "code";
  return "link";
}

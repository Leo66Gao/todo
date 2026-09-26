"use client";

import { create } from "zustand";
import { uuid } from "@/lib/model";
import type { CitationStyle, Source } from "@/lib/sources";
import { readSide, useWorkspace, writeSide } from "@/store/workspace";

// The source library: one synced record with every source and the chosen
// citation style.

const KEY = "settings:sources";

interface Library {
  sources: Source[];
  style: CitationStyle;
}

const EMPTY: Library = { sources: [], style: "mla" };

function read(): Library {
  const value = readSide<Partial<Library>>(KEY, EMPTY);
  return {
    sources: Array.isArray(value.sources) ? value.sources : [],
    style: value.style === "apa" ? "apa" : "mla",
  };
}

export function useLibrary(): Library {
  // Subscribing to the raw record keeps this in step with sync.
  useWorkspace((s) => s.side[KEY]);
  return read();
}

export function saveSource(source: Omit<Source, "id" | "createdAt"> & Partial<Pick<Source, "id" | "createdAt">>): Source {
  const library = read();
  const saved: Source = { ...source, id: source.id ?? uuid(), createdAt: source.createdAt ?? Date.now() };
  const exists = library.sources.some((s) => s.id === saved.id);
  writeSide(KEY, {
    ...library,
    sources: exists ? library.sources.map((s) => (s.id === saved.id ? saved : s)) : [saved, ...library.sources],
  });
  return saved;
}

export function deleteSource(id: string) {
  const library = read();
  writeSide(KEY, { ...library, sources: library.sources.filter((s) => s.id !== id) });
}

export function setCitationStyle(style: CitationStyle) {
  writeSide(KEY, { ...read(), style });
}

// ---------------------------------------------------------------------------
// The sheet, opened from the notes list or from a note (to cite).

export interface CiteTarget {
  /** Inserts an in-text citation where the cursor was. */
  cite: (source: Source, style: CitationStyle, page?: string) => void;
  /** Adds the bibliography of what this note cites. */
  bibliography: (style: CitationStyle) => void;
  /** The sources this note cites. */
  cited: () => string[];
}

export const useSourcesSheet = create<{ open: boolean; target: CiteTarget | null }>(() => ({ open: false, target: null }));

export const openSources = (target: CiteTarget | null = null) => useSourcesSheet.setState({ open: true, target });
export const closeSources = () => useSourcesSheet.setState({ open: false });

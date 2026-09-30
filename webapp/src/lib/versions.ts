// Version history for notes: earlier states, kept at most every ten minutes
// while a note is being edited, synced as one record per note. The newest
// come first; the oldest are dropped past 40 versions or when the record
// would grow too large to sync.

import { isEmptyContent } from "./delta";

export interface Version {
  /** When the note looked like this (ms since epoch). */
  at: number;
  title: string;
  content: string;
}

export const versionsKey = (noteId: string) => `settings:versions:${noteId}`;
export const VERSION_GAP = 10 * 60_000;
const MAX_VERSIONS = 40;
const MAX_BYTES = 600_000;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** The history with this state added, or null when it isn't worth keeping. */
export function withVersion(
  history: Version[],
  note: { title: string; content: string },
  now: number,
  force = false,
): Version[] | null {
  const latest = history[0];
  if (latest && latest.content === note.content && latest.title === note.title) return null;
  if (!force && latest && now - latest.at < VERSION_GAP) return null;
  if (isEmptyContent(note.content) && !note.title.trim()) return null;
  const next = [{ at: now, title: note.title, content: note.content }, ...history].slice(0, MAX_VERSIONS);
  while (next.length > 1 && bytes({ versions: next }) > MAX_BYTES) next.pop();
  // A valid note can be larger than the history budget. Keep one whole
  // version if it still fits a record; never truncate its content.
  if (bytes({ versions: next }) > 650 * 1024) return null;
  return next;
}

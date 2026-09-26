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
const MAX_CHARS = 600_000;

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
  let size = JSON.stringify({ versions: next }).length;
  while (next.length > 1 && size > MAX_CHARS) size -= JSON.stringify(next.pop()).length + 1;
  return next;
}

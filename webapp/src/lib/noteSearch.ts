// Picks the notes a question is most likely about, to send to the AI with it.
// When everything fits, every note goes (best ranked first); otherwise the
// best matches by title, subject and content, up to a budget.

import { deltaFromContent } from "./delta";
import type { StudyNote } from "./model";
import { markdownLines, toMarkdown } from "./noteMarkdown";

/** A note's text as Markdown. */
export const noteMarkdown = (content: string) => toMarkdown(markdownLines(deltaFromContent(content)));

const STOP = new Set(
  "the and for are but not you all any can had her was one our out has his how its may new now see two who did get him let say she too use what when where which why with from have this that they them then than been were will would there their about into more some such only also does each just like make over very your what's whats explain tell know need".split(
    " ",
  ),
);

/** The words worth matching, cut to a stem so "enzymes" finds "enzyme". */
export function queryStems(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const stems = words.filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => (w.length > 5 ? w.slice(0, w.length - 2) : w));
  return [...new Set(stems)];
}

const count = (text: string, stem: string) => {
  let n = 0;
  for (let i = text.indexOf(stem); i >= 0 && n < 12; i = text.indexOf(stem, i + stem.length)) n++;
  return n;
};

export interface PickedNote {
  note: StudyNote;
  markdown: string;
  score: number;
}

export function pickNotes(notes: StudyNote[], subjectOf: (id: string | null) => string | undefined, query: string, budget = 40_000): PickedNote[] {
  const stems = queryStems(query);
  const all = notes
    .map((note) => {
      const markdown = noteMarkdown(note.content);
      const title = note.title.toLowerCase();
      const subject = (subjectOf(note.subjectId) ?? "").toLowerCase();
      const body = markdown.toLowerCase();
      const score = stems.reduce((sum, s) => sum + (title.includes(s) ? 6 : 0) + (subject.includes(s) ? 4 : 0) + count(body, s), 0);
      return { note, markdown, score };
    })
    .filter((n) => n.markdown.trim() || n.note.title.trim());
  const ranked = all.sort((a, b) => b.score - a.score || b.note.updatedAt.getTime() - a.note.updatedAt.getTime());
  const total = ranked.reduce((sum, n) => sum + n.markdown.length, 0);
  if (total <= budget) return ranked;
  const matching = ranked.filter((n) => n.score > 0);
  // Nothing matches by words: the most recent notes are the best guess.
  const pool = matching.length ? matching : ranked.slice(0, 6);
  const out: PickedNote[] = [];
  let left = budget;
  for (const n of pool) {
    if (left < 1500) break;
    const markdown = n.markdown.length > left ? `${n.markdown.slice(0, left)}\n…` : n.markdown;
    out.push({ ...n, markdown });
    left -= markdown.length;
  }
  return out;
}

import { expect, it } from "vitest";
import type { StudyNote } from "@/lib/model";
import { pickNotes, queryStems } from "@/lib/noteSearch";
import { splitSources } from "@/lib/notePrompts";

const note = (id: string, title: string, text: string, subjectId: string | null = null, day = 1): StudyNote => ({
  id,
  title,
  content: JSON.stringify({ ops: [{ insert: `${text}\n` }] }),
  subjectId,
  folderId: null,
  attachments: [],
  createdAt: new Date(2026, 9, day),
  updatedAt: new Date(2026, 9, day),
});

it("matches question words by their stems, without filler words", () => {
  expect(queryStems("What do enzymes do in digestion?")).toEqual(["enzym", "digesti"]);
});

it("sends every note when they fit, best match first", () => {
  const notes = [note("a", "French verbs", "être, avoir"), note("b", "Enzymes", "Enzymes speed up reactions", "bio")];
  const picked = pickNotes(notes, (id) => (id === "bio" ? "Biology" : undefined), "how do enzymes work");
  expect(picked.map((p) => p.note.id)).toEqual(["b", "a"]);
});

it("keeps to the budget with only the notes that match", () => {
  const long = "filler ".repeat(500);
  const notes = [note("a", "History", long), note("b", "Cells", `mitochondria ${long}`), note("c", "Maths", long)];
  const picked = pickNotes(notes, () => undefined, "mitochondria", 4000);
  expect(picked.map((p) => p.note.id)).toEqual(["b"]);
});

it("splits the sources line off an answer, also mid-stream", () => {
  expect(splitSources("Enzymes are catalysts.\nSOURCES: 2, 5")).toEqual({ text: "Enzymes are catalysts.", sources: [2, 5] });
  expect(splitSources("Enzymes are catalysts.\nSOU")).toEqual({ text: "Enzymes are catalysts.", sources: [] });
  expect(splitSources("Sources of energy:\n- sun")).toEqual({ text: "Sources of energy:\n- sun", sources: [] });
});

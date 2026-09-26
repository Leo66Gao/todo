"use client";

import { formatDistanceToNowStrict, isToday, isYesterday, format } from "date-fns";
import type { StudyNote } from "@/lib/model";
import { contentFromDelta } from "@/lib/delta";
import { encodeNote, recordFits, uuid } from "@/lib/model";
import type { Route } from "@/shell/nav";
import { addNote, deleteNote, useWorkspace } from "@/store/workspace";
import { confirmDialog } from "@/ui/overlay";
import { toast } from "@/ui/toast";

export function createNote(navigate: (r: Route) => void, opts: { subjectId?: string | null; folderId?: string | null } = {}) {
  const now = new Date();
  const note: StudyNote = {
    id: uuid(),
    title: "",
    content: "",
    subjectId: opts.subjectId ?? null,
    folderId: opts.folderId ?? null,
    attachments: [],
    createdAt: now,
    updatedAt: now,
  };
  addNote(note);
  navigate({ view: "note", id: note.id });
}

/** Makes a note from a Word document and opens it. */
export async function importNote(file: File, navigate: (r: Route) => void, subjectId: string | null) {
  try {
    const { docxToContent } = await import("@/lib/noteFiles");
    const { title, ops } = await docxToContent(file);
    const now = new Date();
    const note: StudyNote = {
      id: uuid(),
      title,
      content: contentFromDelta(ops),
      subjectId,
      folderId: null,
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
    if (!recordFits(encodeNote(note))) {
      toast("This document is too large for one note. Split it and import the parts.");
      return;
    }
    addNote(note);
    navigate({ view: "note", id: note.id });
    toast(`Imported “${title}”`);
  } catch {
    toast("This file couldn’t be read. Choose a Word document (.docx).");
  }
}

export async function removeNote(note: StudyNote, after?: () => void) {
  const ok = await confirmDialog({
    title: `Delete “${note.title || "Untitled note"}”?`,
    message: "This removes the note from all your devices.",
    confirmLabel: "Delete note",
    destructive: true,
  });
  if (!ok) return;
  const index = useWorkspace.getState().notes.findIndex((n) => n.id === note.id);
  deleteNote(note.id);
  after?.();
  toast("Note deleted", { label: "Undo", run: () => addNote(note, index) });
}

export function editedLabel(date: Date) {
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "Edited just now";
  if (diff < 3_600_000) return `Edited ${formatDistanceToNowStrict(date)} ago`;
  if (isToday(date)) return `Edited ${format(date, "HH.mm")}`;
  if (isYesterday(date)) return "Edited yesterday";
  return `Edited ${format(date, date.getFullYear() === new Date().getFullYear() ? "d MMM" : "d MMM yyyy")}`;
}

export function noteGroup(date: Date) {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return format(date, date.getFullYear() === new Date().getFullYear() ? "MMMM" : "MMMM yyyy");
}

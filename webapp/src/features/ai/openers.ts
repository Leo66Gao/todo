"use client";

// What opens the AI dialogs, kept apart from the dialogs themselves: buttons
// all over the app call these, while the dialogs (and the markdown and
// formula rendering they bring) load only when needed.

import { create } from "zustand";
import { useAiKey } from "@/lib/ai";
import { choosePhotos } from "@/lib/photoData";
import type { Route } from "@/shell/nav";
import { useWorkspace } from "@/store/workspace";
import { toast } from "@/ui/toast";

export const useAskNotes = create<{ open: boolean; question: string }>(() => ({ open: false, question: "" }));
export const askNotes = (question = "") => useAskNotes.setState({ open: true, question: question.trim() });

export type StudyMode = "sheet" | "quiz";
export const useSubjectStudy = create<{ projectId: string | null; mode: StudyMode }>(() => ({ projectId: null, mode: "sheet" }));
export const studySubject = (projectId: string, mode: StudyMode) => useSubjectStudy.setState({ projectId, mode });

export const usePhotoNote = create<{ files: File[] | null; subjectId: string | null; folderId: string | null }>(() => ({
  files: null,
  subjectId: null,
  folderId: null,
}));

const owner = () => useWorkspace.getState().user?.uid ?? "";

/** Picks photos and writes them up as a new note (in a subject or folder when given). */
export async function noteFromPhotos(navigate: (route: Route) => void, opts: { subjectId?: string | null; folderId?: string | null } = {}) {
  if (!useAiKey.getState().key) {
    toast("Add your DeepSeek API key in Settings to make notes from photos.", { label: "Settings", run: () => navigate({ view: "settings" }) });
    return;
  }
  const picker = owner();
  const files = await choosePhotos();
  // (Photos picked as one account belong to that one.)
  if (files.length && owner() === picker) usePhotoNote.setState({ files, subjectId: opts.subjectId ?? null, folderId: opts.folderId ?? null });
}

/** Closes the AI dialogs and forgets what was asked or picked in them (when the account changes). */
export function resetAiInputs() {
  useAskNotes.setState({ open: false, question: "" });
  useSubjectStudy.setState({ projectId: null, mode: "sheet" });
  usePhotoNote.setState({ files: null, subjectId: null, folderId: null });
}

useWorkspace.subscribe((s, prev) => {
  if ((s.user?.uid ?? "") !== (prev.user?.uid ?? "")) resetAiInputs();
});

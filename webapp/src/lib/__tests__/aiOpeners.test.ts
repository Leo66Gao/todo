import { expect, it, vi } from "vitest";
import { askNotes, studySubject, useAskNotes, usePhotoNote, useSubjectStudy } from "@/features/ai/openers";
import { useWorkspace } from "@/store/workspace";

vi.mock("@/ui/toast", () => ({ toast: vi.fn() }));

it("forgets what was asked or picked when the account changes", () => {
  useWorkspace.setState({ user: { uid: "a", email: null, displayName: null, photoURL: null } });
  askNotes("What is entropy?");
  studySubject("phys", "quiz");
  usePhotoNote.setState({ files: [new File(["x"], "page.jpg")], subjectId: "phys", folderId: null });
  useWorkspace.setState({ user: { uid: "b", email: null, displayName: null, photoURL: null } });
  expect(useAskNotes.getState()).toEqual({ open: false, question: "" });
  expect(useSubjectStudy.getState().projectId).toBeNull();
  expect(usePhotoNote.getState().files).toBeNull();
});

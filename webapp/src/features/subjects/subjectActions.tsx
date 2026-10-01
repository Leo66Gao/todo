"use client";

import type { Project } from "@/lib/model";
import { uuid } from "@/lib/model";
import type { Route } from "@/shell/nav";
import { ui } from "@/shell/ui";
import { addProject, captureWorkspaceSession, deleteProject, updateProject, useWorkspace } from "@/store/workspace";
import { confirmDialog, type MenuItem } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { editNameColor, PALETTE } from "./NameColorDialog";

export async function createSubject(): Promise<Project | null> {
  const currentSession = captureWorkspaceSession();
  const count = useWorkspace.getState().projects.length;
  const result = await editNameColor({
    title: "New subject",
    confirmLabel: "Create subject",
    name: "",
    placeholder: "Subject name",
    color: PALETTE[(count * 3) % PALETTE.length],
  });
  if (!result || !currentSession()) return null;
  const project: Project = { id: uuid(), title: result.name, colorValue: result.color };
  addProject(project);
  return project;
}

export async function editSubject(project: Project) {
  const currentSession = captureWorkspaceSession();
  const result = await editNameColor({
    title: "Edit subject",
    confirmLabel: "Save",
    name: project.title,
    placeholder: "Subject name",
    color: project.colorValue,
  });
  if (!result || !currentSession()) return;
  const current = useWorkspace.getState().projects.find((p) => p.id === project.id);
  if (current) updateProject({ ...current, title: result.name, colorValue: result.color });
}

export async function deleteSubject(project: Project, navigate?: (r: Route) => void) {
  const currentSession = captureWorkspaceSession();
  const ok = await confirmDialog({
    title: `Delete “${project.title}”?`,
    message: "Its tasks and notes stay in your workspace without a subject.",
    confirmLabel: "Delete subject",
    destructive: true,
  });
  if (!ok || !currentSession()) return;
  deleteProject(project.id);
  toast(`Deleted “${project.title}”`);
  navigate?.({ view: "subjects" });
}

export function subjectMenu(project: Project, navigate: (r: Route) => void): MenuItem[] {
  return [
    { label: "Open", onSelect: () => navigate({ view: "subject", id: project.id }) },
    { label: "New task in subject", onSelect: () => ui.newTask({ projectId: project.id }) },
    { separator: true },
    { label: "Edit subject…", onSelect: () => void editSubject(project) },
    { label: "Delete subject…", destructive: true, onSelect: () => void deleteSubject(project) },
  ];
}

"use client";

import { Folder } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { plainText } from "@/lib/delta";
import type { StudyNote } from "@/lib/model";
import { useNavigate } from "@/shell/nav";
import { useWorkspace } from "@/store/workspace";
import { ContextMenu } from "@/ui/overlay";
import { editedLabel, removeNote } from "./noteActions";

export function NoteRow({ note, showSubject = true }: { note: StudyNote; showSubject?: boolean }) {
  const navigate = useNavigate();
  const subject = useWorkspace((s) => (note.subjectId ? s.projects.find((p) => p.id === note.subjectId) : undefined));
  const folder = useWorkspace((s) => (note.folderId ? s.folders.find((f) => f.id === note.folderId) : undefined));
  const preview = plainText(note.content);
  return (
    <ContextMenu
      items={() => [
        { label: "Open", onSelect: () => navigate({ view: "note", id: note.id }) },
        { separator: true },
        { label: "Delete note…", destructive: true, onSelect: () => void removeNote(note) },
      ]}
    >
      <button
        type="button"
        onClick={() => navigate({ view: "note", id: note.id })}
        data-note-row=""
        className="relative block w-full px-4 py-3 text-left transition-colors hover:bg-[image:linear-gradient(var(--row-hover),var(--row-hover))] max-md:py-3.5"
      >
        <div className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{note.title || "Untitled note"}</span>
          <span className="shrink-0 text-2xs text-ink-3">{editedLabel(note.updatedAt).replace("Edited ", "")}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-[18px] break-words text-ink-3">{preview || "No additional text"}</p>
        {((showSubject && subject) || folder) && (
          <div className="mt-1.5 flex min-w-0 items-center gap-3 text-2xs text-ink-3">
            {showSubject && subject && (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: argbToCss(subject.colorValue) }} />
                <span className="truncate">{subject.title}</span>
              </span>
            )}
            {folder && (
              <span className="flex min-w-0 items-center gap-1">
                <Folder className="size-3 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </span>
            )}
          </div>
        )}
      </button>
    </ContextMenu>
  );
}

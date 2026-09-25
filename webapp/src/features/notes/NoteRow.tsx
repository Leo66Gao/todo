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
        className="block w-full rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-fill/70"
      >
        <div className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{note.title || "Untitled note"}</span>
          <span className="shrink-0 text-2xs text-ink-3">{editedLabel(note.updatedAt).replace("Edited ", "")}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-[18px] text-ink-3">{preview || "No additional text"}</p>
        {((showSubject && subject) || folder) && (
          <div className="mt-1.5 flex items-center gap-3 text-2xs text-ink-3">
            {showSubject && subject && (
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: argbToCss(subject.colorValue) }} />
                {subject.title}
              </span>
            )}
            {folder && (
              <span className="flex items-center gap-1">
                <Folder className="size-3" />
                {folder.name}
              </span>
            )}
          </div>
        )}
      </button>
    </ContextMenu>
  );
}

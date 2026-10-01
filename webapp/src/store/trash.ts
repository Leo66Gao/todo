"use client";

// Recently deleted: tasks and notes are kept for 30 days as synced side
// records (`settings:trash:<kind>:<id>`), so they can be brought back on any
// device. A restored item gets a fresh ID: the cloud keeps a permanent
// tombstone for the old one (deletions always win in sync), so reusing it
// would be deleted again as soon as the tombstone arrived. Links that pointed
// at the old ID (a milestone's parent, note links, version history) follow.

import { useMemo } from "react";
import { decodeNote, decodeTask, encodeNote, encodeTask, recordFits, uuid, type StudyNote, type Task } from "@/lib/model";
import { versionsKey, type Version } from "@/lib/versions";
import { noteHref } from "@/ui/RichText";
import { addNote, addTask, deleteNote, deleteTask, readSide, updateNote, updateTask, useWorkspace, writeSide } from "./workspace";

export const TRASH_PREFIX = "settings:trash:";
export const TRASH_DAYS = 30;

export interface TrashEntry {
  kind: "task" | "note";
  id: string;
  title: string;
  deletedAt: number;
  /** Where it was in its list, to put it back in place. */
  index: number;
  /** The encoded task or note. */
  item: unknown;
  /** A note's version history, when it fits alongside the note. */
  versions?: Version[];
}

const keyOf = (kind: TrashEntry["kind"], id: string) => `${TRASH_PREFIX}${kind}:${id}`;

/** Moves a task to the trash and deletes it. */
export function trashTask(task: Task) {
  const index = useWorkspace.getState().tasks.findIndex((t) => t.id === task.id);
  writeSide(keyOf("task", task.id), {
    kind: "task",
    id: task.id,
    title: task.title,
    deletedAt: Date.now(),
    index,
    item: encodeTask(task),
  } satisfies TrashEntry);
  deleteTask(task.id);
}

/** Moves a note (with its history, when it fits) to the trash and deletes it. */
export function trashNote(note: StudyNote) {
  const index = useWorkspace.getState().notes.findIndex((n) => n.id === note.id);
  const entry: TrashEntry = {
    kind: "note",
    id: note.id,
    title: note.title,
    deletedAt: Date.now(),
    index,
    item: encodeNote(note),
  };
  const versions = readSide<{ versions?: Version[] }>(versionsKey(note.id), {}).versions;
  if (versions?.length && recordFits({ ...entry, versions } as never)) entry.versions = versions;
  writeSide(keyOf("note", note.id), entry);
  deleteNote(note.id);
}

/** Everything in the trash, newest first. */
export function useTrash(): TrashEntry[] {
  const side = useWorkspace((s) => s.side);
  return useMemo(() => {
    const out: TrashEntry[] = [];
    for (const [key, payload] of Object.entries(side)) {
      if (!key.startsWith(TRASH_PREFIX)) continue;
      try {
        out.push(JSON.parse(payload) as TrashEntry);
      } catch {
        // An unreadable entry stays stored, just not listed.
      }
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt);
  }, [side]);
}

export function trashEntry(kind: TrashEntry["kind"], id: string): TrashEntry | null {
  return readSide<TrashEntry | null>(keyOf(kind, id), null);
}

/** Brings an item back under a new ID. Returns that ID, or null if it's gone. */
export function restoreFromTrash(kind: TrashEntry["kind"], id: string): string | null {
  const entry = trashEntry(kind, id);
  if (!entry) return null;
  const restored = kind === "task" ? restoreTask(entry) : restoreNote(entry);
  writeSide(keyOf(kind, id), null);
  return restored;
}

function restoreTask(entry: TrashEntry): string {
  const { tasks, projects } = useWorkspace.getState();
  const old = decodeTask(entry.item as never);
  const id = uuid();
  const task: Task = {
    ...old,
    id,
    projectId: old.projectId && projects.some((p) => p.id === old.projectId) ? old.projectId : null,
    parentTaskId: old.parentTaskId && tasks.some((t) => t.id === old.parentTaskId) ? old.parentTaskId : null,
    // Never reuse the deleted calendar event.
    googleEventId: null,
    calendarEventRevision: old.calendarEventRevision + 1,
  };
  addTask(task, entry.index);
  for (const child of tasks) if (child.parentTaskId === entry.id) updateTask({ ...child, parentTaskId: id });
  return id;
}

function restoreNote(entry: TrashEntry): string {
  const { notes, projects, folders } = useWorkspace.getState();
  const old = decodeNote(entry.item as never);
  const id = uuid();
  const note: StudyNote = {
    ...old,
    id,
    subjectId: old.subjectId && projects.some((p) => p.id === old.subjectId) ? old.subjectId : null,
    folderId: old.folderId && folders.some((f) => f.id === old.folderId) ? old.folderId : null,
  };
  addNote(note, entry.index);
  if (entry.versions?.length) writeSide(versionsKey(id), { versions: entry.versions });
  // Links from other notes follow it to its new ID.
  const from = `"${noteHref(entry.id)}"`;
  const to = `"${noteHref(id)}"`;
  for (const other of notes) {
    if (other.content.includes(from)) updateNote({ ...other, content: other.content.split(from).join(to) });
  }
  return id;
}

/** Deletes an item from the trash for good. */
export function purgeFromTrash(kind: TrashEntry["kind"], id: string) {
  writeSide(keyOf(kind, id), null);
}

export function emptyTrash() {
  for (const key of Object.keys(useWorkspace.getState().side)) if (key.startsWith(TRASH_PREFIX)) writeSide(key, null);
}

/** Clears out what has been in the trash longer than 30 days. */
export function expireTrash(now = Date.now()) {
  const cutoff = now - TRASH_DAYS * 86_400_000;
  for (const [key, payload] of Object.entries(useWorkspace.getState().side)) {
    if (!key.startsWith(TRASH_PREFIX)) continue;
    try {
      if ((JSON.parse(payload) as TrashEntry).deletedAt < cutoff) writeSide(key, null);
    } catch {
      // Left as is.
    }
  }
}

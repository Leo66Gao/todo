// The workspace data model, mirroring the Flutter app's models field for
// field. Records are decoded into these shapes and re-encoded with the same
// key order Dart uses, so either app can read what the other wrote. Fields
// this build does not know about are carried along untouched in `extra`.

import {
  decodePriority,
  decodeTaskType,
  encodePriority,
  encodeTaskType,
  parseDartDate,
  toDartIso,
  type Priority,
  type TaskType,
} from "./dart";

type Json = Record<string, unknown>;

export interface Subtask {
  id: string;
  title: string;
  isDone: boolean;
  date: Date | null;
  /** Per-milestone overrides; null inherits from the parent assignment. */
  priority: Priority | null;
  difficulty: number | null;
  extra?: Json;
}

export interface Task {
  id: string;
  title: string;
  /** Quill delta JSON, or plain text written by older builds. */
  notes: string;
  isDone: boolean;
  date: Date;
  type: TaskType;
  priority: Priority;
  difficulty: number;
  durationMinutes: number;
  projectId: string | null;
  parentTaskId: string | null;
  /** Label name, or "General" for none. */
  category: string;
  startTime: Date | null;
  remainingMinutes: number;
  subtasks: Subtask[];
  googleEventId: string | null;
  calendarEventRevision: number;
  isConflictCopy: boolean;
  extra?: Json;
  /** Set on the virtual tasks generated for dated subtasks. */
  milestone?: { parentId: string; subtaskId: string };
}

/** Legacy records use difficulty 1 for an unset field. A selected Level 1
 * keeps the same numeric value for Flutter compatibility and carries a flag. */
export function hasExplicitDifficulty(task: Pick<Task, "difficulty" | "extra">): boolean {
  return task.difficulty > 1 || (task.difficulty === 1 && task.extra?.difficultySelected === true);
}

export interface Project {
  id: string;
  title: string;
  colorValue: number;
  /** A short description shown under the subject's name. */
  description?: string;
  /** Course pages, readings, videos and other material, in the order shown. */
  materials?: Material[];
  /** The exam's day, "YYYY-MM-DD" (a calendar day, the same in every time zone). */
  examDate?: string;
  extra?: Json;
}

/** A subject's material: a link, or a plain item such as a textbook chapter. */
export interface Material {
  id: string;
  title: string;
  url?: string;
  /** A file on a computer, e.g. "/Users/leo/Physics/notes.pdf" (shown, and opened where the file was picked). */
  path?: string;
  /** A line of detail, such as "Chapters 3–5" or a password hint. */
  detail?: string;
  addedAt: number;
}

export interface NoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storagePath: string | null;
  downloadUrl: string | null;
}

export interface StudyNote {
  id: string;
  title: string;
  content: string;
  subjectId: string | null;
  folderId: string | null;
  attachments: NoteAttachment[];
  createdAt: Date;
  updatedAt: Date;
  /** When the note was pinned; pinned notes sit at the top of lists. */
  pinnedAt?: number;
  extra?: Json;
}

export interface SubjectFolder {
  id: string;
  name: string;
  subjectId: string | null;
  createdAt: Date;
  extra?: Json;
}

export interface TaskLabel {
  id: string;
  name: string;
  colorValue: number;
}

export type FieldId =
  | "type"
  | "date"
  | "time"
  | "notes"
  | "duration"
  | "difficulty"
  | "priority"
  | "subject"
  | "labels";

export const DEFAULT_FIELD_ORDER: FieldId[] = [
  "type",
  "date",
  "time",
  "notes",
  "duration",
  "difficulty",
  "priority",
  "subject",
  "labels",
];

export type ThemeMode = "system" | "light" | "dark";

export interface WorkspaceSettings {
  themeMode: ThemeMode;
  showTaskType: boolean;
  showDate: boolean;
  showTime: boolean;
  showNotes: boolean;
  showDuration: boolean;
  showDifficulty: boolean;
  showPriority: boolean;
  showSubject: boolean;
  showLabels: boolean;
  labels: TaskLabel[];
  fieldOrder: FieldId[];
  /** Google Calendar alerts for the events tasks are exported as (off when the app's own reminders are enough). */
  calendarAlerts: boolean;
  extra?: Json;
}

export const FIELD_VISIBILITY_KEY: Record<FieldId, keyof WorkspaceSettings> = {
  type: "showTaskType",
  date: "showDate",
  time: "showTime",
  notes: "showNotes",
  duration: "showDuration",
  difficulty: "showDifficulty",
  priority: "showPriority",
  subject: "showSubject",
  labels: "showLabels",
};

export const isFieldVisible = (s: WorkspaceSettings, id: FieldId) =>
  s[FIELD_VISIBILITY_KEY[id]] === true;

export const defaultSettings = (): WorkspaceSettings => ({
  themeMode: "system",
  showTaskType: true,
  showDate: true,
  showTime: true,
  showNotes: true,
  showDuration: true,
  showDifficulty: true,
  showPriority: true,
  showSubject: true,
  showLabels: true,
  labels: [],
  fieldOrder: [...DEFAULT_FIELD_ORDER],
  calendarAlerts: true,
});

// ---------------------------------------------------------------------------
// Decoding (tolerant where Dart is tolerant, strict where Dart would throw)

function requireString(json: Json, key: string): string {
  const value = json[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}`);
  return value;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

function extras(json: Json, known: readonly string[]): Json | undefined {
  const out: Json = {};
  let any = false;
  for (const key of Object.keys(json)) {
    if (!known.includes(key)) {
      out[key] = json[key];
      any = true;
    }
  }
  return any ? out : undefined;
}

const SUBTASK_KEYS = ["id", "title", "isDone", "date", "priority", "difficulty"] as const;

export function decodeSubtask(json: Json): Subtask {
  const date = json.date == null ? null : parseDartDate(json.date);
  if (json.date != null && date == null) throw new Error("Bad subtask date");
  return {
    id: requireString(json, "id"),
    title: requireString(json, "title"),
    isDone: bool(json.isDone, false),
    date,
    priority: json.priority == null ? null : decodePriority(json.priority),
    difficulty: typeof json.difficulty === "number" ? Math.trunc(json.difficulty) : null,
    extra: extras(json, SUBTASK_KEYS),
  };
}

const TASK_KEYS = [
  "id",
  "title",
  "notes",
  "isDone",
  "date",
  "type",
  "priority",
  "difficulty",
  "durationMinutes",
  "projectId",
  "parentTaskId",
  "category",
  "startTime",
  "remainingMinutes",
  "subtasks",
  "googleEventId",
  "calendarEventRevision",
  "isConflictCopy",
] as const;

export function decodeTask(json: Json): Task {
  const date = parseDartDate(json.date);
  if (!date) throw new Error("Bad task date");
  const start = json.startTime == null ? null : parseDartDate(json.startTime);
  if (json.startTime != null && !start) throw new Error("Bad start time");
  const subs = Array.isArray(json.subtasks) ? json.subtasks : [];
  return {
    id: requireString(json, "id"),
    title: requireString(json, "title"),
    notes: str(json.notes) ?? "",
    isDone: bool(json.isDone, false),
    date,
    type: decodeTaskType(json.type),
    priority: decodePriority(json.priority) ?? "none",
    difficulty: int(json.difficulty, 1),
    durationMinutes: int(json.durationMinutes, 0),
    projectId: str(json.projectId),
    parentTaskId: str(json.parentTaskId),
    category: str(json.category) ?? "General",
    startTime: start,
    remainingMinutes: int(json.remainingMinutes, 0),
    subtasks: subs.map((s) => decodeSubtask(s as Json)),
    googleEventId: str(json.googleEventId),
    calendarEventRevision: int(json.calendarEventRevision, 0),
    isConflictCopy: bool(json.isConflictCopy, false),
    extra: extras(json, TASK_KEYS),
  };
}

export function decodeProject(json: Json): Project {
  if (typeof json.colorValue !== "number") throw new Error("Bad project colour");
  return {
    id: requireString(json, "id"),
    title: requireString(json, "title"),
    colorValue: json.colorValue,
    ...(typeof json.description === "string" && json.description ? { description: json.description } : {}),
    ...(Array.isArray(json.materials) ? { materials: json.materials.filter(isMaterial) } : {}),
    ...(typeof json.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(json.examDate) ? { examDate: json.examDate } : {}),
    extra: extras(json, ["id", "title", "colorValue", "description", "materials", "examDate"]),
  };
}

function isMaterial(value: unknown): value is Material {
  const m = value as Material;
  return !!m && typeof m === "object" && typeof m.id === "string" && typeof m.title === "string" && typeof m.addedAt === "number";
}

function decodeAttachment(json: Json): NoteAttachment {
  return {
    id: requireString(json, "id"),
    noteId: requireString(json, "noteId"),
    fileName: str(json.fileName) ?? "Attachment",
    contentType: str(json.contentType) ?? "application/octet-stream",
    sizeBytes: int(json.sizeBytes, 0),
    storagePath: str(json.storagePath),
    downloadUrl: str(json.downloadUrl),
  };
}

const NOTE_KEYS = [
  "id",
  "title",
  "content",
  "subjectId",
  "folderId",
  "attachments",
  "createdAt",
  "updatedAt",
  "pinnedAt",
] as const;

export function decodeNote(json: Json): StudyNote {
  const createdAt = parseDartDate(json.createdAt) ?? new Date();
  const raw = Array.isArray(json.attachments) ? json.attachments : [];
  return {
    id: requireString(json, "id"),
    title: str(json.title) ?? "Untitled note",
    content: str(json.content) ?? "",
    subjectId: str(json.subjectId),
    folderId: str(json.folderId),
    attachments: raw
      .filter((a): a is Json => typeof a === "object" && a !== null)
      .map(decodeAttachment),
    createdAt,
    updatedAt: parseDartDate(json.updatedAt) ?? createdAt,
    ...(typeof json.pinnedAt === "number" ? { pinnedAt: json.pinnedAt } : {}),
    extra: extras(json, NOTE_KEYS),
  };
}

export function decodeFolder(json: Json): SubjectFolder {
  return {
    id: requireString(json, "id"),
    name: str(json.name) ?? "Folder",
    subjectId: str(json.subjectId),
    createdAt: parseDartDate(json.createdAt) ?? new Date(),
    extra: extras(json, ["id", "name", "subjectId", "createdAt"]),
  };
}

const SETTINGS_KEYS = [
  "themeMode",
  "showTaskType",
  "showDate",
  "showTime",
  "showNotes",
  "showDuration",
  "showDifficulty",
  "showPriority",
  "showSubject",
  "showLabels",
  "labels",
  "fieldOrder",
  "calendarAlerts",
] as const;

export function decodeSettings(json: Json): WorkspaceSettings {
  // Keep known ids in the saved order, then append anything missing so an
  // older or hand-edited payload can never drop a field.
  const seen = new Set<string>();
  const order: FieldId[] = [];
  if (Array.isArray(json.fieldOrder)) {
    for (const id of json.fieldOrder) {
      if (
        typeof id === "string" &&
        (DEFAULT_FIELD_ORDER as string[]).includes(id) &&
        !seen.has(id)
      ) {
        seen.add(id);
        order.push(id as FieldId);
      }
    }
  }
  for (const id of DEFAULT_FIELD_ORDER) if (!seen.has(id)) order.push(id);
  const labels = Array.isArray(json.labels)
    ? json.labels
        .filter((l): l is Json => typeof l === "object" && l !== null)
        .map((l) => ({
          id: str(l.id) ?? "",
          name: str(l.name) ?? "Label",
          colorValue: typeof l.colorValue === "number" ? l.colorValue : 0xff2196f3,
        }))
    : [];
  const theme = json.themeMode;
  return {
    themeMode: theme === "light" || theme === "dark" ? theme : "system",
    showTaskType: bool(json.showTaskType, true),
    showDate: bool(json.showDate, true),
    showTime: bool(json.showTime, true),
    showNotes: bool(json.showNotes, true),
    showDuration: bool(json.showDuration, true),
    showDifficulty: bool(json.showDifficulty, true),
    showPriority: bool(json.showPriority, true),
    showSubject: bool(json.showSubject, true),
    showLabels: bool(json.showLabels, true),
    labels,
    fieldOrder: order,
    calendarAlerts: bool(json.calendarAlerts, true),
    extra: extras(json, SETTINGS_KEYS),
  };
}

// ---------------------------------------------------------------------------
// Encoding (Dart key order; extras appended)

const dateOrNull = (d: Date | null) => (d ? toDartIso(d) : null);

export function encodeSubtask(s: Subtask): Json {
  return {
    id: s.id,
    title: s.title,
    isDone: s.isDone,
    date: dateOrNull(s.date),
    priority: s.priority ? encodePriority(s.priority) : null,
    difficulty: s.difficulty,
    ...s.extra,
  };
}

export function encodeTask(t: Task): Json {
  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    isDone: t.isDone,
    date: toDartIso(t.date),
    type: encodeTaskType(t.type),
    priority: encodePriority(t.priority),
    difficulty: t.difficulty,
    durationMinutes: t.durationMinutes,
    projectId: t.projectId,
    parentTaskId: t.parentTaskId,
    category: t.category,
    startTime: dateOrNull(t.startTime),
    remainingMinutes: t.remainingMinutes,
    subtasks: t.subtasks.map(encodeSubtask),
    googleEventId: t.googleEventId,
    calendarEventRevision: t.calendarEventRevision,
    isConflictCopy: t.isConflictCopy,
    ...t.extra,
  };
}

export const encodeProject = (p: Project): Json => ({
  id: p.id,
  title: p.title,
  colorValue: p.colorValue,
  ...(p.description ? { description: p.description } : {}),
  ...(p.materials?.length ? { materials: p.materials } : {}),
  ...(p.examDate ? { examDate: p.examDate } : {}),
  ...p.extra,
});

export const encodeNote = (n: StudyNote): Json => ({
  id: n.id,
  title: n.title,
  content: n.content,
  subjectId: n.subjectId,
  folderId: n.folderId,
  attachments: n.attachments.map((a) => ({
    id: a.id,
    noteId: a.noteId,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    storagePath: a.storagePath,
    downloadUrl: a.downloadUrl,
  })),
  createdAt: toDartIso(n.createdAt),
  updatedAt: toDartIso(n.updatedAt),
  ...(n.pinnedAt ? { pinnedAt: n.pinnedAt } : {}),
  ...n.extra,
});

export const encodeFolder = (f: SubjectFolder): Json => ({
  id: f.id,
  name: f.name,
  subjectId: f.subjectId,
  createdAt: toDartIso(f.createdAt),
  ...f.extra,
});

export const encodeSettings = (s: WorkspaceSettings): Json => ({
  themeMode: s.themeMode,
  showTaskType: s.showTaskType,
  showDate: s.showDate,
  showTime: s.showTime,
  showNotes: s.showNotes,
  showDuration: s.showDuration,
  showDifficulty: s.showDifficulty,
  showPriority: s.showPriority,
  showSubject: s.showSubject,
  showLabels: s.showLabels,
  labels: s.labels.map((l) => ({ id: l.id, name: l.name, colorValue: l.colorValue })),
  fieldOrder: s.fieldOrder,
  // Only stored once turned off, so older apps' payloads stay as they were.
  ...(s.calendarAlerts ? {} : { calendarAlerts: false }),
  ...s.extra,
});

/** Firestore allows ~1 MiB per document; leave room for the envelope. */
export function recordFits(record: Json): boolean {
  return new TextEncoder().encode(JSON.stringify(record)).length <= 650 * 1024;
}

export const uuid = () => crypto.randomUUID();

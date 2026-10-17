// Whole-workspace backups: every synced record (tasks, subjects, notes,
// folders, settings, the source library, note history and Recently deleted)
// in one JSON file, and a restore that brings it all back without duplicates.
//
// Restoring works on the encoded records. Anything that still exists is set
// back to its backed-up version; anything that's gone comes back under a new
// ID, because sync keeps a permanent tombstone for a deleted ID and would
// delete it again. References to a re-added item (a task's subject or parent,
// a note's subject, folder, attachments, links and history) follow its new ID.
// Which new ID each item got is kept (synced), so restoring the same backup
// again sets those copies back instead of adding more.

type Records = Record<string, string>;
type Json = Record<string, unknown>;

export const BACKUP_APP = "todo-workspace";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  records: Records;
}

const ENTITY_KINDS = new Set(["task", "project", "note", "folder"]);
const ORDER = "settings:order";
const SOURCES = "settings:sources";
const VERSIONS = "settings:versions:";
/** For each backed-up item restored under a new ID ("note:<old>"), that ID. */
export const RESTORED = "settings:restoredIds";

export function makeBackup(records: Records, now = new Date()): BackupFile {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), records };
}

/** Reads a backup file, or throws with a reason a person can act on. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn’t a Todo backup (it couldn’t be read as JSON).");
  }
  const file = data as Partial<BackupFile>;
  if (!file || file.app !== BACKUP_APP || typeof file.records !== "object" || file.records == null) {
    throw new Error("That file isn’t a Todo backup.");
  }
  if (typeof file.version !== "number" || file.version > BACKUP_VERSION) {
    throw new Error("This backup was made by a newer version of Todo. Update the app first.");
  }
  for (const [key, value] of Object.entries(file.records)) {
    if (typeof value !== "string") throw new Error(`The backup is damaged (record ${key}).`);
  }
  return file as BackupFile;
}

const parse = (payload: string): Json | null => {
  try {
    const value = JSON.parse(payload);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
};

export interface MergeResult {
  records: Records;
  /** Items set back to their backed-up version. */
  updated: number;
  /** Items that had been deleted (or never synced here) and were re-added. */
  added: number;
}

/** Merges a backup into the current records (see the notes at the top). */
export function mergeBackup(current: Records, backup: Records, newId: () => string = () => crypto.randomUUID()): MergeResult {
  const ids = new Map<string, string>();
  /** Old IDs whose restored copy is still there: set back, not added again. */
  const again = new Set<string>();
  const restored: Record<string, string> = { ...readMap(current[RESTORED]) };
  for (const key of Object.keys(backup)) {
    const [kind, ...rest] = key.split(":");
    if (!ENTITY_KINDS.has(kind) || key in current) continue;
    const id = rest.join(":");
    const prior = restored[key];
    if (prior && `${kind}:${prior}` in current) {
      ids.set(id, prior);
      again.add(id);
    } else {
      // (Gone too, when it was restored before and deleted since: a new copy.)
      const fresh = newId();
      ids.set(id, fresh);
      restored[key] = fresh;
    }
  }
  const remap = (id: unknown) => (typeof id === "string" ? (ids.get(id) ?? id) : id);
  const linkMoves = [...ids].map(([from, to]) => [`/note?id=${encodeURIComponent(from)}`, `/note?id=${encodeURIComponent(to)}`]);
  const relink = (content: unknown) =>
    typeof content === "string" ? linkMoves.reduce((text, [from, to]) => text.split(`"${from}"`).join(`"${to}"`), content) : content;
  const relinkVersions = (payload: string) => {
    const value = linkMoves.length ? parse(payload) : null;
    if (!value || !Array.isArray(value.versions)) return payload;
    return JSON.stringify({ ...value, versions: value.versions.map((v) => (v && typeof v === "object" ? { ...(v as Json), content: relink((v as Json).content) } : v)) });
  };

  const out: Records = { ...current };
  let updated = 0;
  let added = 0;
  for (const [key, payload] of Object.entries(backup)) {
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    if (ENTITY_KINDS.has(kind)) {
      const value = parse(payload);
      if (!value) continue;
      const fresh = ids.has(id) && !again.has(id);
      const target = `${kind}:${ids.get(id) ?? id}`;
      const next: Json = { ...value, id: remap(value.id) };
      if (kind === "task") {
        next.projectId = remap(value.projectId);
        next.parentTaskId = remap(value.parentTaskId);
        if (again.has(id)) {
          // The restored copy keeps its own calendar event.
          const copy = parse(current[target]);
          next.googleEventId = copy?.googleEventId ?? null;
          next.calendarEventRevision = copy?.calendarEventRevision ?? 0;
        } else if (fresh) {
          // A re-added task never reuses a deleted calendar event.
          next.googleEventId = null;
          next.calendarEventRevision = (typeof value.calendarEventRevision === "number" ? value.calendarEventRevision : 0) + 1;
        }
      } else if (kind === "note") {
        next.subjectId = remap(value.subjectId);
        next.folderId = remap(value.folderId);
        next.content = relink(value.content);
        if (Array.isArray(value.attachments)) {
          next.attachments = value.attachments.map((a) => (a && typeof a === "object" ? { ...(a as Json), noteId: remap((a as Json).noteId) } : a));
        }
      } else if (kind === "folder") {
        next.subjectId = remap(value.subjectId);
      }
      const encoded = JSON.stringify(next);
      out[target] = encoded;
      if (fresh) added++;
      else if (current[target] !== (again.has(id) ? encoded : payload)) updated++;
      continue;
    }
    // (This device's record of restored IDs is newer than any backup's.)
    if (key === ORDER || key === RESTORED) continue;
    if (key === SOURCES) {
      out[key] = mergeSources(current[key], payload);
      continue;
    }
    if (key.startsWith(VERSIONS)) {
      // Older versions' links to a re-added note follow it as well.
      out[`${VERSIONS}${remap(key.slice(VERSIONS.length))}`] = relinkVersions(payload);
      continue;
    }
    // Settings, tags, Recently deleted and anything newer: the backed-up value.
    out[key] = payload;
  }

  if (Object.keys(restored).length) out[RESTORED] = JSON.stringify(restored);

  // Current links to a re-added note follow it too.
  if (linkMoves.length) {
    for (const [key, payload] of Object.entries(out)) {
      if (key.startsWith(VERSIONS)) {
        out[key] = relinkVersions(payload);
        continue;
      }
      if (!key.startsWith("note:")) continue;
      const value = parse(payload);
      if (!value || typeof value.content !== "string") continue;
      const content = relink(value.content);
      if (content !== value.content) out[key] = JSON.stringify({ ...value, content });
    }
  }

  // Task order: the backup's order first, then tasks it doesn't know about.
  const backupOrder = readList(backup[ORDER]).map((id) => remap(id) as string);
  const currentOrder = readList(current[ORDER]);
  const order = [...new Set([...backupOrder, ...currentOrder])].filter((id) => `task:${id}` in out);
  for (const key of Object.keys(out)) if (key.startsWith("task:") && !order.includes(key.slice(5))) order.push(key.slice(5));
  out[ORDER] = JSON.stringify(order);
  return { records: out, updated, added };
}

function readMap(payload: string | undefined): Record<string, string> {
  const value = payload ? parse(payload) : null;
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function readList(payload: string | undefined): string[] {
  if (!payload) return [];
  try {
    const value = JSON.parse(payload);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** The source library: sources from both, the backed-up copy winning. */
function mergeSources(current: string | undefined, backup: string): string {
  const a = current ? parse(current) : null;
  const b = parse(backup);
  if (!b) return current ?? backup;
  if (!a) return backup;
  const list = (v: Json) => (Array.isArray(v.sources) ? (v.sources as Json[]) : []);
  const byId = new Map<unknown, Json>();
  for (const s of list(a)) byId.set(s.id, s);
  for (const s of list(b)) byId.set(s.id, s);
  return JSON.stringify({ ...a, ...b, sources: [...byId.values()] });
}

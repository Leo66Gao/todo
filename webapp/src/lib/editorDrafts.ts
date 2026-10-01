// A small synchronous journal bridges the editor debounce and IndexedDB save.
// Entries are isolated by account and editor; an older acknowledgement cannot
// clear a newer draft (or another tab's draft).
export type DraftKind = "note" | "task";
export type DraftField = "title" | "content" | "notes";
export interface EditorDraft {
  version: 1;
  owner: string;
  kind: DraftKind;
  recordId: string;
  journalId: string;
  operationId: string;
  updatedAt: number;
  base: Record<string, unknown>;
  patch: Partial<Record<DraftField, string>>;
}
const PREFIX = "todo.editorDraft.v1:";
const keyOf = (entry: EditorDraft) => `${PREFIX}${encodeURIComponent(entry.owner)}:${entry.journalId}`;
const allowed = (kind: DraftKind) => kind === "note" ? ["title", "content"] : ["notes"];

export function changeDraft(previous: EditorDraft | null, owner: string, kind: DraftKind, base: Record<string, unknown>, journalId: string, field: DraftField, value: string, basedOn: string): EditorDraft {
  if (!allowed(kind).includes(field) || typeof base.id !== "string") throw new Error("Invalid editor draft.");
  const snapshot = previous ? { ...previous.base } : { ...base };
  // Each field remembers what was actually on screen when its edit began.
  if (!previous || !(field in previous.patch)) snapshot[field] = basedOn;
  const patch = { ...previous?.patch, [field]: value };
  return { version: 1, owner, kind, recordId: base.id, journalId, operationId: crypto.randomUUID(), updatedAt: Date.now(), base: snapshot, patch };
}

function parse(raw: string | null): EditorDraft | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as EditorDraft;
    if (entry?.version !== 1 || !["note", "task"].includes(entry.kind) || typeof entry.owner !== "string" || typeof entry.recordId !== "string" || typeof entry.journalId !== "string" || typeof entry.operationId !== "string" || !Number.isFinite(entry.updatedAt)) return null;
    if (!entry.base || typeof entry.base !== "object" || Array.isArray(entry.base) || entry.base.id !== entry.recordId || !entry.patch || typeof entry.patch !== "object" || Array.isArray(entry.patch)) return null;
    if (!Object.entries(entry.patch).every(([field, value]) => allowed(entry.kind).includes(field) && typeof value === "string" && typeof entry.base[field] === "string")) return null;
    return entry;
  } catch { return null; }
}

export function storeDraft(entry: EditorDraft) {
  if (typeof window === "undefined") return;
  // Deliberately report storage failures to the editor instead of silently
  // claiming that the draft is durable.
  window.localStorage.setItem(keyOf(entry), JSON.stringify(entry));
}

export function readDrafts(owner: string): EditorDraft[] {
  if (typeof window === "undefined") return [];
  const entries: EditorDraft[] = [];
  const storage = window.localStorage;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const entry = parse(storage.getItem(key));
    if (entry?.owner === owner && key === keyOf(entry)) entries.push(entry);
  }
  return entries.sort((a, b) => a.updatedAt - b.updatedAt);
}

export function acknowledgeDraft(entry: EditorDraft) {
  if (typeof window === "undefined") return;
  const key = keyOf(entry);
  if (parse(window.localStorage.getItem(key))?.operationId === entry.operationId) window.localStorage.removeItem(key);
}

export function discardRecordDrafts(owner: string, kind: DraftKind, recordId: string) {
  for (const entry of readDrafts(owner)) if (entry.kind === kind && entry.recordId === recordId) acknowledgeDraft(entry);
}

/** Merge only edited fields. A concurrent edit of one of those fields forks. */
export function resolveDraft(entry: EditorDraft, current: Record<string, unknown> | null) {
  const conflicted = !current || Object.entries(entry.patch).some(([field, value]) => current[field] !== entry.base[field] && current[field] !== value);
  return { value: { ...(current ?? entry.base), ...entry.patch }, conflicted };
}

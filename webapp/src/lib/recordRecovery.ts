import { toDartIso } from "./dart";

export function payloadFits(payload: string): boolean {
  return payload.length <= 690_000 && new TextEncoder().encode(payload).length <= 900_000;
}

/** Preserve a competing draft as ordinary records that remain visible and exportable. */
export function recoveryRecords(key: string, payload: string, id: string): [string, string][] {
  const kind = key.split(":")[0];
  if (["task", "note", "project", "folder"].includes(kind)) {
    try {
      const data = JSON.parse(payload);
      if (data && typeof data === "object" && !Array.isArray(data)) {
        data.id = id;
        const name = kind === "folder" ? "name" : "title";
        data[name] = `${data[name] ?? "Untitled"} (conflict copy)`;
        if (kind === "task") {
          data.googleEventId = null;
          data.calendarEventRevision = 0;
          data.isConflictCopy = true;
        }
        const value = JSON.stringify(data);
        if (payloadFits(value)) return [[`${kind}:${id}`, value]];
      }
    } catch { /* Preserve malformed payloads as text below. */ }
  }
  // Escape-heavy JSON and multi-byte text can exceed one cloud document.
  // Small parts preserve the entire original value without truncating it.
  const result: [string, string][] = [];
  const parts = Math.max(1, Math.ceil(payload.length / 100_000));
  const now = toDartIso(new Date());
  for (let part = 0; part < parts; part++) {
    const noteId = part === 0 ? id : `${id}-${part}`;
    result.push([`note:${noteId}`, JSON.stringify({
      id: noteId, title: `Sync conflict: ${key}${parts > 1 ? ` (${part + 1}/${parts})` : ""}`,
      content: payload.slice(part * 100_000, (part + 1) * 100_000),
      createdAt: now, updatedAt: now,
      recovery: { originalKey: key, group: id, part, parts },
    })]);
  }
  return result;
}

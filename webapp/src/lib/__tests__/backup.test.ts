import { expect, it } from "vitest";
import { makeBackup, mergeBackup, parseBackup } from "../backup";

const task = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id, title: id, projectId: null, parentTaskId: null, googleEventId: null, calendarEventRevision: 0, ...extra });
const note = (id: string, content = "[]", extra: Record<string, unknown> = {}) => JSON.stringify({ id, title: id, content, subjectId: null, folderId: null, attachments: [], ...extra });
let n = 0;
const ids = () => `new-${++n}`;

it("rejects files that aren't backups, and newer formats", () => {
  expect(() => parseBackup("not json")).toThrow("isn’t a Todo backup");
  expect(() => parseBackup(JSON.stringify({ app: "other", records: {} }))).toThrow("isn’t a Todo backup");
  expect(() => parseBackup(JSON.stringify({ app: "todo-workspace", version: 99, records: {} }))).toThrow("newer version");
  const file = makeBackup({ "task:a": task("a") });
  expect(parseBackup(JSON.stringify(file)).records).toEqual(file.records);
});

it("sets existing items back and re-adds deleted ones under new IDs, with their links", () => {
  n = 0;
  const backup = {
    "project:p": JSON.stringify({ id: "p", title: "History" }),
    "task:kept": task("kept", { title: "Old title" }),
    "task:gone": task("gone", { projectId: "p", googleEventId: "evt", calendarEventRevision: 2 }),
    "note:gone-note": note("gone-note", "[]", { subjectId: "p", attachments: [{ id: "f", noteId: "gone-note" }] }),
    "note:linker": note("linker", JSON.stringify([{ insert: "see", attributes: { link: "/note?id=gone-note" } }])),
    "settings:versions:gone-note": JSON.stringify({ versions: [1] }),
    "settings:order": JSON.stringify(["gone", "kept"]),
  };
  const current = {
    "project:p": JSON.stringify({ id: "p", title: "History" }),
    "task:kept": task("kept", { title: "New title" }),
    "task:later": task("later"),
    "note:linker": note("linker", JSON.stringify([{ insert: "see", attributes: { link: "/note?id=gone-note" } }])),
    "settings:order": JSON.stringify(["later", "kept"]),
  };
  const { records, updated, added } = mergeBackup(current, backup, ids);
  expect(added).toBe(2);
  expect(updated).toBe(1);
  expect(JSON.parse(records["task:kept"]).title).toBe("Old title");
  // Deleted IDs stay deleted; the copies are new.
  expect(records["task:gone"]).toBeUndefined();
  const restored = JSON.parse(records["task:new-1"]);
  expect(restored).toMatchObject({ id: "new-1", projectId: "p", googleEventId: null, calendarEventRevision: 3 });
  const restoredNote = JSON.parse(records["note:new-2"]);
  expect(restoredNote).toMatchObject({ id: "new-2", subjectId: "p", attachments: [{ id: "f", noteId: "new-2" }] });
  expect(records["settings:versions:new-2"]).toBe(backup["settings:versions:gone-note"]);
  expect(records["note:linker"]).toContain("/note?id=new-2");
  // Things made since the backup stay, and every task is in the order.
  expect(records["task:later"]).toBe(current["task:later"]);
  expect(JSON.parse(records["settings:order"])).toEqual(["new-1", "kept", "later"]);
});

it("merges the source library instead of replacing newer sources", () => {
  const current = { "settings:sources": JSON.stringify({ style: "apa", sources: [{ id: "a", title: "Now" }, { id: "b", title: "Newer" }] }) };
  const backup = { "settings:sources": JSON.stringify({ style: "mla", sources: [{ id: "a", title: "Then" }] }) };
  const merged = JSON.parse(mergeBackup(current, backup, ids).records["settings:sources"]);
  expect(merged.sources).toEqual([{ id: "a", title: "Then" }, { id: "b", title: "Newer" }]);
});

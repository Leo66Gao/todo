import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { acknowledgeDraft, changeDraft, readDrafts, resolveDraft, storeDraft } from "../editorDrafts";

let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  storage = new Map();
  vi.stubGlobal("window", { localStorage: {
    get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); },
  } });
});
afterEach(() => vi.unstubAllGlobals());
const base = { id: "n", title: "Essay", content: "Original", createdAt: "2026-09-30T00:00:00.000", updatedAt: "2026-09-30T00:00:00.000" };

it("recovers the last keystroke before the debounce, isolated by account", () => {
  const entry = changeDraft(null, "A", "note", base, "editor-a", "content", "Last keystroke", base.content);
  storeDraft(entry);
  expect(readDrafts("A")[0].patch.content).toBe("Last keystroke");
  expect(readDrafts("B")).toEqual([]);
  expect(resolveDraft(readDrafts("A")[0], base)).toMatchObject({ conflicted: false, value: { content: "Last keystroke" } });
});

it("an old save cannot acknowledge newer typing or a sibling tab's journal", () => {
  const first = changeDraft(null, "A", "note", base, "editor-a", "content", "First", base.content);
  const next = changeDraft(first, "A", "note", base, "editor-a", "content", "Second", base.content);
  const sibling = changeDraft(null, "A", "note", base, "editor-b", "content", "Sibling", base.content);
  storeDraft(first); storeDraft(next); storeDraft(sibling); acknowledgeDraft(first);
  expect(readDrafts("A").map((entry) => entry.patch.content)).toEqual(["Second", "Sibling"]);
  acknowledgeDraft(next);
  expect(readDrafts("A").map((entry) => entry.patch.content)).toEqual(["Sibling"]);
});

it("merges other remote fields, forks a changed edited field, and handles deletion", () => {
  const entry = changeDraft(null, "", "note", base, "editor", "content", "My draft", base.content);
  expect(resolveDraft(entry, { ...base, title: "Remote title" })).toMatchObject({ conflicted: false, value: { title: "Remote title", content: "My draft" } });
  expect(resolveDraft(entry, { ...base, content: "Remote content" }).conflicted).toBe(true);
  expect(resolveDraft(entry, null).conflicted).toBe(true);
  expect(resolveDraft(entry, { ...base, content: "My draft" }).conflicted).toBe(false);
});

it("keeps the first edit's base across later keystrokes and validates journal contents", () => {
  const first = changeDraft(null, "", "note", base, "editor", "content", "First", base.content);
  const next = changeDraft(first, "", "note", { ...base, content: "Remote" }, "editor", "content", "Second", "Remote");
  expect(next.base.content).toBe(base.content);
  expect(resolveDraft(next, { ...base, content: "Remote" }).conflicted).toBe(true);
  storage.set("todo.editorDraft.v1::corrupt", JSON.stringify({ ...next, journalId: "corrupt", patch: { content: {} } }));
  expect(readDrafts("")).toEqual([]);
  expect(storage.size).toBe(1);
});

it("commits a recovered draft durably without overwriting a concurrent note", async () => {
  const ws = await import("@/store/workspace");
  const { decodeNote } = await import("../model");
  const entry = changeDraft(null, "", "note", base, "editor", "content", "Recovered draft", base.content);
  storeDraft(entry);
  ws.useWorkspace.setState({ user: null, isLoading: false, notes: [decodeNote({ ...base, content: "Other device" })], tasks: [], side: {} });
  const result = ws.saveEditorDraft(readDrafts("")[0]);
  expect(result).toMatchObject({ saved: true, conflicted: true, id: entry.operationId });
  await ws.flushWorkspaceSave();
  const { readGuestCache } = await import("../deviceCache");
  const cache = await readGuestCache();
  expect(JSON.parse(cache!.records["note:n"]).content).toBe("Other device");
  expect(JSON.parse(cache!.records[`note:${result.id}`]).content).toBe("Recovered draft");
  expect(readDrafts("")).toEqual([]);
});

it("preserves an oversized editor draft instead of clearing it on a rejected save", async () => {
  const ws = await import("@/store/workspace");
  const { decodeNote } = await import("../model");
  const entry = changeDraft(null, "", "note", base, "editor", "content", "界".repeat(240000), base.content);
  storeDraft(entry);
  ws.useWorkspace.setState({ user: null, notes: [decodeNote(base)] });
  expect(ws.saveEditorDraft(entry).saved).toBe(false);
  expect(readDrafts("")[0].patch.content).toBe(entry.patch.content);
  expect(ws.useWorkspace.getState().notes[0].content).toBe(base.content);
});

it("restores a deleted note into a fresh copy and does not replay into another account", async () => {
  const ws = await import("@/store/workspace");
  const entry = changeDraft(null, "", "note", base, "editor", "content", "Unfinished", base.content);
  storeDraft(entry);
  ws.useWorkspace.setState({ user: { uid: "other", email: null, displayName: null, photoURL: null }, notes: [] });
  expect(ws.saveEditorDraft(entry).saved).toBe(false);
  expect(ws.useWorkspace.getState().notes).toEqual([]);
  expect(readDrafts("")).toHaveLength(1);
  ws.useWorkspace.setState({ user: null });
  const result = ws.saveEditorDraft(entry);
  await ws.flushWorkspaceSave();
  expect(result.id).not.toBe(base.id);
  expect(ws.useWorkspace.getState().notes[0]).toMatchObject({ id: result.id, content: "Unfinished" });
});

it("preserves a concurrent task-note edit without replacing its Calendar event", async () => {
  const ws = await import("@/store/workspace");
  const { encodeTask } = await import("../model");
  const original = ws.newTask({ title: "Essay", date: new Date(2026, 8, 30), notes: "Original", googleEventId: "calendar-original" });
  const entry = changeDraft(null, "", "task", encodeTask(original), "editor", "notes", "My draft", original.notes);
  ws.useWorkspace.setState({ user: null, tasks: [{ ...original, notes: "Remote", durationMinutes: 90 }] });
  const result = ws.saveEditorDraft(entry);
  await ws.flushWorkspaceSave();
  expect(ws.useWorkspace.getState().tasks.find((t) => t.id === original.id)).toMatchObject({ notes: "Remote", googleEventId: "calendar-original" });
  expect(ws.useWorkspace.getState().tasks.find((t) => t.id === result.id)).toMatchObject({ notes: "My draft", googleEventId: null, durationMinutes: 90, isConflictCopy: true });
});

it("deleting the workspace forgets unsaved drafts, so nothing comes back at the next start", async () => {
  const ws = await import("@/store/workspace");
  const { decodeNote } = await import("../model");
  storeDraft(changeDraft(null, "", "note", base, "editor", "content", "Unfinished", base.content));
  ws.useWorkspace.setState({ user: null, isLoading: false, notes: [decodeNote(base)], tasks: [], side: {} });
  await ws.clearWorkspace();
  expect(readDrafts("")).toEqual([]);
  expect(ws.useWorkspace.getState().notes).toEqual([]);
});

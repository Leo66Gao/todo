import { beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

vi.mock("@/ui/toast", () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); },
  } });
});

it("restores a deleted task under a new ID, keeping its milestones attached", async () => {
  const { newTask, useWorkspace } = await import("@/store/workspace");
  const { trashTask, restoreFromTrash, useTrash } = await import("@/store/trash");
  const parent = newTask({ title: "Essay", date: new Date(2026, 9, 1) });
  const child = newTask({ title: "Draft", date: new Date(2026, 9, 1), parentTaskId: parent.id });
  useWorkspace.setState({ tasks: [child, parent], side: {} });
  trashTask(parent);
  expect(useWorkspace.getState().tasks.map((t) => t.id)).toEqual([child.id]);
  expect(Object.keys(useWorkspace.getState().side)).toEqual([`settings:trash:task:${parent.id}`]);

  const id = restoreFromTrash("task", parent.id)!;
  // A synced deletion is a permanent tombstone for the old ID.
  expect(id).not.toBe(parent.id);
  const tasks = useWorkspace.getState().tasks;
  expect(tasks.map((t) => t.title)).toEqual(["Draft", "Essay"]);
  expect(tasks.find((t) => t.title === "Draft")!.parentTaskId).toBe(id);
  expect(useWorkspace.getState().side).toEqual({});
  expect(useTrash).toBeTypeOf("function");
});

it("restores a note with its history, and links to it follow", async () => {
  const { useWorkspace, writeSide } = await import("@/store/workspace");
  const { trashNote, restoreFromTrash } = await import("@/store/trash");
  const date = new Date(2026, 9, 1);
  const note = { id: "n1", title: "Cells", content: "[]", subjectId: "missing", folderId: null, attachments: [], createdAt: date, updatedAt: date };
  const linker = { ...note, id: "n2", title: "Index", subjectId: null, content: JSON.stringify([{ insert: "Cells", attributes: { link: "/note?id=n1" } }]) };
  useWorkspace.setState({ notes: [note, linker], projects: [], folders: [], side: {} });
  writeSide("settings:versions:n1", { versions: [{ at: 1, title: "Cells", content: "[]" }] });
  trashNote(note);
  expect(useWorkspace.getState().notes.map((n) => n.id)).toEqual(["n2"]);

  const id = restoreFromTrash("note", "n1")!;
  const state = useWorkspace.getState();
  expect(state.notes.map((n) => n.id)).toEqual([id, "n2"]);
  expect(state.notes[0].subjectId).toBeNull();
  expect(state.side[`settings:versions:${id}`]).toContain("Cells");
  expect(state.notes[1].content).toContain(`/note?id=${id}`);
});

it("expires entries after 30 days", async () => {
  const { useWorkspace, writeSide } = await import("@/store/workspace");
  const { expireTrash } = await import("@/store/trash");
  useWorkspace.setState({ side: {} });
  writeSide("settings:trash:task:old", { kind: "task", id: "old", title: "Old", deletedAt: 0, index: 0, item: {} });
  writeSide("settings:trash:task:new", { kind: "task", id: "new", title: "New", deletedAt: 40 * 86_400_000, index: 0, item: {} });
  expireTrash(41 * 86_400_000);
  expect(Object.keys(useWorkspace.getState().side)).toEqual(["settings:trash:task:new"]);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
});
afterEach(() => vi.unstubAllGlobals());

const note = (content: string) => JSON.stringify({ id: "n", title: "Essay", content, createdAt: "2026-09-30T00:00:00.000", updatedAt: "2026-09-30T00:00:00.000" });

it("migrates records and pending edits durably, without crossing accounts", async () => {
  const { WorkspaceCache } = await import("../deviceCache");
  const prefs = await import("../prefs");
  prefs.setString("cloud.A", JSON.stringify({ records: { "note:n": note("saved") }, pending: { "note:n": note("pending") }, bases: { "note:n": note("saved") }, pendingIds: { "note:n": "opA" }, lastSync: 42 }));
  const cache = await new WorkspaceCache().read("A");
  expect(cache?.pendingIds["note:n"]).toBe("opA");
  expect(prefs.getString("cloud.A")).toBeNull();
  const reopened = await new WorkspaceCache().read("A");
  expect(reopened?.records["note:n"]).toBe(note("pending"));
  expect(reopened?.lastSync).toBe(42);
  expect(await new WorkspaceCache().read("B")).toBeNull();
});

it("keeps both offline tab drafts after both tabs close before uploading", async () => {
  const { WorkspaceCache, emptyDeviceCache } = await import("../deviceCache");
  await new WorkspaceCache().save("A", { ...emptyDeviceCache(), records: { "note:n": note("original") } });
  const a = new WorkspaceCache(), b = new WorkspaceCache();
  const sa = (await a.read("A"))!, sb = (await b.read("A"))!;
  await a.save("A", { ...sa, records: { "note:n": note("draft A") }, pending: { "note:n": note("draft A") }, bases: { "note:n": note("original") }, pendingIds: { "note:n": "opA" } });
  await b.save("A", { ...sb, records: { "note:n": note("draft B") }, pending: { "note:n": note("draft B") }, bases: { "note:n": note("original") }, pendingIds: { "note:n": "opB" } });
  // The first tab acknowledging its upload must not erase tab B's operation.
  await a.save("A", { ...sa, records: { "note:n": note("draft A") } });
  const reopened = (await new WorkspaceCache().read("A"))!;
  expect(reopened.pendingIds["note:n"]).toBe("opB");
  expect(Object.values(reopened.pending).map((p) => JSON.parse(p!).content).sort()).toEqual(["draft A", "draft B"]);
});

it("preserves competing signed-out drafts too", async () => {
  const { WorkspaceCache, emptyDeviceCache } = await import("../deviceCache");
  await new WorkspaceCache().save("", { ...emptyDeviceCache(), records: { "note:n": note("original") } });
  const a = new WorkspaceCache(), b = new WorkspaceCache();
  const sa = (await a.read(""))!, sb = (await b.read(""))!;
  await a.save("", { ...sa, records: { "note:n": note("draft A") } });
  await b.save("", { ...sb, records: { "note:n": note("draft B") } });
  const reopened = (await new WorkspaceCache().read(""))!;
  expect(Object.values(reopened.records).map((p) => JSON.parse(p).content).sort()).toEqual(["draft A", "draft B"]);
});

it("captures the save before a caller mutates its maps", async () => {
  const { WorkspaceCache, emptyDeviceCache } = await import("../deviceCache");
  const state = { ...emptyDeviceCache(), records: { "note:n": note("first") } };
  const save = new WorkspaceCache().save("A", state);
  state.records["note:n"] = note("second");
  await save;
  expect((await new WorkspaceCache().read("A"))?.records["note:n"]).toBe(note("first"));
});

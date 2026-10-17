import { afterEach, beforeEach, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  documents: new Map<string, { payload: string; deleted: boolean; updatedAt: unknown }>(),
  listeners: [] as { next: (snapshot: unknown) => void; error: (error: unknown) => void }[],
  queries: [] as unknown[],
  transactions: 0,
  failure: null as Error | null,
  afterCommit: null as (() => Promise<void> | void) | null,
  collectionReads: 0,
}));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, _users: string, uid: string) => ({ uid }),
  doc: (_col: unknown, key: string) => ({ key }),
  query: (ref: unknown, filter: unknown) => ({ ref, filter }),
  where: (_field: string, _op: string, at: unknown) => at,
  onSnapshot: (q: unknown, _opts: unknown, next: (s: unknown) => void, error: (e: unknown) => void) => { server.queries.push(q); server.listeners.push({ next, error }); return () => {}; },
  serverTimestamp: () => new Date(50_000),
  Timestamp: class { constructor(private ms: number) {} toMillis() { return this.ms; } static fromMillis(ms: number) { return new this(ms); } },
  getDocsFromServer: () => { server.collectionReads++; throw new Error("Redundant collection read"); },
  runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<unknown>) => {
    server.transactions++;
    if (server.failure) throw server.failure;
    const writes: [string, { payload: string; deleted: boolean; updatedAt: unknown }][] = [];
    const outcome = await run({
      get: async ({ key }: { key: string }) => {
        const data = server.documents.get(key);
        return { exists: () => !!data, data: () => data && { ...data } };
      },
      set: ({ key }: { key: string }, value: { payload: string; deleted: boolean; updatedAt: unknown }) => writes.push([key, value]),
    });
    for (const [key, value] of writes) server.documents.set(key, value);
    await server.afterCommit?.();
    return outcome;
  },
}));

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  vi.stubGlobal("document", { hidden: false, visibilityState: "visible", addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("indexedDB", undefined);
});
afterEach(() => {
  server.documents.clear(); server.listeners = []; server.queries = []; server.transactions = 0;
  server.failure = null; server.afterCommit = null; server.collectionReads = 0;
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
const note = (content: string) => JSON.stringify({ id: "n", title: "Essay", content });
function snapshot(key: string, payload: string, ms: number) {
  const doc = { id: key, data: () => ({ payload, deleted: false, updatedAt: new Date(ms) }), metadata: { hasPendingWrites: false } };
  return { docs: [doc], metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [{ type: "modified", doc }] };
}
async function connect() {
  const { CloudSync } = await import("../cloudSync");
  const sync = new CloudSync({} as never);
  await sync.connect("A");
  return sync;
}

it("preserves a real remote conflict and a deletion remains deleted", async () => {
  const sync = await connect();
  server.listeners[0].next(snapshot("note:n", note("original"), 1_000));
  await sync.writeChanges({ "note:n": note("local") });
  server.documents.set("note:n", { payload: note("remote"), deleted: false, updatedAt: new Date(2_000) });
  await sync.uploadNow();
  expect(JSON.parse(server.documents.get("note:n")!.payload).content).toBe("remote");
  expect([...server.documents.values()].some((d) => JSON.parse(d.payload).content === "local")).toBe(true);
  server.documents.set("task:deleted", { payload: "", deleted: true, updatedAt: new Date(3_000) });
  await sync.writeChanges({ "task:deleted": JSON.stringify({ id: "deleted", title: "Undo" }) });
  await sync.uploadNow();
  expect(server.documents.get("task:deleted")!.deleted).toBe(true);
  expect(sync.hasPending).toBe(false);
  await sync.disconnect();
});

it("merges the task order both devices changed instead of saving a conflict note", async () => {
  const sync = await connect();
  server.documents.set("settings:order", { payload: JSON.stringify(["a", "b"]), deleted: false, updatedAt: new Date(1_000) });
  server.listeners[0].next(snapshot("settings:order", JSON.stringify(["a", "b"]), 1_000));
  await sync.writeChanges({ "settings:order": JSON.stringify(["a", "b", "phone"]) });
  server.documents.set("settings:order", { payload: JSON.stringify(["a", "b", "laptop"]), deleted: false, updatedAt: new Date(2_000) });
  await sync.uploadNow();
  expect(JSON.parse(server.documents.get("settings:order")!.payload)).toEqual(["a", "b", "laptop", "phone"]);
  expect([...server.documents.keys()].some((k) => k.startsWith("note:"))).toBe(false);
  expect(sync.hasPending).toBe(false);
  await sync.disconnect();
});

it("accepts a newer remote edit arriving during upload without a second query", async () => {
  const sync = await connect();
  server.documents.set("note:n", { payload: note("original"), deleted: false, updatedAt: new Date(1_000) });
  server.listeners[0].next(snapshot("note:n", note("original"), 1_000));
  const received: Record<string, string>[] = [];
  sync.onRecords = (records) => received.push(records);
  await sync.writeChanges({ "note:n": note("local") });
  server.afterCommit = () => {
    server.documents.set("note:n", { payload: note("newer remote"), deleted: false, updatedAt: new Date(100_000) });
    server.listeners[0].next(snapshot("note:n", note("newer remote"), 100_000));
  };
  await sync.uploadNow();
  expect(JSON.parse(received.at(-1)!["note:n"]).content).toBe("newer remote");
  expect(server.collectionReads).toBe(0);
  await sync.disconnect();
});

it("uploads valid edits while preserving an oversized pending record", async () => {
  const sync = await connect();
  await sync.writeChanges({ "settings:sources": "字".repeat(400_000), "task:ok": JSON.stringify({ id: "ok", title: "Valid" }) });
  await expect(sync.uploadNow()).rejects.toThrow("exceed cloud limits");
  expect(server.documents.has("task:ok")).toBe(true);
  expect(server.documents.has("settings:sources")).toBe(false);
  expect(sync.hasPending).toBe(true);
  await sync.disconnect();
  const reopened = await connect();
  expect(reopened.hasPending).toBe(true);
  await reopened.disconnect();
});

it("persists quota backoff across reloads instead of repeatedly querying", async () => {
  vi.useFakeTimers();
  const sync = await connect();
  await sync.writeChanges({ "task:ok": "{}" });
  server.failure = Object.assign(new Error("Free daily read units quota exceeded"), { code: "resource-exhausted" });
  await sync.flush();
  const attempts = server.transactions;
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(server.transactions).toBe(attempts);
  await sync.disconnect();
  const listenerCount = server.listeners.length;
  const reopened = await connect();
  expect(server.listeners.length).toBe(listenerCount);
  expect(reopened.hasPending).toBe(true);
  await reopened.disconnect();
});

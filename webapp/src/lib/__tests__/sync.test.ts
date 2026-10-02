import { afterEach, expect, it, vi } from "vitest";

// Firestore stand-in: transactions succeed or fail on demand.
const firestore = vi.hoisted(() => ({ fail: false, transactions: 0 }));
vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  doc: (_col: unknown, key: string) => ({ key }),
  query: () => ({}),
  where: () => ({}),
  onSnapshot: () => () => {},
  serverTimestamp: () => null,
  Timestamp: class {},
  getDocsFromServer: async () => ({ docs: [] }),
  runTransaction: async (_db: unknown, run: (tx: unknown) => Promise<unknown>) => {
    firestore.transactions++;
    if (firestore.fail) throw new Error("client is offline");
    return run({ get: async () => ({ exists: () => false, data: () => undefined }), set: () => {} });
  },
}));

function stubStorage(blocked = false) {
  const items = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (blocked) throw new Error("QuotaExceededError");
        items.set(key, value);
      },
      removeItem: (key: string) => void items.delete(key),
    },
  });
}

afterEach(() => {
  firestore.fail = false;
  firestore.transactions = 0;
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function signedInSync() {
  const { CloudSync } = await import("../cloudSync");
  const sync = new CloudSync({} as never);
  (sync as unknown as { uid: string }).uid = "u1";
  return sync;
}

it("confirms an upload only once the cloud has it", async () => {
  stubStorage();
  const sync = await signedInSync();
  await sync.writeChanges({ "task:a": null });
  await sync.uploadNow();
  expect(sync.hasPending).toBe(false);
});

it("reports a deletion that is still waiting to upload", async () => {
  stubStorage();
  firestore.fail = true;
  const sync = await signedInSync();
  await sync.writeChanges({ "task:a": null });
  await expect(sync.uploadNow()).rejects.toThrow("offline");
  expect(sync.hasPending).toBe(true);
});

it("shares one upload pass between callers", async () => {
  stubStorage();
  const sync = await signedInSync();
  await sync.writeChanges({ "task:a": "{}" });
  await Promise.all([sync.flush(), sync.flush(), sync.uploadNow()]);
  expect(firestore.transactions).toBe(1);
});

it("groups note typing into one upload, and sends task changes within a second", async () => {
  vi.useFakeTimers();
  try {
    stubStorage();
    const sync = await signedInSync();
    for (let i = 0; i < 12; i++) {
      await sync.writeChanges({ "note:n": JSON.stringify({ text: "x".repeat(i) }) });
      await vi.advanceTimersByTimeAsync(600);
    }
    expect(firestore.transactions).toBe(0);
    await vi.advanceTimersByTimeAsync(20000);
    expect(firestore.transactions).toBe(1);
    expect(sync.hasPending).toBe(false);

    await sync.writeChanges({ "task:a": "{}" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(firestore.transactions).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

const task = (id: string, hour: number, isDone = false) =>
  JSON.stringify({
    id,
    isDone,
    title: id,
    date: "2026-09-28T00:00:00.000",
    startTime: `2026-09-28T${String(hour).padStart(2, "0")}:00:00.000`,
  });

it("moves only the tasks after the edited one in a domino shift", async () => {
  stubStorage();
  const ws = await import("@/store/workspace");
  ws.loadGuestRecords({ "task:a": task("a", 9), "task:b": task("b", 11), "task:c": task("c", 13), "task:d": task("d", 12, true) });
  const day = new Date(2026, 8, 28);
  ws.applyDominoShift("a", day, new Date(2026, 8, 28, 10), 30 * 60000);
  const hours = Object.fromEntries(
    ws.useWorkspace.getState().tasks.map((t) => [t.id, t.startTime!.getHours() + t.startTime!.getMinutes() / 60]),
  );
  // The completed task keeps its time.
  expect(hours).toEqual({ a: 9, b: 11.5, c: 13.5, d: 12 });
});

it("fails a workspace deletion that could not be stored", async () => {
  stubStorage();
  const ws = await import("@/store/workspace");
  ws.loadGuestRecords({ "task:a": task("a", 9) });
  await ws.clearWorkspace();
  expect(ws.useWorkspace.getState().tasks).toEqual([]);

  vi.resetModules();
  stubStorage(true);
  const blocked = await import("@/store/workspace");
  blocked.loadGuestRecords({ "task:a": task("a", 9) });
  await expect(blocked.clearWorkspace()).rejects.not.toBeInstanceOf(blocked.UploadPendingError);
});

it("keeps extra settings records and saves new ones", async () => {
  stubStorage();
  const ws = await import("@/store/workspace");
  ws.loadGuestRecords({ "task:a": task("a", 9), "settings:sources": JSON.stringify({ sources: [{ id: "s1" }] }) });
  expect(ws.readSide("settings:sources", { sources: [] })).toEqual({ sources: [{ id: "s1" }] });
  ws.writeSide("settings:versions:n1", { versions: [{ at: 1 }] });
  ws.updateTask({ ...ws.useWorkspace.getState().tasks[0], title: "Edited" });
  await new Promise((r) => setTimeout(r, 10));
  // Stored as Flutter's shared preferences do: a JSON string holding JSON.
  const stored = JSON.parse(JSON.parse(window.localStorage.getItem("flutter.activeGuestWorkspace")!));
  expect(Object.keys(stored)).toEqual(expect.arrayContaining(["settings:sources", "settings:versions:n1"]));
  expect(() => ws.writeSide("settings:order", [])).toThrow();
});

import { expect, it, vi } from "vitest";

// The phone's timer, as the bridge sees it.
const native = vi.hoisted(() => ({
  result: { rev: 0, state: null as unknown, opened: false, stopped: null as unknown },
  listeners: {} as Record<string, () => void>,
  /** While set, a read of the timer waits for it. */
  gate: null as Promise<void> | null,
}));

vi.mock("../native", () => ({ isNative: () => true }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: { cancel: async () => {}, checkPermissions: async () => ({ display: "granted" }) } }));
vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    update: async () => {},
    get: async () => {
      if (native.gate) await native.gate;
      return native.result;
    },
    addListener: async (event: string, listener: () => void) => {
      native.listeners[event] = listener;
      return { remove: () => {} };
    },
  }),
}));

const store = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});
vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });

it("credits the time studied when the session is stopped from the notification", async () => {
  const { setFocusLogger, startFocusBridge, startTaskFocus, toNative, useFocus } = await import("../focus");
  const min = 60_000;
  const logged: [string, number][] = [];
  setFocusLogger((id, minutes) => logged.push([id, minutes]));
  startFocusBridge();
  await vi.waitFor(() => expect(native.listeners.changed).toBeDefined());
  startTaskFocus({ id: "t", title: "Essay" }, 90);
  const session = useFocus.getState().session!;
  // Stop pressed 30 minutes in; the app hears about it a while later.
  native.result = { rev: 1, state: null, opened: false, stopped: { ...toNative(session), stoppedAt: session.endsAt! - 10 * min, stoppedRev: 1 } };
  native.listeners.changed();
  await vi.waitFor(() => expect(useFocus.getState().session).toBeNull());
  expect(logged).toEqual([["t", 30]]);
  // Seen once: looking again credits nothing more.
  native.listeners.changed();
  await new Promise((r) => setTimeout(r, 10));
  expect(logged).toEqual([["t", 30]]);
});

it("credits a session that finished on the phone after a notification button changed it", async () => {
  const { setFocusLogger, startTaskFocus, toNative, useFocus } = await import("../focus");
  const logged: [string, number][] = [];
  setFocusLogger((id, minutes) => logged.push([id, minutes]));
  startTaskFocus({ id: "u", title: "Reading" }, 40);
  const session = useFocus.getState().session!;
  // Paused and resumed from the notification while the app slept (revision 2), then it ran out.
  native.result = { rev: 2, state: null, opened: false, stopped: { ...toNative(session), stoppedAt: session.endsAt! + 60_000, stoppedRev: 2 } };
  native.listeners.changed();
  await vi.waitFor(() => expect(useFocus.getState().session).toBeNull());
  expect(logged).toEqual([["u", 40]]);
});

it("ignores a read of the timer that started before a new session", async () => {
  const { pauseFocus, setFocusLogger, startTaskFocus, stopFocus, toNative, useFocus } = await import("../focus");
  const logged: [string, number][] = [];
  setFocusLogger((id, minutes) => logged.push([id, minutes]));
  startTaskFocus({ id: "a", title: "Essay" }, 60);
  pauseFocus();
  const a = useFocus.getState().session!;
  let release = () => {};
  native.gate = new Promise((r) => (release = r));
  native.listeners.changed();
  // Task B starts while the read is on its way; then A's state (half an hour in) arrives.
  startTaskFocus({ id: "b", title: "Lab" }, 40);
  native.result = { rev: 3, state: { ...toNative(a), left: 10 * 60_000 }, opened: false, stopped: null };
  release();
  native.gate = null;
  await new Promise((r) => setTimeout(r, 10));
  expect(useFocus.getState().session).toMatchObject({ taskId: "b", title: "Lab" });
  logged.length = 0;
  stopFocus();
  expect(logged).toEqual([]);
});

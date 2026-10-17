import { expect, it, vi } from "vitest";

// The phone's timer, as the bridge sees it.
const native = vi.hoisted(() => ({
  result: { rev: 0, state: null as unknown, opened: false, stopped: null as unknown },
  listeners: {} as Record<string, () => void>,
}));

vi.mock("../native", () => ({ isNative: () => true }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: { cancel: async () => {}, checkPermissions: async () => ({ display: "granted" }) } }));
vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    update: async () => {},
    get: async () => native.result,
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

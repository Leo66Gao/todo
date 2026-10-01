import { afterEach, expect, it, vi } from "vitest";
import { sessionDialog } from "../sessionDialog";
import { useWorkspace } from "@/store/workspace";

const account = (uid: string) => ({ uid, email: null, displayName: null, photoURL: null });
afterEach(() => useWorkspace.setState({ user: null }));

it("cancels and closes an outstanding confirmation when its account changes", async () => {
  useWorkspace.setState({ user: account("A") });
  const close = vi.fn();
  let finish!: (value: boolean) => void;
  const answer = sessionDialog(false, (resolve) => { finish = resolve; return close; });
  useWorkspace.setState({ user: account("B") });
  expect(await answer).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
  finish(true);
  expect(close).toHaveBeenCalledTimes(1);
});

it("cannot revive a dialog by signing back into the same account", async () => {
  useWorkspace.setState({ user: account("A") });
  let finish!: (value: string | null) => void;
  const answer = sessionDialog<string | null>(null, (resolve) => { finish = resolve; return () => {}; });
  useWorkspace.setState({ user: null });
  useWorkspace.setState({ user: account("A") });
  finish("DELETE");
  expect(await answer).toBeNull();
});

it("allows unrelated workspace updates and settles only once", async () => {
  useWorkspace.setState({ user: account("A") });
  let finish!: (value: string | null) => void;
  const close = vi.fn();
  const answer = sessionDialog<string | null>(null, (resolve) => { finish = resolve; return close; });
  useWorkspace.setState({ user: account("A"), cloudStatus: "Synced" });
  finish("Maths");
  expect(await answer).toBe("Maths");
  useWorkspace.setState({ user: account("B") });
  finish(null);
  expect(close).toHaveBeenCalledTimes(1);
});

it("closes task editors and selections when switching accounts without changing device layout preferences", async () => {
  const { ui } = await import("@/shell/ui");
  useWorkspace.setState({ user: account("A") });
  ui.newTask({ title: "Private draft" });
  ui.set({ inspectorId: "private", selectedId: "private", paletteOpen: true, visibleOrder: ["private"], sidebarCollapsed: true });
  useWorkspace.setState({ user: account("B") });
  expect(ui.get()).toMatchObject({ editor: null, inspectorId: null, selectedId: null, paletteOpen: false, visibleOrder: [], sidebarCollapsed: true });
});

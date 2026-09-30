import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkspaceState } from "@/store/workspace";

// Render the hydrated device state rather than Zustand's empty SSR snapshot.
vi.mock("@/store/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/workspace")>();
  return { ...actual, useWorkspace: Object.assign(<T,>(selector: (state: WorkspaceState) => T) => selector(actual.useWorkspace.getState()), actual.useWorkspace) };
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

it("shows pending work, conflicts, quota errors and separate Calendar status", async () => {
  const { useWorkspace, newTask } = await import("@/store/workspace");
  const { SyncDetails } = await import("@/features/settings/SyncDetails");
  const initial = useWorkspace.getState();
  useWorkspace.setState({
    user: { uid: "A", email: "a@example.test", displayName: "A", photoURL: null },
    tasks: [newTask({ title: "Essay draft", date: new Date(), id: "a", isConflictCopy: true })],
    calendarConnected: false, calendarPending: 3,
    syncDetails: { pending: [{ key: "task:a", deleting: false }], error: "Daily quota is exhausted", pauseReason: "quota", retryAt: Date.now() + 3600000, lastUploadedAt: null, lastDownloadedAt: null, recordsReceived: 0, recordsUploaded: 0 },
  });
  try {
    const html = renderToStaticMarkup(createElement(SyncDetails));
    expect(html).toContain("Essay draft");
    expect(html).toContain("Daily quota is exhausted");
    expect(html).toContain("Pending Calendar operations</dt><dd>3");
    expect(html).toContain("Conflict copies to review</dt><dd>1");
    expect(html).toContain("Retry sync now");
    expect(html).toContain("Not connected");
  } finally { useWorkspace.setState(initial, true); }
});

it("does not offer cloud retry when the workspace is signed out", async () => {
  const { useWorkspace } = await import("@/store/workspace");
  const { SyncDetails } = await import("@/features/settings/SyncDetails");
  useWorkspace.setState({ user: null });
  expect(renderToStaticMarkup(createElement(SyncDetails))).not.toContain("Retry sync now");
});

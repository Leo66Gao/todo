import { afterEach, expect, it, vi } from "vitest";
import { decodeEvent, eventsOnDay, type GCalendar } from "../googleEvents";
import { importedTaskId, matchSubject } from "@/features/events/assignmentImport";
import type { Project } from "../model";

const cal: GCalendar = { id: "school", name: "ManageBac", color: "#3a7", primary: false, writable: false, googleSelected: true };

it("keeps a newer optimistic edit visible and sends requests in order after the first fails", async () => {
  const events = await import("../googleEvents");
  const { calendarClient, useWorkspace } = await import("@/store/workspace");
  useWorkspace.setState({ user: { uid: "A", email: null, photoURL: null, displayName: null } });
  const original = events.decodeEvent({ id: "ordered", summary: "Original", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } }, cal)!;
  events.useGoogleEvents.setState({ uid: "A", months: { "2026-9": [original] } });
  let failFirst!: (error: Error) => void;
  let finishSecond!: (value: { id: string }) => void;
  const patch = vi.spyOn(calendarClient(), "patchCalendarEvent")
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { failFirst = reject; }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
  const first = events.updateEvent(original, { title: "Failed title" }).catch(() => {});
  const second = events.updateEvent(original, { location: "Library" });
  expect(patch).toHaveBeenCalledTimes(1);
  expect(events.useGoogleEvents.getState().months["2026-9"][0]).toMatchObject({ title: "Failed title", location: "Library" });
  failFirst(new Error("Rejected"));
  await first;
  expect(patch).toHaveBeenCalledTimes(2);
  expect(patch.mock.calls[1][2]).toEqual({ location: "Library" });
  expect(events.useGoogleEvents.getState().months["2026-9"][0]).toMatchObject({ title: "Original", location: "Library" });
  finishSecond({ id: original.id });
  await second;
  expect(events.useGoogleEvents.getState().months["2026-9"][0]).toMatchObject({ title: "Original", location: "Library" });
});

it("rolls a failed later edit back to the last successful edit rather than its stale caller snapshot", async () => {
  const events = await import("../googleEvents");
  const { calendarClient } = await import("@/store/workspace");
  const original = events.decodeEvent({ id: "success-first", summary: "Original", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } }, cal)!;
  events.useGoogleEvents.setState({ uid: "u", months: { "2026-9": [original] } });
  let finish!: (value: { id: string }) => void;
  vi.spyOn(calendarClient(), "patchCalendarEvent")
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("Later request failed"));
  const first = events.updateEvent(original, { title: "Saved" });
  const second = events.updateEvent(original, { title: "Rejected" }).catch(() => {});
  finish({ id: original.id });
  await Promise.all([first, second]);
  expect(events.useGoogleEvents.getState().months["2026-9"][0].title).toBe("Saved");
});

it("queues deletion behind a pending edit and restores the accepted edit if deletion fails", async () => {
  const events = await import("../googleEvents");
  const { calendarClient } = await import("@/store/workspace");
  const original = events.decodeEvent({ id: "delete-later", summary: "Original", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } }, cal)!;
  events.useGoogleEvents.setState({ uid: "u", months: { "2026-9": [original] } });
  let finish!: (value: { id: string }) => void;
  vi.spyOn(calendarClient(), "patchCalendarEvent").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const remove = vi.spyOn(calendarClient(), "removeCalendarEvent").mockRejectedValue(new Error("Delete refused"));
  const edit = events.updateEvent(original, { title: "Saved" });
  const deletion = events.deleteEvent(original).catch(() => {});
  expect(remove).not.toHaveBeenCalled();
  expect(events.useGoogleEvents.getState().months["2026-9"]).toEqual([]);
  finish({ id: original.id });
  await Promise.all([edit, deletion]);
  expect(remove).toHaveBeenCalledOnce();
  expect(events.useGoogleEvents.getState().months["2026-9"][0].title).toBe("Saved");
});

it("does not dispatch queued edits from an account that has signed out and back in", async () => {
  const events = await import("../googleEvents");
  const { calendarClient, useWorkspace } = await import("@/store/workspace");
  const user = { uid: "A", email: null, photoURL: null, displayName: null };
  useWorkspace.setState({ user });
  const original = events.decodeEvent({ id: "same-account", summary: "Original", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } }, cal)!;
  events.useGoogleEvents.setState({ uid: "A", months: { "2026-9": [original] } });
  let finish!: (value: { id: string }) => void;
  const patch = vi.spyOn(calendarClient(), "patchCalendarEvent").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const old = events.updateEvent(original, { title: "Old request" }).catch(() => {});
  const queued = events.updateEvent(original, { title: "Never send" }).catch(() => {});
  useWorkspace.setState({ user: null });
  useWorkspace.setState({ user });
  events.useGoogleEvents.setState({ uid: "A", months: { "2026-9": [original] } });
  finish({ id: original.id });
  await Promise.all([old, queued]);
  expect(patch).toHaveBeenCalledOnce();
  expect(events.useGoogleEvents.getState().months["2026-9"][0].title).toBe("Original");
});

it.each(["update", "delete"])("does not roll an event back into another account after a failed %s", async (operation) => {
  const events = await import("../googleEvents");
  const { calendarClient, useWorkspace } = await import("@/store/workspace");
  let reject!: (error: Error) => void;
  const method = operation === "update" ? "patchCalendarEvent" : "removeCalendarEvent";
  vi.spyOn(calendarClient(), method).mockImplementation(() => new Promise<never>((_resolve, fail) => { reject = fail; }));
  useWorkspace.setState({ user: { uid: "A", email: null, photoURL: null, displayName: null } });
  const event = decodeEvent({ id: "private", summary: "Account A", start: { date: "2026-09-28" }, end: { date: "2026-09-29" } }, cal)!;
  events.useGoogleEvents.setState({ uid: "A", months: { "2026-9": [event] } });
  const request = (operation === "update" ? events.updateEvent(event, { title: "Changed" }) : events.deleteEvent(event)).catch(() => {});
  useWorkspace.setState({ user: { uid: "B", email: null, photoURL: null, displayName: null } });
  events.useGoogleEvents.setState({ uid: "B", months: {} });
  reject(new Error("Network failed"));
  await request;
  expect(events.useGoogleEvents.getState().months).toEqual({});
  vi.restoreAllMocks();
  useWorkspace.setState({ user: null });
});

it("reads timed and all-day events, and skips this app's own task events", () => {
  const timed = decodeEvent({ id: "a", summary: "Chem lab", start: { dateTime: "2026-09-28T10:00:00+03:00" }, end: { dateTime: "2026-09-28T11:30:00+03:00" } }, cal)!;
  expect(timed.allDay).toBe(false);
  expect(timed.end.getTime() - timed.start.getTime()).toBe(90 * 60000);
  const allDay = decodeEvent({ id: "b", summary: "Mock exams", start: { date: "2026-09-28" }, end: { date: "2026-09-30" } }, cal)!;
  expect(allDay.allDay).toBe(true);
  expect(allDay.start).toEqual(new Date(2026, 8, 28));
  expect(decodeEvent({ id: "c", start: { date: "2026-09-28" }, extendedProperties: { private: { todoTaskId: "t1" } } }, cal)).toBeNull();
  expect(decodeEvent({ id: "d", status: "cancelled", start: { date: "2026-09-28" } }, cal)).toBeNull();
  expect(decodeEvent({ id: "e", start: { date: "2026-09-28" } }, cal)!.title).toBe("(No title)");
});

it("puts a multi-day event on each of its days, and not the day after", () => {
  const trip = decodeEvent({ id: "t", summary: "Trip", start: { date: "2026-09-28" }, end: { date: "2026-09-30" } }, cal)!;
  expect(eventsOnDay([trip], new Date(2026, 8, 29)).allDay).toHaveLength(1);
  expect(eventsOnDay([trip], new Date(2026, 8, 30)).allDay).toHaveLength(0);
});

it("includes late events on the 25-hour daylight saving day", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Helsinki";
  try {
    const start = new Date(2026, 9, 25, 23, 30);
    const late = { ...decodeEvent({ id: "late", start: { dateTime: start.toISOString() } }, cal)!, end: new Date(start.getTime() + 30 * 60_000) };
    expect(eventsOnDay([late], new Date(2026, 9, 25)).timed).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

const project = (id: string, title: string): Project => ({ id, title, colorValue: 0 }) as Project;
const subjects = [
  project("phys", "Physics HL"),
  project("math", "Maths AA"),
  project("eng", "English Lit"),
  project("cs", "Computer Science"),
  project("hist", "History"),
];

it("matches school events to subjects by name", () => {
  expect(matchSubject("IB DP Physics HL Y1: Lab report due", subjects)).toBe("phys");
  expect(matchSubject("Mathematics AA SL — Problem set 4", subjects)).toBe("math");
  expect(matchSubject("English Literature essay draft", subjects)).toBe("eng");
  expect(matchSubject("Computer Science IA checkpoint", subjects)).toBe("cs");
  expect(matchSubject("Assembly", subjects)).toBeNull();
});

it("gives each event one stable task id", () => {
  const a = importedTaskId({ calendarId: "school", id: "abc123@managebac" });
  expect(importedTaskId({ calendarId: "school", id: "abc123@managebac" })).toBe(a);
  expect(importedTaskId({ calendarId: "school", id: "other" })).not.toBe(a);
  expect(a.startsWith("import-")).toBe(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("moves an edited event into its new month instead of leaving it in the old cache", async () => {
  const events = await import("../googleEvents");
  const { calendarClient } = await import("@/store/workspace");
  vi.spyOn(calendarClient(), "patchCalendarEvent").mockResolvedValue({ id: "moved" });
  const original = events.decodeEvent({ id: "moved", summary: "Meeting", start: { date: "2026-09-30" }, end: { date: "2026-10-01" } }, cal)!;
  events.useGoogleEvents.setState({ uid: "u", months: { "2026-9": [original], "2026-10": [] } });

  const start = new Date(2026, 9, 2);
  const end = new Date(2026, 9, 3);
  await events.updateEvent(original, { start, end });

  expect(events.useGoogleEvents.getState().months["2026-9"]).toEqual([]);
  expect(events.useGoogleEvents.getState().months["2026-10"]).toEqual([expect.objectContaining({ key: original.key, start, end })]);
});

it("does not apply an old account's calendar list after switching accounts", async () => {
  const items = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    },
  });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  const ws = await import("@/store/workspace");
  const events = await import("../googleEvents");
  const calendar = ws.calendarClient();
  vi.spyOn(calendar, "isConnected", "get").mockReturnValue(true);
  let finishOld!: (value: { id: string; summary: string }[]) => void;
  const oldList = new Promise<{ id: string; summary: string }[]>((resolve) => { finishOld = resolve; });
  vi.spyOn(calendar, "listCalendars")
    .mockImplementationOnce(() => oldList)
    .mockResolvedValue([{ id: "new-calendar", summary: "New account" }]);
  vi.spyOn(calendar, "listEvents").mockResolvedValue([]);

  ws.useWorkspace.setState({ user: { uid: "old", email: null, displayName: null, photoURL: null }, calendarConnected: true });
  events.ensureMonths(new Date(2026, 8, 1), new Date(2026, 9, 1));
  ws.useWorkspace.setState({ user: { uid: "new", email: null, displayName: null, photoURL: null } });
  events.ensureMonths(new Date(2026, 8, 1), new Date(2026, 9, 1));
  await vi.waitFor(() => expect(events.useGoogleEvents.getState().calendars.map((c) => c.id)).toEqual(["new-calendar"]));
  finishOld([{ id: "old-calendar", summary: "Old account" }]);
  await Promise.resolve();

  expect(events.useGoogleEvents.getState().uid).toBe("new");
  expect(events.useGoogleEvents.getState().calendars.map((c) => c.id)).toEqual(["new-calendar"]);
});

it("imports an assignment once, keeps a deleted one deleted, and follows a moved deadline", async () => {
  const items = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    },
  });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  const ws = await import("@/store/workspace");
  const events = await import("../googleEvents");
  const { importAssignments, importedTaskId: idOf } = await import("@/features/events/assignmentImport");
  ws.useWorkspace.setState({ user: { uid: "u", email: null, displayName: null, photoURL: null }, isLoading: false, tasks: [], projects: subjects });
  // Before the first cloud download nothing is imported.
  importAssignments([events.decodeEvent({ id: "early", summary: "Physics HL: Early", start: { date: "2099-01-01" } }, cal)!]);
  expect(ws.useWorkspace.getState().tasks).toHaveLength(0);
  ws.useWorkspace.setState((s) => ({ syncDetails: { ...s.syncDetails, lastDownloadedAt: Date.now() } }));
  events.useGoogleEvents.setState({ uid: "u", calendars: [cal], modes: { school: "assignments" } });

  const soon = new Date();
  soon.setDate(soon.getDate() + 5);
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const raw = { id: "ev1", summary: "Physics HL: Lab report", start: { date: day(soon) } };
  const event = events.decodeEvent(raw, cal)!;

  importAssignments([event]);
  importAssignments([event]);
  const tasks = ws.useWorkspace.getState().tasks;
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ id: idOf(event), type: "assignment", projectId: "phys", title: "Physics HL: Lab report" });

  // The school moves the deadline: the assignment follows.
  const later = new Date(soon);
  later.setDate(later.getDate() + 2);
  importAssignments([events.decodeEvent({ ...raw, start: { date: day(later) } }, cal)!]);
  expect(ws.useWorkspace.getState().tasks[0].date.getDate()).toBe(later.getDate());

  // Deleted by you: not brought back.
  ws.deleteTask(idOf(event));
  importAssignments([event]);
  expect(ws.useWorkspace.getState().tasks).toHaveLength(0);
});

it("on a new device, keeps your edited assignment title and leaves deleted ones deleted", async () => {
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  const ws = await import("@/store/workspace");
  const events = await import("../googleEvents");
  const { IMPORTED, importAssignments, importedTaskId: idOf } = await import("@/features/events/assignmentImport");
  const soon = new Date();
  soon.setDate(soon.getDate() + 5);
  const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
  const lab = events.decodeEvent({ id: "lab", summary: "Lab report", start: { date: day } }, cal)!;
  const quiz = events.decodeEvent({ id: "quiz", summary: "Quiz", start: { date: day } }, cal)!;
  // Synced from device A: the lab renamed by you, the quiz deleted (and A's record of the feed).
  const renamed = ws.newTask({ id: idOf(lab), title: "Lab report (draft due)", date: lab.start, type: "assignment" });
  const seen = { [idOf(lab)]: { title: "Lab report", date: lab.start.getTime() }, [idOf(quiz)]: { title: "Quiz", date: quiz.start.getTime() } };
  ws.useWorkspace.setState({
    user: { uid: "u", email: null, displayName: null, photoURL: null },
    isLoading: false,
    tasks: [renamed],
    projects: subjects,
    side: { [IMPORTED]: JSON.stringify(seen) },
    syncDetails: { ...ws.useWorkspace.getState().syncDetails, lastDownloadedAt: Date.now() },
  });
  events.useGoogleEvents.setState({ uid: "u", calendars: [cal], modes: { school: "assignments" } });
  importAssignments([lab, quiz]);
  importAssignments([lab, quiz]);
  expect(ws.useWorkspace.getState().tasks.map((t) => t.title)).toEqual(["Lab report (draft due)"]);
  // Without A's record (an older version): the feed's title is still what's kept, not yours.
  ws.useWorkspace.setState({ side: {} });
  importAssignments([lab]);
  importAssignments([lab]);
  expect(ws.useWorkspace.getState().tasks.map((t) => t.title)).toEqual(["Lab report (draft due)"]);
  expect(JSON.parse(ws.useWorkspace.getState().side[IMPORTED])[idOf(lab)].title).toBe("Lab report");
});

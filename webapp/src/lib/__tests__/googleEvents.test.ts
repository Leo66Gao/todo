import { afterEach, expect, it, vi } from "vitest";
import { decodeEvent, eventsOnDay, type GCalendar } from "../googleEvents";
import { importedTaskId, matchSubject } from "@/features/events/assignmentImport";
import type { Project } from "../model";

const cal: GCalendar = { id: "school", name: "ManageBac", color: "#3a7", primary: false, writable: false, googleSelected: true };

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
  vi.resetModules();
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

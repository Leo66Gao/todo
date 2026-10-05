"use client";

// Your Google Calendar events, shown next to tasks (the other direction of the
// Calendar link: tasks already go out as events). Events are fetched by month
// for the calendars you choose, cached on the device for instant, offline
// display, refreshed when the app comes back into view, and can be edited or
// deleted in place.

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { ApiError, type RawCalendar, type RawEvent } from "./calendar";
import { getLocal, setLocal, getBool } from "./prefs";
import { addDays } from "./time";
import { calendarClient, captureWorkspaceSession, useWorkspace } from "@/store/workspace";

export type CalendarMode = "show" | "hide" | "assignments";

export interface GCalendar {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  writable: boolean;
  /** Shown in Google Calendar itself (the default here too). */
  googleSelected: boolean;
}

export interface GEvent {
  /** Unique across calendars. */
  key: string;
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  /** Exclusive; for all-day events, midnight after the last day. */
  end: Date;
  allDay: boolean;
  location: string | null;
  description: string | null;
  link: string | null;
  color: string;
  writable: boolean;
  recurring: boolean;
}

interface EventsState {
  uid: string | null;
  calendars: GCalendar[];
  /** Per-calendar choice on this device; unset follows Google's own visibility. */
  modes: Record<string, CalendarMode>;
  months: Record<string, GEvent[]>;
  fetchedAt: Record<string, number>;
  /** Connected before calendars could be listed: only the main calendar shows. */
  listMissing: boolean;
  error: string | null;
}

export const useGoogleEvents = create<EventsState>(() => ({
  uid: null,
  calendars: [],
  modes: {},
  months: {},
  fetchedAt: {},
  listMissing: false,
  error: null,
}));

const get = () => useGoogleEvents.getState();
const set = (patch: Partial<EventsState>) => useGoogleEvents.setState(patch);

const STALE_MS = 5 * 60_000;
const PRIMARY: GCalendar = { id: "primary", name: "Calendar", color: "#4f7cf0", primary: true, writable: true, googleSelected: true };

export const modeOf = (calendar: GCalendar, modes = get().modes): CalendarMode =>
  modes[calendar.id] ?? (calendar.primary || calendar.googleSelected ? "show" : "hide");

export const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}`;
const monthStart = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
};

function monthKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor.getTime() < to.getTime()) {
    keys.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Decoding

function parseTime(t: { date?: string; dateTime?: string } | undefined): { at: Date; allDay: boolean } | null {
  if (t?.dateTime) return { at: new Date(t.dateTime), allDay: false };
  if (t?.date) {
    const [y, m, d] = t.date.split("-").map(Number);
    return { at: new Date(y, m - 1, d), allDay: true };
  }
  return null;
}

export function decodeEvent(raw: RawEvent, calendar: GCalendar): GEvent | null {
  if (raw.status === "cancelled") return null;
  // Tasks this app exported come back as events: they are already shown as tasks.
  if (raw.extendedProperties?.private?.todoTaskId) return null;
  const start = parseTime(raw.start);
  const end = parseTime(raw.end);
  if (!start) return null;
  const endAt = end?.at ?? (start.allDay ? addDays(start.at, 1) : new Date(start.at.getTime() + 30 * 60_000));
  return {
    key: `${calendar.id}|${raw.id}`,
    id: raw.id,
    calendarId: calendar.id,
    title: raw.summary?.trim() || "(No title)",
    start: start.at,
    end: endAt,
    allDay: start.allDay,
    location: raw.location ?? null,
    description: raw.description ?? null,
    link: raw.htmlLink ?? null,
    color: calendar.color,
    writable: calendar.writable,
    recurring: raw.recurringEventId != null,
  };
}

// ---------------------------------------------------------------------------
// Device cache (per account)

const cacheKey = (uid: string) => `gcal.${uid}`;
const modesKey = (uid: string) => `gcal.modes.${uid}`;

type CachedEvent = Omit<GEvent, "start" | "end"> & { start: number; end: number };

function saveCache() {
  const { uid, calendars, months } = get();
  if (!uid) return;
  // Keep a few months around now: enough for instant, offline display.
  const now = new Date();
  const keep = new Set(monthKeysBetween(new Date(now.getFullYear(), now.getMonth() - 2, 1), new Date(now.getFullYear(), now.getMonth() + 4, 1)));
  const slim: Record<string, CachedEvent[]> = {};
  for (const [key, list] of Object.entries(months)) {
    if (keep.has(key)) slim[key] = list.map((e) => ({ ...e, start: e.start.getTime(), end: e.end.getTime() }));
  }
  setLocal(cacheKey(uid), { calendars, months: slim });
}

function loadCache(uid: string) {
  const cached = getLocal<{ calendars?: GCalendar[]; months?: Record<string, CachedEvent[]> }>(cacheKey(uid), {});
  const months: Record<string, GEvent[]> = {};
  for (const [key, list] of Object.entries(cached.months ?? {})) {
    months[key] = list.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }));
  }
  set({
    uid,
    calendars: cached.calendars ?? [],
    modes: getLocal<Record<string, CalendarMode>>(modesKey(uid), {}),
    months,
    fetchedAt: {},
    listMissing: false,
    error: null,
  });
}

export function setCalendarMode(id: string, mode: CalendarMode) {
  const { uid, modes } = get();
  if (!uid) return;
  const next = { ...modes, [id]: mode };
  set({ modes: next });
  setLocal(modesKey(uid), next);
  // A calendar that becomes visible needs its events.
  set({ fetchedAt: {} });
  void refresh();
}

// ---------------------------------------------------------------------------
// Fetching

const connected = () => useWorkspace.getState().calendarConnected && calendarClient().isConnected;
/** Months some view currently shows (refreshed when the app comes back). */
const wanted = new Map<string, number>();
const inflight = new Map<string, { promise: Promise<void>; token: object }>();
let calendarsFetchedAt = 0;
let calendarsInFlight: { uid: string; promise: Promise<void> } | null = null;

async function ensureCalendars(uid: string | null) {
  if (!uid || get().uid !== uid) return;
  if (Date.now() - calendarsFetchedAt < 30 * 60_000 && get().calendars.length) return;
  if (calendarsInFlight?.uid === uid) return calendarsInFlight.promise;
  const promise = fetchCalendars(uid);
  const job = { uid, promise };
  calendarsInFlight = job;
  try { await promise; }
  finally { if (calendarsInFlight === job) calendarsInFlight = null; }
}

async function fetchCalendars(uid: string) {
  const currentSession = captureWorkspaceSession();
  try {
    const raw = await calendarClient().listCalendars();
    if (!currentSession() || get().uid !== uid) return;
    calendarsFetchedAt = Date.now();
    set({ calendars: raw.map(toCalendar).sort(byImportance), listMissing: false });
  } catch (error) {
    if (!currentSession() || get().uid !== uid) return;
    if (error instanceof ApiError && error.status === 403) {
      // Connected before this app could list calendars: the main one still works.
      calendarsFetchedAt = Date.now();
      set({ calendars: [PRIMARY], listMissing: true });
    } else {
      throw error;
    }
  }
}

const toCalendar = (c: RawCalendar): GCalendar => ({
  id: c.primary ? "primary" : c.id,
  name: c.summaryOverride || c.summary || "Calendar",
  color: c.backgroundColor ?? "#4f7cf0",
  primary: c.primary === true,
  writable: c.accessRole === "owner" || c.accessRole === "writer",
  googleSelected: c.selected === true,
});
const byImportance = (a: GCalendar, b: GCalendar) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name);

function loadMonth(key: string, force = false): Promise<void> {
  if (!connected()) return Promise.resolve();
  if (!force && Date.now() - (get().fetchedAt[key] ?? 0) < STALE_MS) return Promise.resolve();
  const uid = get().uid;
  if (!uid) return Promise.resolve();
  const currentSession = captureWorkspaceSession();
  const mutationGeneration = eventMutationGeneration;
  const jobKey = `${uid}:${key}`;
  const running = inflight.get(jobKey);
  if (running) return running.promise;
  const token = {};
  const job = (async () => {
    try {
      await ensureCalendars(uid);
      if (!currentSession() || get().uid !== uid) return;
      const from = monthStart(key);
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      const calendars = get().calendars.filter((c) => modeOf(c) !== "hide");
      const lists = await Promise.all(
        calendars.map(async (c) => (await calendarClient().listEvents(c.id, from, to)).map((raw) => decodeEvent(raw, c))),
      );
      if (!currentSession() || get().uid !== uid || mutationGeneration !== eventMutationGeneration) return;
      const events = lists.flat().filter((e): e is GEvent => e != null);
      set({ months: { ...get().months, [key]: events }, fetchedAt: { ...get().fetchedAt, [key]: Date.now() }, error: null });
      for (const queue of eventQueues.values()) if (queueCurrent(queue)) showQueued(queue);
      saveCache();
      onMonthLoaded?.(key, get().months[key]);
    } catch (error) {
      if (currentSession() && get().uid === uid) set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (inflight.get(jobKey)?.token === token) inflight.delete(jobKey);
    }
  })();
  inflight.set(jobKey, { promise: job, token });
  return job;
}

/** Reloads every month on screen (after a return to the app, or a change of calendars). */
export function refresh(): Promise<void> {
  return Promise.all([...wanted.keys()].map((k) => loadMonth(k, true))).then(() => {});
}

/** Called after a month's events arrive (the assignment import listens). */
let onMonthLoaded: ((key: string, events: GEvent[]) => void) | null = null;
export function setMonthListener(listener: typeof onMonthLoaded) {
  onMonthLoaded = listener;
}

/** Makes sure these months are loaded and not stale. */
export function ensureMonths(from: Date, to: Date) {
  wire();
  for (const key of monthKeysBetween(from, to)) void loadMonth(key);
}

// ---------------------------------------------------------------------------
// Account and connection wiring

let wired = false;
function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const sync = () => {
    const { user, calendarConnected } = useWorkspace.getState();
    const uid = user?.uid ?? null;
    if (uid !== get().uid) {
      calendarsFetchedAt = 0;
      calendarsInFlight = null;
      inflight.clear();
      if (uid) loadCache(uid);
      else set({ uid: null, calendars: [], months: {}, fetchedAt: {}, modes: {} });
    }
    if (calendarConnected) void refresh();
  };
  useWorkspace.subscribe((s, prev) => {
    if (s.user?.uid !== prev.user?.uid || s.calendarConnected !== prev.calendarConnected) sync();
  });
  sync();
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      set({ fetchedAt: {} });
      void refresh();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
}

/** Whether events should show at all (the account has Calendar turned on). */
function enabled(uid: string | null) {
  return uid != null && getBool(`calendar.enabled.${uid}`) === true;
}

/** Shown events overlapping [from, to), kept loaded while the view is mounted. */
export function useEvents(from: Date, to: Date): GEvent[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const months = useGoogleEvents((s) => s.months);
  const modes = useGoogleEvents((s) => s.modes);
  const calendars = useGoogleEvents((s) => s.calendars);
  const uid = useGoogleEvents((s) => s.uid);
  const calendarConnected = useWorkspace((s) => s.calendarConnected);

  useEffect(() => {
    wire();
    const keys = monthKeysBetween(new Date(fromMs), new Date(toMs));
    for (const k of keys) wanted.set(k, (wanted.get(k) ?? 0) + 1);
    ensureMonths(new Date(fromMs), new Date(toMs));
    return () => {
      for (const k of keys) {
        const n = (wanted.get(k) ?? 1) - 1;
        if (n <= 0) wanted.delete(k);
        else wanted.set(k, n);
      }
    };
  }, [fromMs, toMs, calendarConnected]);

  return useMemo(() => {
    if (!enabled(uid)) return [];
    const visible = new Set(calendars.filter((c) => modeOf(c, modes) === "show").map((c) => c.id));
    const seen = new Set<string>();
    const out: GEvent[] = [];
    for (const key of monthKeysBetween(new Date(fromMs), new Date(toMs))) {
      for (const e of months[key] ?? []) {
        if (seen.has(e.key) || !visible.has(e.calendarId)) continue;
        if (e.end.getTime() <= fromMs || e.start.getTime() >= toMs) continue;
        seen.add(e.key);
        out.push(e);
      }
    }
    return out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
  }, [months, modes, calendars, uid, fromMs, toMs]);
}

/** Events on one day, split into all-day and timed. */
export function eventsOnDay(events: GEvent[], day: Date) {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const on = events.filter((e) => e.start.getTime() < to && e.end.getTime() > from);
  return { allDay: on.filter((e) => e.allDay), timed: on.filter((e) => !e.allDay) };
}

// ---------------------------------------------------------------------------
// Editing

const pad = (n: number) => String(n).padStart(2, "0");
const dateOnly = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function replaceEverywhere(key: string, next: GEvent | null) {
  const months: Record<string, GEvent[]> = {};
  for (const [m, list] of Object.entries(get().months)) {
    months[m] = list.filter((e) => e.key !== key);
  }
  if (next) {
    for (const m of monthKeysBetween(next.start, next.end)) {
      months[m] = [...(months[m] ?? []), next];
    }
  }
  set({ months });
}

export interface EventPatch {
  title?: string;
  start?: Date;
  end?: Date;
  allDay?: boolean;
  location?: string;
  description?: string;
}

interface EventOperation {
  patch: EventPatch | null;
  resolve: () => void;
  reject: (error: unknown) => void;
}
interface EventQueue {
  key: string;
  uid: string;
  currentSession: () => boolean;
  base: GEvent | null;
  event: GEvent;
  operations: EventOperation[];
  running: boolean;
}
const eventQueues = new Map<string, EventQueue>();
let eventMutationGeneration = 0;
const queueCurrent = (queue: EventQueue) => queue.currentSession() && get().uid === queue.uid;

function patchedEvent(event: GEvent | null, patch: EventPatch | null): GEvent | null {
  return event && patch ? { ...event, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value != null)) } : null;
}

/** Later edits remain visible even when an earlier request fails. */
function showQueued(queue: EventQueue) {
  let visible = queue.base;
  for (const operation of queue.operations) visible = patchedEvent(visible, operation.patch);
  replaceEverywhere(queue.event.key, visible);
}

function enqueueEvent(event: GEvent, patch: EventPatch | null): Promise<void> {
  const uid = get().uid;
  if (!uid) return Promise.reject(new Error("Sign in before editing Calendar events."));
  const key = JSON.stringify([uid, event.key]);
  let queue = eventQueues.get(key);
  if (!queue || !queueCurrent(queue)) {
    const cached = Object.values(get().months).flat().find((e) => e.key === event.key);
    queue = { key, uid, currentSession: captureWorkspaceSession(), base: cached ?? event, event, operations: [], running: false };
    eventQueues.set(key, queue);
  }
  const job = queue;
  if (!job.base || job.operations.some((o) => o.patch == null)) return Promise.reject(new Error("This event is being deleted."));
  return new Promise<void>((resolve, reject) => {
    job.operations.push({ patch, resolve, reject });
    eventMutationGeneration++;
    showQueued(job);
    if (!job.running) void drainEvent(job);
  });
}

async function drainEvent(queue: EventQueue) {
  queue.running = true;
  try {
    while (queue.operations.length) {
      if (!queueCurrent(queue)) {
        for (const operation of queue.operations.splice(0)) operation.reject(new Error("Account changed during the Calendar edit."));
        return;
      }
      const operation = queue.operations[0];
      const next = patchedEvent(queue.base, operation.patch);
      let failure: unknown;
      let failed = false;
      try {
        if (operation.patch == null) {
          await calendarClient().removeCalendarEvent(queue.event.calendarId, queue.event.id);
        } else {
          if (!next) throw new Error("This event was deleted.");
          const patch = operation.patch;
          const body: Record<string, unknown> = {};
          if (patch.title != null) body.summary = patch.title;
          if (patch.location != null) body.location = patch.location;
          if (patch.description != null) body.description = patch.description;
          if (patch.start || patch.end || patch.allDay != null) {
            body.start = next.allDay ? { date: dateOnly(next.start) } : { dateTime: next.start.toISOString(), timeZone: timeZone() };
            body.end = next.allDay ? { date: dateOnly(next.end) } : { dateTime: next.end.toISOString(), timeZone: timeZone() };
          }
          await calendarClient().patchCalendarEvent(queue.event.calendarId, queue.event.id, body);
        }
      } catch (error) { failed = true; failure = error; }
      if (!queueCurrent(queue)) {
        for (const pending of queue.operations.splice(0)) pending.reject(new Error("Account changed during the Calendar edit."));
        return;
      }
      if (!failed) queue.base = next;
      queue.operations.shift();
      eventMutationGeneration++;
      showQueued(queue);
      saveCache();
      if (failed) operation.reject(failure);
      else operation.resolve();
    }
  } finally {
    queue.running = false;
    if (eventQueues.get(queue.key) === queue) eventQueues.delete(queue.key);
  }
}

/** Changes an event in Google Calendar (shown at once; undone if Google refuses). */
export async function updateEvent(event: GEvent, patch: EventPatch): Promise<void> {
  await enqueueEvent(event, patch);
}

/** Deletes an event from Google Calendar (undone if Google refuses). */
export async function deleteEvent(event: GEvent): Promise<void> {
  await enqueueEvent(event, null);
}

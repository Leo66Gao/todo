"use client";

// Google Calendar export: each open task is mirrored as an event through a
// durable, account-scoped outbox (the same one the Flutter app uses), so
// edits made offline or while Google is unreachable are sent later, in
// order. Split from the workspace store, which calls in here when tasks
// change.

import { GoogleAuthProvider, reauthenticateWithPopup, type User } from "firebase/auth";
import { CALENDAR_SCOPES, GoogleCalendar, calendarActionKey, normalizeOutbox, type CalendarAction } from "@/lib/calendar";
import { plainText } from "@/lib/delta";
import { firebase } from "@/lib/firebase";
import { encodeTask, type Task } from "@/lib/model";
import { isNative } from "@/lib/native";
import * as prefs from "@/lib/prefs";
import { cachedJson, captureWorkspaceSession, currentFirebaseUser, saveData, useWorkspace, type WorkspaceState } from "./workspace";

const get = () => useWorkspace.getState();
const set = (patch: Partial<WorkspaceState>) => useWorkspace.setState(patch);

export const calendar = new GoogleCalendar();
/** The signed-in account's Google Calendar client (events are read through it too). */
export const calendarClient = () => calendar;
let calendarEnabled = false;
let calendarOwnerUid: string | null = null;
let outbox: Record<string, CalendarAction> = {};
let calendarQueue: Promise<void> = Promise.resolve();
let calendarRetry: ReturnType<typeof setInterval> | null = null;

export const refreshCalendarFlag = () =>
  set({
    calendarConnected:
      calendarOwnerUid != null &&
      calendarOwnerUid === get().user?.uid &&
      calendar.isConnected &&
      calendar.email === get().user?.email,
  });


/** Whether this account exports tasks to Google Calendar. */
export const calendarOn = () => calendarEnabled;

/** Forgets the previous account's Calendar session and outbox. */
export function resetCalendar() {
  calendarOwnerUid = null;
  calendarEnabled = false;
  outbox = {};
  calendar.clearSession();
}

// ---------------------------------------------------------------------------
// Google Calendar

function deterministicEventId(uid: string, task: Task) {
  const bytes = new TextEncoder().encode(`${uid}:${task.id}:${task.calendarEventRevision}`);
  return `td${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function upsertAction(uid: string, task: Task): CalendarAction {
  const start = task.startTime ?? task.date;
  return {
    operation: "upsert",
    taskId: task.id,
    eventId: task.googleEventId ?? deterministicEventId(uid, task),
    revision: task.calendarEventRevision,
    title: task.title,
    description: plainText(task.notes),
    startTime: toIsoLocal(start),
    isAllDay: task.startTime == null,
    durationMinutes:
      task.startTime != null && task.durationMinutes === 0 ? 30 : task.durationMinutes,
    ...(get().settings.calendarAlerts ? {} : { alerts: false }),
  };
}

function toIsoLocal(d: Date) {
  // Same text Dart's toIso8601String produces, so outboxes interoperate.
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const outboxKey = (uid: string) => `calendar.outbox.${uid}`;

// What this browser last wrote to Google Calendar for each task, so a page load
// only re-exports tasks that changed since (not every open task).
const exportedKey = (uid: string) => `calendarExported.${uid}`;
const exportFingerprint = (action: CalendarAction) =>
  JSON.stringify([
    action.eventId,
    action.revision,
    action.title,
    action.description,
    action.startTime,
    action.isAllDay,
    action.durationMinutes,
    // Only when silenced, so events exported before the setting existed match.
    ...(action.alerts === false ? ["silent"] : []),
  ]);
function markExported(uid: string, taskId: string, fingerprint: string | null) {
  const exported = prefs.getLocal<Record<string, string>>(exportedKey(uid), {});
  if (fingerprint == null) delete exported[taskId];
  else exported[taskId] = fingerprint;
  prefs.setLocal(exportedKey(uid), exported);
}
const persistOutbox = (uid: string) => {
  const stored = prefs.setString(outboxKey(uid), JSON.stringify(outbox));
  if (get().user?.uid === uid) set({ calendarPending: Object.keys(outbox).length });
  return stored;
};

export function storeCalendarAction(uid: string, action: CalendarAction) {
  if (calendarOwnerUid !== uid || get().user?.uid !== uid) return;
  outbox[calendarActionKey(action)] = action;
  persistOutbox(uid);
}

export const hasCalendarExport = (task: Task) =>
  task.googleEventId != null || `upsert:${task.id}` in outbox;

function enqueueCalendarDeletion(uid: string, task: Task) {
  const pendingUpsert = outbox[`upsert:${task.id}`];
  delete outbox[`upsert:${task.id}`];
  const ids = new Set<string>();
  if (task.googleEventId) ids.add(task.googleEventId);
  ids.add(deterministicEventId(uid, task));
  if (pendingUpsert) ids.add(pendingUpsert.eventId);
  for (const eventId of ids) {
    storeCalendarAction(uid, {
      operation: "delete",
      taskId: task.id,
      eventId,
      revision: task.calendarEventRevision,
    });
  }
}

export function scheduleCalendarFlush(): Promise<void> {
  const uid = get().user?.uid;
  if (!uid) return Promise.resolve();
  calendarQueue = calendarQueue.catch(() => {}).then(() => flushCalendarOutbox(uid));
  return calendarQueue;
}

export function syncTaskToCalendar(task: Task) {
  const uid = get().user?.uid;
  if (!uid || !calendarEnabled || task.isDone || task.isConflictCopy) return;
  const action = upsertAction(uid, task);
  outbox[calendarActionKey(action)] = action;
  persistOutbox(uid);
  if (calendarOwnerUid !== uid) return;
  void scheduleCalendarFlush();
}

export function removeTaskFromCalendar(task: Task) {
  const uid = get().user?.uid;
  if (!uid || !calendarEnabled) return;
  enqueueCalendarDeletion(uid, task);
  if (calendarOwnerUid !== uid) return;
  void scheduleCalendarFlush();
}

/** Replaces one stored task without a save (calendar bookkeeping). */
export function patchTaskSilently(id: string, patch: Partial<Task>) {
  set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
}

async function flushCalendarOutbox(uid: string) {
  refreshCalendarFlag();
  if (!get().calendarConnected || calendarOwnerUid !== uid || get().user?.uid !== uid) return;
  let firstError: string | null = null;
  for (const action of Object.values(outbox)) {
    if (calendarOwnerUid !== uid || get().user?.uid !== uid) return;
    const { taskId, eventId } = action;
    let success = false;
    let resultingId: string | null = null;
    if (action.operation === "delete") {
      success = await calendar.deleteEvent(eventId);
    } else {
      const task = get().tasks.find((t) => t.id === taskId);
      if (!task || task.isDone) {
        const slot = calendarActionKey(action);
        if (JSON.stringify(outbox[slot]) === JSON.stringify(action)) {
          delete outbox[slot];
          persistOutbox(uid);
        }
        continue;
      }
      const input = {
        eventId,
        title: action.title as string,
        description: (action.description as string | null) ?? null,
        startTime: new Date(parseLocal(action.startTime as string)),
        durationMinutes: action.durationMinutes as number,
        isAllDay: (action.isAllDay as boolean | undefined) ?? task.startTime == null,
        taskId,
        ownerUid: uid,
        alerts: action.alerts !== false,
      };
      success = await calendar.updateEvent(input);
      if (!success && (calendar.lastErrorStatus === 404 || calendar.lastErrorStatus === 410)) {
        resultingId = await calendar.insertEvent(input);
        success = resultingId != null;
      }
    }
    if (calendarOwnerUid !== uid || get().user?.uid !== uid) return;
    if (!success) {
      firstError ??= calendar.lastError ?? "Calendar sync is waiting to retry.";
      set({ syncError: firstError });
      if (calendar.lastErrorStatus !== 400) return;
      continue;
    }
    if (action.operation === "upsert") {
      const task = get().tasks.find((t) => t.id === taskId);
      const id = resultingId ?? eventId;
      const revision = action.revision as number | undefined;
      const stale =
        !task || task.isDone || (revision != null && task.calendarEventRevision !== revision);
      if (stale) {
        storeCalendarAction(uid, { operation: "delete", taskId, eventId: id, revision });
      } else {
        markExported(uid, taskId, exportFingerprint({ ...action, eventId: id }));
        if (task.googleEventId !== id) {
          patchTaskSilently(taskId, { googleEventId: id });
          await saveData();
        }
      }
    } else {
      markExported(uid, taskId, null);
      const task = get().tasks.find((t) => t.id === taskId);
      const revision = action.revision as number | undefined;
      const superseded = task != null && revision != null && task.calendarEventRevision !== revision;
      if (task && !superseded && task.isDone && task.googleEventId === eventId) {
        patchTaskSilently(taskId, { googleEventId: null });
        await saveData();
      }
    }
    const slot = calendarActionKey(action);
    if (outbox[slot] && JSON.stringify(outbox[slot]) === JSON.stringify(action)) {
      delete outbox[slot];
      persistOutbox(uid);
    }
  }
  if (Object.keys(outbox).length > 0 && firstError == null) void scheduleCalendarFlush();
  set({ syncError: firstError });
}

function parseLocal(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return Date.parse(text);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

export function stopCalendarRetry() {
  if (calendarRetry) clearInterval(calendarRetry);
  calendarRetry = null;
}

export function startCalendarRetry() {
  stopCalendarRetry();
  calendarRetry = setInterval(() => void keepCalendarAlive(), 30000);
}

async function keepCalendarAlive() {
  const currentSession = captureWorkspaceSession();
  const user = get().user;
  if (!user || !calendarEnabled) return;
  refreshCalendarFlag();
  if (!get().calendarConnected && isNative()) {
    const email = await calendar.authorize({ interactive: false, email: user.email, uid: user.uid });
    if (!currentSession() || get().user?.uid !== user.uid) return;
    if (email && email === user.email) refreshCalendarFlag();
  }
  if (get().calendarConnected) void scheduleCalendarFlush();
}

export function restoreCalendarSafely(user: User) {
  const currentSession = captureWorkspaceSession();
  void restoreCalendarForAccount(user).catch((error) => { if (currentSession()) set({ cloudError: String(error) }); });
}

export async function restoreCalendarForAccount(user: User) {
  const currentSession = captureWorkspaceSession();
  calendarOwnerUid = user.uid;
  calendarEnabled = prefs.getBool(`calendar.enabled.${user.uid}`) === true;
  const saved = prefs.getString(outboxKey(user.uid));
  if (saved) {
    try {
      outbox = normalizeOutbox(JSON.parse(saved));
    } catch {
      outbox = {};
    }
  }
  if (!calendarEnabled) return;
  if (get().user?.uid === user.uid) set({ calendarPending: Object.keys(outbox).length });
  if (!navigator.onLine) {
    // Offline, Google can't be asked: open straight away and reconnect later.
    window.addEventListener("online", () => { if (currentSession() && get().user?.uid === user.uid) restoreCalendarSafely(user); }, { once: true });
    return;
  }
  const email = await calendar.authorize({ interactive: false, email: user.email, uid: user.uid });
  if (!currentSession() || get().user?.uid !== user.uid) return;
  if (email && email !== user.email) calendar.clearSession();
  refreshCalendarFlag();
  startCalendarRetry();
  if (!get().calendarConnected) return;
  const exported = prefs.getLocal<Record<string, string>>(exportedKey(user.uid), {});
  for (const task of get().tasks) {
    if (task.isDone && hasCalendarExport(task)) {
      if (!(`delete:${task.googleEventId}` in outbox)) {
        patchTaskSilently(task.id, { calendarEventRevision: task.calendarEventRevision + 1 });
        void saveData();
      }
      enqueueCalendarDeletion(user.uid, get().tasks.find((t) => t.id === task.id)!);
    } else if (!task.isDone && !task.isConflictCopy) {
      const action = upsertAction(user.uid, task);
      // Unchanged since this browser last exported it: nothing to send.
      if (task.googleEventId && exported[task.id] === exportFingerprint(action)) continue;
      storeCalendarAction(user.uid, action);
    }
  }
  void scheduleCalendarFlush();
}

async function enableCalendarAfterConnect(uid: string) {
  calendarOwnerUid = uid;
  calendarEnabled = true;
  prefs.setBool(`calendar.enabled.${uid}`, true);
  refreshCalendarFlag();
  for (const task of get().tasks.filter((t) => !t.isDone && !t.isConflictCopy)) {
    storeCalendarAction(uid, upsertAction(uid, task));
  }
  startCalendarRetry();
  await scheduleCalendarFlush();
}

/**
 * On the web, Google's Calendar access lasts an hour and only a click can
 * renew it. True once, when it has just run out (the caller offers to
 * reconnect).
 */
export function calendarJustExpired(): boolean {
  if (isNative() || !get().calendarConnected) return false;
  refreshCalendarFlag();
  return !get().calendarConnected;
}

/** Connects Google Calendar only after the user presses Connect. */
export async function connectCalendar() {
  const fb = firebase();
  const user = currentFirebaseUser();
  if (!fb || !user || get().authBusy) return;
  const currentSession = captureWorkspaceSession();
  set({ authBusy: true, syncError: null });
  if (isNative()) {
    // Android grants the Calendar scope in place.
    try {
      const email = await calendar.authorize({ interactive: true, email: user.email, uid: user.uid });
      if (!currentSession()) return;
      if (!email) throw new Error(calendar.lastError ?? "Calendar connection was cancelled.");
      if (!(await calendar.verifyAccess())) {
        throw new Error(calendar.lastError ?? "Google Calendar could not be reached.");
      }
      if (!currentSession()) return;
      await enableCalendarAfterConnect(user.uid);
    } catch (error) {
      if (!currentSession()) return;
      calendar.clearSession();
      set({ syncError: `Calendar connection failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      if (currentSession()) { set({ authBusy: false }); refreshCalendarFlag(); }
    }
    return;
  }
  const provider = new GoogleAuthProvider();
  for (const scope of CALENDAR_SCOPES) provider.addScope(scope);
  // The signed-in account, preselected: reconnecting is then a quick window
  // that closes itself once access was given before.
  if (user.email) provider.setCustomParameters({ login_hint: user.email });
  try {
    // Called directly from the Connect button, so Safari opens the account
    // chooser in a small window without navigating this page away.
    const result = await reauthenticateWithPopup(user, provider);
    if (!currentSession()) return;
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token || !result.user.email) throw new Error("Google did not return Calendar access.");
    calendar.connectWithAccessToken(result.user.email, token, user.uid);
    if (!(await calendar.verifyAccess())) {
      throw new Error(calendar.lastError ?? "Google Calendar could not be reached.");
    }
    if (!currentSession()) return;
    await enableCalendarAfterConnect(user.uid);
  } catch (error) {
    if (!currentSession()) return;
    calendar.clearSession();
    const message = String(error);
    if (!message.includes("popup-closed-by-user") && !message.includes("cancelled-popup-request")) {
      set({ syncError: `Calendar connection failed: ${message}` });
    }
  } finally {
    if (currentSession()) { set({ authBusy: false }); refreshCalendarFlag(); }
  }
}

export function disconnectCalendar() {
  const uid = get().user?.uid;
  if (!uid) return;
  calendarEnabled = false;
  prefs.setBool(`calendar.enabled.${uid}`, false);
  stopCalendarRetry();
  calendar.clearSession();
  refreshCalendarFlag();
}

export function reconcileCalendarChanges(before: Map<string, Task>) {
  const uid = get().user?.uid;
  if (!uid || !calendarEnabled) return;
  const current = new Map(get().tasks.map((t) => [t.id, t]));
  for (const old of before.values()) if (!current.has(old.id)) removeTaskFromCalendar(old);
  for (const task of current.values()) {
    const old = before.get(task.id);
    // (Unchanged tasks keep their object across a sync snapshot.)
    if (old === task) continue;
    if (task.isDone) {
      if (old?.isDone !== true && (task.googleEventId != null || (old && hasCalendarExport(old)))) {
        let latest = task;
        if (old && task.calendarEventRevision === old.calendarEventRevision) {
          latest = { ...task, calendarEventRevision: task.calendarEventRevision + 1 };
          patchTaskSilently(task.id, { calendarEventRevision: latest.calendarEventRevision });
          void saveData();
        }
        removeTaskFromCalendar(latest);
      }
    } else if (
      !task.isConflictCopy &&
      (!old || cachedJson(old, encodeTask) !== cachedJson(task, encodeTask))
    ) {
      syncTaskToCalendar(task);
    }
  }
}


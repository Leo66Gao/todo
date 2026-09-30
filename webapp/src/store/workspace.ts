// The workspace store — a port of the Flutter app's TaskProvider. It owns the
// decoded records, turns every mutation into a minimal set of changed records
// (diffed against the last saved encoding) and hands them to cloud sync, or to
// device storage while signed out. Google Calendar export runs through the
// same durable, account-scoped outbox the Flutter app uses.

"use client";

import { create } from "zustand";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { CloudSync } from "@/lib/cloudSync";
import {
  CALENDAR_SCOPES,
  GoogleCalendar,
  calendarActionKey,
  normalizeOutbox,
  type CalendarAction,
} from "@/lib/calendar";
import { plainText } from "@/lib/delta";
import { firebase } from "@/lib/firebase";
import {
  decodeFolder,
  decodeNote,
  decodeProject,
  decodeSettings,
  decodeTask,
  defaultSettings,
  encodeFolder,
  encodeNote,
  encodeProject,
  encodeSettings,
  encodeTask,
  uuid,
  type Project,
  type StudyNote,
  type SubjectFolder,
  type Subtask,
  type Task,
  type WorkspaceSettings,
} from "@/lib/model";
import { isNative, nativeGoogleSignIn, nativeSignOut } from "@/lib/native";
import * as prefs from "@/lib/prefs";
import { sameDay, startOfDay } from "@/lib/time";

type Records = Record<string, string>;

export interface Account {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface WorkspaceState {
  isLoading: boolean;
  authBusy: boolean;
  cloudAvailable: boolean;
  user: Account | null;
  cloudStatus: string;
  cloudError: string | null;
  syncError: string | null;
  calendarConnected: boolean;
  importAvailable: boolean;
  tasks: Task[];
  projects: Project[];
  notes: StudyNote[];
  folders: SubjectFolder[];
  tags: string[];
  settings: WorkspaceSettings;
  /** Other synced records ("settings:…" keys): version history, sources. */
  side: Record<string, string>;
}

export const useWorkspace = create<WorkspaceState>(() => ({
  isLoading: true,
  authBusy: false,
  cloudAvailable: false,
  user: null,
  cloudStatus: "Local only",
  cloudError: null,
  syncError: null,
  calendarConnected: false,
  importAvailable: false,
  tasks: [],
  projects: [],
  notes: [],
  folders: [],
  tags: [],
  settings: defaultSettings(),
  side: {},
}));

const get = () => useWorkspace.getState();
const set = (patch: Partial<WorkspaceState>) => useWorkspace.setState(patch);

// Background work belongs to the session that started it, even if the same
// account signs back in after signing out.
let sessionGeneration = 0;
useWorkspace.subscribe((state, previous) => {
  if (state.user?.uid !== previous.user?.uid) sessionGeneration++;
});
export function captureWorkspaceSession(): () => boolean {
  const generation = sessionGeneration;
  const uid = get().user?.uid;
  return () => generation === sessionGeneration && get().user?.uid === uid;
}

// ---------------------------------------------------------------------------
// Internal (non-rendered) state

let cloud: CloudSync | null = null;
let firebaseUser: User | null = null;
let baseline: Records = {};
let unreadable: Records = {};
const CORE_SETTINGS = new Set(["settings:workspace", "settings:tags", "settings:order"]);
let recordDecodeError: string | null = null;
let authQueue: Promise<void> = Promise.resolve();
let started = false;
/**
 * The account the app opened with from its device cache, before Firebase had
 * confirmed who is signed in (see initialize).
 */
let optimisticUid: string | null = null;
const LAST_ACCOUNT = "lastAccount";

const calendar = new GoogleCalendar();
/** The signed-in account's Google Calendar client (events are read through it too). */
export const calendarClient = () => calendar;
let calendarEnabled = false;
let calendarOwnerUid: string | null = null;
let outbox: Record<string, CalendarAction> = {};
let calendarQueue: Promise<void> = Promise.resolve();
let calendarRetry: ReturnType<typeof setInterval> | null = null;
const CALENDAR_REDIRECT_KEY = "calendar.connectPending";

const refreshCalendarFlag = () =>
  set({
    calendarConnected:
      calendarOwnerUid != null &&
      calendarOwnerUid === get().user?.uid &&
      calendar.isConnected &&
      calendar.email === get().user?.email,
  });

// ---------------------------------------------------------------------------
// Records ⇄ state

// State objects are replaced, never mutated, so an unchanged object keeps its
// encoding and each save only serializes what was edited.
const encoded = new WeakMap<object, string>();
function cachedJson<T extends object>(value: T, encode: (v: T) => unknown): string {
  let json = encoded.get(value);
  if (json === undefined) {
    json = JSON.stringify(encode(value));
    encoded.set(value, json);
  }
  return json;
}

function encodeRecords(state: WorkspaceState = get()): Records {
  const out: Records = {};
  for (const t of state.tasks) out[`task:${t.id}`] = cachedJson(t, encodeTask);
  for (const p of state.projects) out[`project:${p.id}`] = cachedJson(p, encodeProject);
  for (const n of state.notes) out[`note:${n.id}`] = cachedJson(n, encodeNote);
  for (const f of state.folders) out[`folder:${f.id}`] = cachedJson(f, encodeFolder);
  out["settings:workspace"] = JSON.stringify(encodeSettings(state.settings));
  out["settings:tags"] = JSON.stringify(state.tags);
  out["settings:order"] = JSON.stringify(state.tasks.map((t) => t.id));
  return { ...out, ...state.side, ...unreadable };
}

function applyRecords(records: Records) {
  const tasks: Task[] = [];
  const projects: Project[] = [];
  const notes: StudyNote[] = [];
  const folders: SubjectFolder[] = [];
  const side: Record<string, string> = {};
  unreadable = {};
  for (const [key, payload] of Object.entries(records)) {
    try {
      const value = JSON.parse(payload);
      if (key === "settings:order" || key === "settings:tags") {
        if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
          throw new Error("Bad list");
        }
      }
      if (key === "settings:workspace") decodeSettings(value);
      if (key.startsWith("task:")) tasks.push(decodeTask(value));
      if (key.startsWith("project:")) projects.push(decodeProject(value));
      if (key.startsWith("note:")) notes.push(decodeNote(value));
      if (key.startsWith("folder:")) folders.push(decodeFolder(value));
      if (key.startsWith("settings:") && !CORE_SETTINGS.has(key)) side[key] = payload;
    } catch {
      // Keep the payload so a malformed record is never lost or deleted.
      unreadable[key] = payload;
    }
  }
  const count = Object.keys(unreadable).length;
  recordDecodeError =
    count === 0
      ? null
      : `${count} saved records could not be opened. Their data has been preserved.`;
  const readable = (key: string) => (key in unreadable ? undefined : records[key]);
  const order: string[] = readable("settings:order") ? JSON.parse(records["settings:order"]) : [];
  const rank = new Map(order.map((id, i) => [id, i]));
  tasks.sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length));
  const next: Partial<WorkspaceState> = {
    tasks,
    projects,
    notes,
    folders,
    tags: readable("settings:tags") ? JSON.parse(records["settings:tags"]) : ["General", "Urgent"],
    settings: readable("settings:workspace")
      ? decodeSettings(JSON.parse(records["settings:workspace"]))
      : defaultSettings(),
    side,
  };
  set(next);
  baseline = encodeRecords();
}

let saveQueue: Promise<boolean> = Promise.resolve(true);
let saveRetry: ReturnType<typeof setTimeout> | null = null;

/**
 * Saves are serialized so each one diffs against what was actually stored.
 * Resolves to whether the current state is stored (on this device, and queued
 * for the cloud when signed in); a failed save is reported and retried.
 */
function saveData(): Promise<boolean> {
  saveQueue = saveQueue.then(writeChanges, writeChanges);
  return saveQueue;
}

async function writeChanges(): Promise<boolean> {
  const next = encodeRecords();
  const changes: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(next)) if (baseline[key] !== value) changes[key] = value;
  for (const key of Object.keys(baseline)) if (!(key in next)) changes[key] = null;
  if (Object.keys(changes).length === 0) return true;
  try {
    if (get().user && cloud) {
      await cloud.writeChanges(changes);
    } else {
      const stored =
        prefs.setString("activeGuestWorkspace", JSON.stringify(next)) &&
        // The original tasks key stays in step for older builds.
        prefs.setStringList(
          "tasks",
          get().tasks.map((t) => JSON.stringify(encodeTask(t))),
        );
      if (!stored) throw new Error("This browser is blocking device storage.");
    }
    // The baseline only moves once the change is stored, so a failed save is retried.
    baseline = next;
    if (saveRetry) clearTimeout(saveRetry);
    saveRetry = null;
    if (get().cloudError?.startsWith("Could not save")) set({ cloudError: null });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set({
      cloudError: get().user
        ? `Could not save changes on this device: ${message}`
        : `Could not save on this device: ${message}`,
    });
    if (!saveRetry) {
      saveRetry = setTimeout(() => {
        saveRetry = null;
        void saveData();
      }, 5000);
    }
    return false;
  }
}

function readGuestMap(key: string): Records | null {
  const raw = prefs.getRaw(key);
  if (raw == null) return null;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bad map");
    const out: Records = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v !== "string") throw new Error("Bad entry");
      out[k] = v;
    }
    return out;
  } catch {
    prefs.setString(`${key}.recovery`, typeof raw === "string" ? raw : JSON.stringify(raw));
    set({ cloudError: "Damaged device data was backed up for recovery." });
    return null;
  }
}

function readGuestRecords(): Records {
  const active = readGuestMap("activeGuestWorkspace");
  if (active) return active;
  // The pre-account workspace is only visible until the first account claims it.
  if (prefs.getString("legacyOwner") != null) return {};
  const guest = readGuestMap("guestWorkspace");
  if (guest) return guest;
  const out: Records = {};
  for (const raw of prefs.getStringList("tasks") ?? []) {
    try {
      const task = decodeTask(JSON.parse(raw));
      out[`task:${task.id}`] = JSON.stringify(encodeTask(task));
    } catch {
      // Unreadable legacy rows are skipped (Flutter backs them up itself).
    }
  }
  const legacyProjects = prefs.getStringList("projects");
  if (legacyProjects == null) {
    out["project:p1"] = JSON.stringify({ id: "p1", title: "Work", colorValue: 0xff000000 });
    out["project:p2"] = JSON.stringify({ id: "p2", title: "Personal", colorValue: 0xff9e9e9e });
  } else {
    for (const raw of legacyProjects) {
      try {
        const project = decodeProject(JSON.parse(raw));
        out[`project:${project.id}`] = JSON.stringify(encodeProject(project));
      } catch {
        // skipped
      }
    }
  }
  out["settings:tags"] = JSON.stringify(prefs.getStringList("tags") ?? ["General", "Urgent"]);
  return out;
}

function toAccount(user: User): Account {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

// ---------------------------------------------------------------------------
// Startup and accounts

export function startWorkspace() {
  if (started || typeof window === "undefined") return;
  started = true;
  void initialize();
}

async function initialize() {
  try {
    const fb = firebase();
    if (fb) {
      cloud = new CloudSync(fb.db);
      set({ cloudAvailable: true });
      cloud.onRecords = (records) => {
        const before = new Map(get().tasks.map((t) => [t.id, t]));
        applyRecords(records);
        reconcileCalendarChanges(before);
      };
      cloud.onStatus = (status, error) =>
        set({ cloudStatus: status, cloudError: error ?? recordDecodeError });
    }
    // Opening instantly: Firebase takes a moment to confirm who is signed in
    // (and longer offline), so the last account's device copy is shown right
    // away. Edits are queued for it as usual; if someone else turns out to be
    // signed in, the workspace switches over as it always has.
    const last = prefs.getLocal<Account | null>(LAST_ACCOUNT, null);
    if (fb && cloud && last?.uid && prefs.getString("legacyOwner") != null && prefs.getString(`cloud.${last.uid}`) != null) {
      optimisticUid = last.uid;
      const records = await cloud.connect(last.uid);
      set({ user: last });
      applyRecords(records);
      set({ isLoading: false });
    } else {
      applyRecords(readGuestRecords());
      // Never signed in on this device: the local workspace is all there is.
      if (prefs.getString("legacyOwner") == null) set({ isLoading: false });
    }
    if (fb) {
      await new Promise<void>((resolve) => {
        let first = true;
        onAuthStateChanged(fb.auth, (user) => {
          authQueue = authQueue
            .then(() => switchAccount(user))
            .catch((error) => set({ cloudError: String(error), isLoading: false }))
            .finally(() => {
              if (first) {
                first = false;
                resolve();
              }
            });
        });
      });
      await resumeCalendarRedirect();
    }
  } catch (error) {
    set({ cloudError: `Could not load your saved data: ${String(error)}` });
  } finally {
    set({ isLoading: false });
  }
}

async function switchAccount(user: User | null) {
  const hinted = optimisticUid;
  optimisticUid = null;
  if (hinted && user?.uid === hinted) {
    // Already showing this account from the device copy: just finish signing in.
    firebaseUser = user;
    set({ user: toAccount(user) });
    prefs.setLocal(LAST_ACCOUNT, toAccount(user));
    void restoreCalendarForAccount(user).catch((error) => set({ cloudError: String(error) }));
    const importAvailable = prefs.getString("legacyOwner") === user.uid && prefs.getBool(`legacyImported.${user.uid}`) !== true;
    set({ importAvailable });
    if (importAvailable) void importLocalData();
    refreshCalendarFlag();
    return;
  }
  if (!hinted && get().user?.uid === user?.uid) return;
  set({ isLoading: true });
  await cloud!.disconnect();
  stopCalendarRetry();
  calendarOwnerUid = null;
  calendarEnabled = false;
  outbox = {};
  calendar.clearSession();

  let legacyOwner = prefs.getString("legacyOwner");
  if (user && legacyOwner == null) {
    // Freeze the pre-account workspace for the first account to import.
    prefs.setString(`legacyWorkspace.${user.uid}`, JSON.stringify(encodeRecords()));
    prefs.setString("legacyOwner", user.uid);
    prefs.remove("activeGuestWorkspace");
    legacyOwner = user.uid;
  }

  firebaseUser = null;
  unreadable = {};
  recordDecodeError = null;
  baseline = {};
  set({
    user: null,
    cloudError: null,
    tasks: [],
    projects: [],
    notes: [],
    folders: [],
    tags: [],
    settings: defaultSettings(),
    side: {},
  });
  if (!user) {
    prefs.setLocal(LAST_ACCOUNT, null);
    applyRecords(readGuestRecords());
    set({ cloudStatus: "Local only", importAvailable: false });
  } else {
    const records = await cloud!.connect(user.uid);
    firebaseUser = user;
    set({ user: toAccount(user) });
    prefs.setLocal(LAST_ACCOUNT, toAccount(user));
    applyRecords(records);
    // Google Calendar reconnects in the background; the workspace is ready now.
    void restoreCalendarForAccount(user).catch((error) => set({ cloudError: String(error) }));
    const importAvailable =
      legacyOwner === user.uid && prefs.getBool(`legacyImported.${user.uid}`) !== true;
    set({ importAvailable });
    if (importAvailable) void importLocalData();
  }
  refreshCalendarFlag();
  set({ isLoading: false });
}

export async function signInWithGoogle() {
  const fb = firebase();
  if (!fb || get().authBusy) return;
  set({ authBusy: true, cloudError: null });
  try {
    if (isNative()) {
      // Pop-ups don't exist in the app: Android signs in, Firebase takes the token.
      const idToken = await nativeGoogleSignIn();
      if (!idToken) throw new Error("Google did not return a sign-in token.");
      await signInWithCredential(fb.auth, GoogleAuthProvider.credential(idToken));
    } else {
      await signInWithPopup(fb.auth, new GoogleAuthProvider());
    }
  } catch (error) {
    const text = String(error);
    set({
      cloudError: text.includes("popup-blocked")
        ? "The browser blocked the sign-in window. Allow pop-ups for this site, then try again."
        : text.includes("popup-closed-by-user") || text.includes("cancelled-popup-request")
          ? null
          : `Sign-in failed: ${text}`,
    });
  } finally {
    set({ authBusy: false });
  }
}

export async function signOut() {
  const fb = firebase();
  if (!fb || get().authBusy) return;
  set({ authBusy: true });
  try {
    // Note edits wait a few seconds before uploading; send them first.
    await cloud?.flush().catch(() => {});
    calendar.clearSession();
    await nativeSignOut();
    await firebaseSignOut(fb.auth);
    await authQueue;
  } catch (error) {
    set({ cloudError: `Sign-out failed: ${String(error)}` });
  } finally {
    set({ authBusy: false });
  }
}

export async function importLocalData() {
  const uid = get().user?.uid;
  if (!uid || !get().importAvailable || !cloud) return;
  try {
    const raw = prefs.getString(`legacyWorkspace.${uid}`);
    const legacy: Records = raw ? JSON.parse(raw) : {};
    if (get().user?.uid !== uid) return;
    await cloud.importMissing(legacy);
    prefs.setBool(`legacyImported.${uid}`, true);
    if (get().user?.uid === uid) set({ importAvailable: false });
  } catch (error) {
    set({ cloudError: `Local data is safe. Retry the import from Settings: ${String(error)}` });
  }
}

// ---------------------------------------------------------------------------
// Google Calendar

function deterministicEventId(uid: string, task: Task) {
  const bytes = new TextEncoder().encode(`${uid}:${task.id}:${task.calendarEventRevision}`);
  return `td${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function upsertAction(uid: string, task: Task): CalendarAction {
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
  ]);
function markExported(uid: string, taskId: string, fingerprint: string | null) {
  const exported = prefs.getLocal<Record<string, string>>(exportedKey(uid), {});
  if (fingerprint == null) delete exported[taskId];
  else exported[taskId] = fingerprint;
  prefs.setLocal(exportedKey(uid), exported);
}
const persistOutbox = (uid: string) => prefs.setString(outboxKey(uid), JSON.stringify(outbox));

function storeCalendarAction(uid: string, action: CalendarAction) {
  if (calendarOwnerUid !== uid || get().user?.uid !== uid) return;
  outbox[calendarActionKey(action)] = action;
  persistOutbox(uid);
}

const hasCalendarExport = (task: Task) =>
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

function scheduleCalendarFlush(): Promise<void> {
  const uid = get().user?.uid;
  if (!uid) return Promise.resolve();
  calendarQueue = calendarQueue.catch(() => {}).then(() => flushCalendarOutbox(uid));
  return calendarQueue;
}

function syncTaskToCalendar(task: Task) {
  const uid = get().user?.uid;
  if (!uid || !calendarEnabled || task.isDone || task.isConflictCopy) return;
  const action = upsertAction(uid, task);
  outbox[calendarActionKey(action)] = action;
  persistOutbox(uid);
  if (calendarOwnerUid !== uid) return;
  void scheduleCalendarFlush();
}

function removeTaskFromCalendar(task: Task) {
  const uid = get().user?.uid;
  if (!uid || !calendarEnabled) return;
  enqueueCalendarDeletion(uid, task);
  if (calendarOwnerUid !== uid) return;
  void scheduleCalendarFlush();
}

/** Replaces one stored task without a save (calendar bookkeeping). */
function patchTaskSilently(id: string, patch: Partial<Task>) {
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

function stopCalendarRetry() {
  if (calendarRetry) clearInterval(calendarRetry);
  calendarRetry = null;
}

function startCalendarRetry() {
  stopCalendarRetry();
  calendarRetry = setInterval(() => void keepCalendarAlive(), 30000);
}

async function keepCalendarAlive() {
  const user = get().user;
  if (!user || !calendarEnabled) return;
  refreshCalendarFlag();
  if (!get().calendarConnected && isNative()) {
    const email = await calendar.authorize({ interactive: false, email: user.email, uid: user.uid });
    if (get().user?.uid !== user.uid) return;
    if (email && email === user.email) refreshCalendarFlag();
  }
  if (get().calendarConnected) void scheduleCalendarFlush();
}

async function restoreCalendarForAccount(user: User) {
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
  if (!navigator.onLine) {
    // Offline, Google can't be asked: open straight away and reconnect later.
    window.addEventListener("online", () => void (get().user?.uid === user.uid && restoreCalendarForAccount(user)), { once: true });
    return;
  }
  const email = await calendar.authorize({ interactive: false, email: user.email, uid: user.uid });
  if (get().user?.uid !== user.uid) return;
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

/** Connects Google Calendar only after the user presses Connect. */
export async function connectCalendar() {
  const fb = firebase();
  const user = firebaseUser;
  if (!fb || !user || get().authBusy) return;
  set({ authBusy: true, syncError: null });
  if (isNative()) {
    // Android grants the Calendar scope in place.
    try {
      const email = await calendar.authorize({ interactive: true, email: user.email, uid: user.uid });
      if (!email) throw new Error(calendar.lastError ?? "Calendar connection was cancelled.");
      if (!(await calendar.verifyAccess())) {
        throw new Error(calendar.lastError ?? "Google Calendar could not be reached.");
      }
      await enableCalendarAfterConnect(user.uid);
    } catch (error) {
      calendar.clearSession();
      set({ syncError: `Calendar connection failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      set({ authBusy: false });
      refreshCalendarFlag();
    }
    return;
  }
  const provider = new GoogleAuthProvider();
  for (const scope of CALENDAR_SCOPES) provider.addScope(scope);
  try {
    // Called directly from the Connect button, so Safari opens the account
    // chooser in a small window without navigating this page away.
    const result = await reauthenticateWithPopup(user, provider);
    if (get().user?.uid !== user.uid) return;
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token || !result.user.email) throw new Error("Google did not return Calendar access.");
    calendar.connectWithAccessToken(result.user.email, token, user.uid);
    if (!(await calendar.verifyAccess())) {
      throw new Error(calendar.lastError ?? "Google Calendar could not be reached.");
    }
    await enableCalendarAfterConnect(user.uid);
  } catch (error) {
    calendar.clearSession();
    const message = String(error);
    if (!message.includes("popup-closed-by-user") && !message.includes("cancelled-popup-request")) {
      set({ syncError: `Calendar connection failed: ${message}` });
    }
  } finally {
    set({ authBusy: false });
    refreshCalendarFlag();
  }
}

/** Finishes a redirect that started in an older build of the app. */
async function resumeCalendarRedirect() {
  const fb = firebase();
  const pendingUid = prefs.getString(CALENDAR_REDIRECT_KEY);
  if (!fb || !pendingUid) return;
  prefs.remove(CALENDAR_REDIRECT_KEY);
  try {
    const result = await getRedirectResult(fb.auth);
    const token = result ? GoogleAuthProvider.credentialFromResult(result)?.accessToken : null;
    const user = result?.user;
    if (!token || !user?.email || user.uid !== pendingUid) {
      set({ syncError: "Calendar connection was cancelled." });
      return;
    }
    calendar.connectWithAccessToken(user.email, token, user.uid);
    if (!(await calendar.verifyAccess())) {
      throw new Error(calendar.lastError ?? "Google Calendar could not be reached.");
    }
    await enableCalendarAfterConnect(user.uid);
  } catch (error) {
    calendar.clearSession();
    set({ syncError: `Calendar connection failed: ${error instanceof Error ? error.message : String(error)}` });
  } finally {
    refreshCalendarFlag();
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

function reconcileCalendarChanges(before: Map<string, Task>) {
  const uid = get().user?.uid;
  if (!uid || !calendarEnabled) return;
  const current = new Map(get().tasks.map((t) => [t.id, t]));
  for (const old of before.values()) if (!current.has(old.id)) removeTaskFromCalendar(old);
  for (const task of current.values()) {
    const old = before.get(task.id);
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
      (!old || JSON.stringify(encodeTask(old)) !== JSON.stringify(encodeTask(task)))
    ) {
      syncTaskToCalendar(task);
    }
  }
}

// ---------------------------------------------------------------------------
// Milestones: dated subtasks appear as their own (virtual) tasks.

export const milestoneId = (parentId: string, subtaskId: string) =>
  `milestone:${parentId}:${subtaskId}`;

export function milestonesOf(tasks: Task[]): Task[] {
  const out: Task[] = [];
  for (const parent of tasks) {
    for (const sub of parent.subtasks) {
      if (!sub.date) continue;
      out.push({
        id: milestoneId(parent.id, sub.id),
        title: sub.title,
        notes: "",
        isDone: parent.isDone || sub.isDone,
        date: sub.date,
        type: "todo",
        priority: sub.priority ?? parent.priority,
        difficulty: sub.difficulty ?? parent.difficulty,
        durationMinutes: 0,
        projectId: parent.projectId,
        parentTaskId: parent.id,
        category: parent.category,
        startTime: null,
        remainingMinutes: 0,
        subtasks: [],
        googleEventId: null,
        calendarEventRevision: 0,
        isConflictCopy: false,
        milestone: { parentId: parent.id, subtaskId: sub.id },
      });
    }
  }
  return out;
}

function findMilestone(id: string): [Task, Subtask] | null {
  if (!id.startsWith("milestone:")) return null;
  for (const parent of get().tasks) {
    for (const sub of parent.subtasks) {
      if (id === milestoneId(parent.id, sub.id)) return [parent, sub];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mutations

function replaceTask(next: Task) {
  set({ tasks: get().tasks.map((t) => (t.id === next.id ? next : t)) });
}

function mapSubtasks(taskId: string, fn: (subs: Subtask[]) => Subtask[]) {
  const task = get().tasks.find((t) => t.id === taskId);
  if (!task) return;
  replaceTask({ ...task, subtasks: fn(task.subtasks) });
  void saveData();
}

export function newTask(partial: Partial<Task> & Pick<Task, "title" | "date">): Task {
  return {
    id: uuid(),
    notes: "",
    isDone: false,
    type: "todo",
    priority: "none",
    difficulty: 1,
    durationMinutes: 0,
    projectId: null,
    parentTaskId: null,
    category: "General",
    startTime: null,
    remainingMinutes: 0,
    subtasks: [],
    googleEventId: null,
    calendarEventRevision: 0,
    isConflictCopy: false,
    ...partial,
  };
}

export function addTask(task: Task, index?: number) {
  const tasks = [...get().tasks];
  if (index == null || index < 0 || index > tasks.length) tasks.push(task);
  else tasks.splice(index, 0, task);
  set({ tasks });
  if (calendarEnabled) syncTaskToCalendar(task);
  void saveData();
}

export function updateTask(task: Task) {
  const milestone = findMilestone(task.id);
  if (milestone) {
    const [parent, sub] = milestone;
    mapSubtasks(parent.id, (subs) =>
      subs.map((s) =>
        s.id === sub.id ? { ...s, title: task.title, date: task.date, isDone: task.isDone } : s,
      ),
    );
    return;
  }
  const previous = get().tasks.find((t) => t.id === task.id);
  if (!previous) return;
  let next = task;
  if (
    !previous.isDone &&
    task.isDone &&
    hasCalendarExport(previous) &&
    task.calendarEventRevision === previous.calendarEventRevision
  ) {
    next = { ...task, calendarEventRevision: task.calendarEventRevision + 1 };
  }
  replaceTask(next);
  if (calendarEnabled) {
    if (next.isDone) removeTaskFromCalendar(next);
    else syncTaskToCalendar(next);
  }
  void saveData();
}

export function patchTask(id: string, patch: Partial<Task>) {
  const task = get().tasks.find((t) => t.id === id);
  if (task) updateTask({ ...task, ...patch });
  else {
    const milestone = findMilestone(id);
    if (milestone) {
      const [parent, sub] = milestone;
      updateTask({
        ...milestonesOf([parent]).find((m) => m.milestone?.subtaskId === sub.id)!,
        ...patch,
      });
    }
  }
}

export function deleteTask(id: string) {
  const milestone = findMilestone(id);
  if (milestone) {
    deleteSubtask(milestone[0].id, milestone[1].id);
    return;
  }
  const task = get().tasks.find((t) => t.id === id);
  if (!task) return;
  if (calendarEnabled) removeTaskFromCalendar(task);
  set({ tasks: get().tasks.filter((t) => t.id !== id) });
  void saveData();
}

export function toggleTask(id: string) {
  const milestone = findMilestone(id);
  if (milestone) {
    if (!milestone[0].isDone) toggleSubtask(milestone[0].id, milestone[1].id);
    return;
  }
  const task = get().tasks.find((t) => t.id === id);
  if (!task) return;
  let next: Task = { ...task, isDone: !task.isDone };
  if (next.isDone) {
    // A new revision stops a later reopen from reusing a deleted event ID.
    if (hasCalendarExport(task)) {
      next = { ...next, calendarEventRevision: next.calendarEventRevision + 1 };
      replaceTask(next);
      if (calendarEnabled) removeTaskFromCalendar(next);
    } else {
      replaceTask(next);
    }
  } else {
    replaceTask(next);
    if (calendarEnabled) syncTaskToCalendar(next);
  }
  void saveData();
}

export const addSubtask = (taskId: string, title: string) =>
  mapSubtasks(taskId, (subs) => [
    ...subs,
    { id: uuid(), title, isDone: false, date: null, priority: null, difficulty: null },
  ]);

export const addSubtaskFull = (taskId: string, subtask: Subtask, index?: number) =>
  mapSubtasks(taskId, (subs) => {
    const next = [...subs];
    if (index == null || index > next.length) next.push(subtask);
    else next.splice(index, 0, subtask);
    return next;
  });

export const updateSubtask = (taskId: string, subtask: Subtask) =>
  mapSubtasks(taskId, (subs) => subs.map((s) => (s.id === subtask.id ? subtask : s)));

export const toggleSubtask = (taskId: string, subtaskId: string) =>
  mapSubtasks(taskId, (subs) => subs.map((s) => (s.id === subtaskId ? { ...s, isDone: !s.isDone } : s)));

export const deleteSubtask = (taskId: string, subtaskId: string) =>
  mapSubtasks(taskId, (subs) => subs.filter((s) => s.id !== subtaskId));

export const reorderSubtasks = (taskId: string, orderedIds: string[]) =>
  mapSubtasks(taskId, (subs) => {
    const byId = new Map(subs.map((s) => [s.id, s]));
    const ordered = orderedIds.map((id) => byId.get(id)).filter((s): s is Subtask => !!s);
    return [...ordered, ...subs.filter((s) => !orderedIds.includes(s.id))];
  });

export const scheduleSubtask = (taskId: string, subtaskId: string, date: Date | null) =>
  mapSubtasks(taskId, (subs) => subs.map((s) => (s.id === subtaskId ? { ...s, date } : s)));

/** Moves a task to another day, keeping its start time. */
export function rescheduleTask(id: string, day: Date) {
  const milestone = findMilestone(id);
  if (milestone) {
    scheduleSubtask(milestone[0].id, milestone[1].id, startOfDay(day));
    return;
  }
  const task = get().tasks.find((t) => t.id === id);
  if (!task) return;
  const date = startOfDay(day);
  const startTime = task.startTime
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), task.startTime.getHours(), task.startTime.getMinutes())
    : null;
  updateTask({ ...task, date, startTime });
}

/**
 * Domino effect: shifts every timed task on [day] that starts after
 * [afterTime] by [deltaMs] — the amount the edited task moved.
 */
export function applyDominoShift(excludeId: string, day: Date, afterTime: Date, deltaMs: number) {
  if (deltaMs === 0) return;
  const moved: Task[] = [];
  const tasks = get().tasks.map((other) => {
    if (other.id === excludeId || !other.startTime || !sameDay(other.date, day)) return other;
    if (other.startTime.getTime() <= afterTime.getTime()) return other;
    const shifted = new Date(other.startTime.getTime() + deltaMs);
    const next = { ...other, date: startOfDay(shifted), startTime: shifted };
    moved.push(next);
    return next;
  });
  if (moved.length === 0) return;
  set({ tasks });
  // Only the tasks that moved change in Calendar (including any whose first
  // export is still queued).
  if (calendarEnabled) for (const t of moved) syncTaskToCalendar(t);
  void saveData();
}

export function updateTaskNotes(taskId: string, notes: string) {
  const task = get().tasks.find((t) => t.id === taskId);
  if (!task || task.notes === notes) return;
  const next = { ...task, notes };
  replaceTask(next);
  // A task whose first export is still queued gets the new notes too.
  if (calendarEnabled && hasCalendarExport(task)) syncTaskToCalendar(next);
  void saveData();
}

/**
 * Reorders the stored list so [movedId] lands right before [beforeId]
 * (or at the end of the list when null).
 */
export function moveTaskBefore(movedId: string, beforeId: string | null) {
  const tasks = [...get().tasks];
  const from = tasks.findIndex((t) => t.id === movedId);
  if (from < 0) return;
  const [moving] = tasks.splice(from, 1);
  const to = beforeId ? tasks.findIndex((t) => t.id === beforeId) : -1;
  if (to < 0) tasks.push(moving);
  else tasks.splice(to, 0, moving);
  set({ tasks });
  void saveData();
}

export function addProject(project: Project) {
  set({ projects: [...get().projects, project] });
  void saveData();
}

export function updateProject(project: Project) {
  set({ projects: get().projects.map((p) => (p.id === project.id ? project : p)) });
  void saveData();
}

export function deleteProject(id: string) {
  set({
    projects: get().projects.filter((p) => p.id !== id),
    tasks: get().tasks.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)),
    // Notes and folders stay, without a subject (as the delete dialog says).
    notes: get().notes.map((n) => (n.subjectId === id ? { ...n, subjectId: null } : n)),
    folders: get().folders.map((f) => (f.subjectId === id ? { ...f, subjectId: null } : f)),
  });
  void saveData();
}

export function reorderProjects(orderedIds: string[]) {
  const byId = new Map(get().projects.map((p) => [p.id, p]));
  const projects = orderedIds.map((id) => byId.get(id)).filter((p): p is Project => !!p);
  set({ projects: [...projects, ...get().projects.filter((p) => !orderedIds.includes(p.id))] });
  void saveData();
}

export function addNote(note: StudyNote, index?: number) {
  const notes = [...get().notes];
  if (index == null || index < 0 || index > notes.length) notes.push(note);
  else notes.splice(index, 0, note);
  set({ notes });
  void saveData();
}

export function updateNote(note: StudyNote) {
  if (!get().notes.some((n) => n.id === note.id)) return;
  set({ notes: get().notes.map((n) => (n.id === note.id ? note : n)) });
  void saveData();
}

/** A synced side record, parsed (or the fallback when missing or unreadable). */
const parsedSide = new Map<string, { payload: string; value: unknown }>();
export function readSide<T>(key: string, fallback: T): T {
  const payload = get().side[key];
  if (payload === undefined) return fallback;
  const cached = parsedSide.get(key);
  if (cached?.payload === payload) return cached.value as T;
  try {
    const value = JSON.parse(payload) as T;
    parsedSide.set(key, { payload, value });
    return value;
  } catch {
    return fallback;
  }
}

export function writeSide(key: string, value: unknown | null) {
  if (!key.startsWith("settings:") || CORE_SETTINGS.has(key)) throw new Error(`Not a side record: ${key}`);
  const side = { ...get().side };
  if (value == null) delete side[key];
  else side[key] = JSON.stringify(value);
  set({ side });
  void saveData();
}

export function deleteNote(id: string) {
  // Its version history goes with it.
  const side = { ...get().side };
  delete side[`settings:versions:${id}`];
  set({ notes: get().notes.filter((n) => n.id !== id), side });
  void saveData();
}

export function addFolder(folder: SubjectFolder) {
  set({ folders: [...get().folders, folder] });
  void saveData();
}

export function renameFolder(id: string, name: string) {
  set({ folders: get().folders.map((f) => (f.id === id ? { ...f, name } : f)) });
  void saveData();
}

export function deleteFolder(id: string) {
  set({
    folders: get().folders.filter((f) => f.id !== id),
    notes: get().notes.map((n) => (n.folderId === id ? { ...n, folderId: null } : n)),
  });
  void saveData();
}

export function updateSettings(settings: WorkspaceSettings) {
  set({ settings });
  void saveData();
}

/** The deletion is stored on this device but hasn't reached the cloud yet. */
export class UploadPendingError extends Error {}

/**
 * Deletes everything. Resolves only once the deletion is stored — and, when
 * signed in, acknowledged by the cloud; otherwise it throws with the reason
 * (the deletion stays queued and keeps retrying).
 */
export async function clearWorkspace() {
  if (calendarEnabled) for (const t of get().tasks) removeTaskFromCalendar(t);
  set({
    tasks: [],
    projects: [],
    notes: [],
    folders: [],
    tags: [],
    settings: defaultSettings(),
    side: {},
  });
  const stored = await saveData();
  // Signed in, the cloud is what counts (even if the device copy failed).
  if (get().user && cloud) {
    try {
      await cloud.uploadNow();
    } catch (error) {
      throw new UploadPendingError(error instanceof Error ? error.message : String(error));
    }
  } else if (!stored) {
    throw new Error(get().cloudError ?? "The deletion could not be saved on this device.");
  }
}

/** Test/dev hook: replaces the signed-out workspace with [records]. */
export function loadGuestRecords(records: Records) {
  if (get().user) return;
  applyRecords(records);
  baseline = {};
  void saveData();
}

"use client";

// The focus timer: one session at a time, for a task or on its own. It
// survives reloads. On the phone it also runs outside the app: an ongoing
// notification counts down (with Pause and Stop), and each round's end
// alerts and moves on with the app closed (FocusTimer.java). When a task's
// session ends, the minutes of focus come off the task's remaining time.

import { registerPlugin } from "@capacitor/core";
import { create } from "zustand";
import { isNative } from "./native";
import { getLocal, setLocal } from "./prefs";

export interface FocusSession {
  taskId: string | null;
  title: string;
  /** Length of the session, in ms (grows with "+5 min"). */
  length: number;
  /** When it ends, while running. */
  endsAt: number | null;
  /** Time left, while paused. */
  left: number | null;
  /** A break follows a focus session. */
  kind: "focus" | "break";
  /** A task's time split into rounds (40 minutes of focus, 5 of break). */
  plan?: { blocks: FocusBlock[]; index: number } | null;
}

export interface FocusBlock {
  kind: "focus" | "break";
  ms: number;
}

export const POMODORO_FOCUS = 40;
export const POMODORO_BREAK = 5;

const STORE = "focus.session";
export const FOCUS_NOTIFICATION_ID = 1_999_000_001;

export const useFocus = create<{ session: FocusSession | null; expanded: boolean; nativeError: string | null }>(() => ({
  session: typeof window === "undefined" ? null : getLocal<FocusSession | null>(STORE, null),
  expanded: false,
  /** Why the phone's timer (notification and alerts) didn't take the last change, if it didn't. */
  nativeError: null,
}));

/** Bumped by every change made in the app, so a read of the phone's timer that started before one is dropped. */
let generation = 0;

const save = (session: FocusSession | null) => {
  generation++;
  setLocal(STORE, session);
  useFocus.setState({ session });
  void scheduleEnd(session);
};

export const timeLeft = (s: FocusSession, now = Date.now()) => Math.max(0, s.endsAt != null ? s.endsAt - now : (s.left ?? 0));

/** Focus time spent so far in a session (breaks don't count). */
export function focusedMs(s: FocusSession, now = Date.now()) {
  const current = s.kind === "focus" ? Math.max(0, s.length - timeLeft(s, now)) : 0;
  if (!s.plan) return current;
  return s.plan.blocks.slice(0, s.plan.index).reduce((sum, b) => sum + (b.kind === "focus" ? b.ms : 0), 0) + current;
}

let logger: ((taskId: string, minutes: number) => void) | null = null;
/** Credits made before the logger was set (a stop from the notification, found at startup). */
let unlogged: [string, number][] = [];
/** Where a task's minutes of focus go when its session ends. */
export const setFocusLogger = (log: typeof logger) => {
  logger = log;
  if (!log) return;
  const waiting = unlogged;
  unlogged = [];
  for (const [taskId, minutes] of waiting) log(taskId, minutes);
};

/** Credits a session's focus time, as of [at], to its task. */
function credit(s: FocusSession | null, at = Date.now()) {
  if (!s?.taskId) return;
  const minutes = Math.floor(focusedMs(advanced(s, at), at) / 60_000);
  if (minutes < 1) return;
  if (logger) logger(s.taskId, minutes);
  else unlogged.push([s.taskId, minutes]);
}

/** Ends the current session, crediting its focus time to its task. */
function finishCurrent() {
  advanceFocus();
  credit(useFocus.getState().session);
}

export function startFocus(minutes: number, task?: { id: string; title: string } | null, kind: FocusSession["kind"] = "focus") {
  finishCurrent();
  const length = Math.round(minutes * 60_000);
  save({ taskId: task?.id ?? null, title: task?.title ?? "", length, endsAt: Date.now() + length, left: null, kind });
  useFocus.setState({ expanded: false });
  void requestAlerts();
}

/** Rounds of focus and break that add up to `minutes` of focus. */
export function pomodoroBlocks(minutes: number): FocusBlock[] {
  const blocks: FocusBlock[] = [];
  let left = Math.max(1, Math.round(minutes));
  while (left > 0) {
    const focus = Math.min(POMODORO_FOCUS, left);
    blocks.push({ kind: "focus", ms: focus * 60_000 });
    left -= focus;
    if (left > 0) blocks.push({ kind: "break", ms: POMODORO_BREAK * 60_000 });
  }
  return blocks;
}

/**
 * Focus on a task for as long as it takes (its planned time, or one round
 * when it has none), in rounds of 40 minutes with 5-minute breaks between.
 * The timer opens so it's clear it has started.
 */
export function startTaskFocus(task: { id: string; title: string }, minutes: number) {
  finishCurrent();
  const blocks = pomodoroBlocks(minutes > 0 ? minutes : POMODORO_FOCUS);
  save({
    taskId: task.id,
    title: task.title,
    length: blocks[0].ms,
    endsAt: Date.now() + blocks[0].ms,
    left: null,
    kind: "focus",
    plan: blocks.length > 1 ? { blocks, index: 0 } : null,
  });
  useFocus.setState({ expanded: true });
  void requestAlerts();
}

/**
 * Moves a planned session on to its next round once the current one is over
 * (catching up on rounds that ended while the app was closed). Returns
 * whether it moved.
 */
export function advanceFocus(now = Date.now()): boolean {
  const s = useFocus.getState().session;
  if (!s) return false;
  const next = advanced(s, now);
  if (next === s) return false;
  save(next);
  return true;
}

/** [s] moved on past the rounds that are over by [now] (the same session when none are). */
function advanced(s: FocusSession, now: number): FocusSession {
  if (!s.plan) return s;
  const { blocks } = s.plan;
  let out = s;
  while (out.plan && out.endsAt != null && out.endsAt <= now && out.plan.index < blocks.length - 1) {
    const index: number = out.plan.index + 1;
    const block: FocusBlock = blocks[index];
    out = { ...out, kind: block.kind, length: block.ms, endsAt: out.endsAt + block.ms, left: null, plan: { blocks, index } };
  }
  return out;
}

/** Time left in the whole planned session, breaks included (or just this round). */
export function totalLeft(s: FocusSession, now = Date.now()) {
  const later = s.plan ? s.plan.blocks.slice(s.plan.index + 1).reduce((sum, b) => sum + b.ms, 0) : 0;
  return timeLeft(s, now) + later;
}

/** Which round of focus this is, and how many there are. */
export function focusRound(s: FocusSession) {
  if (!s.plan) return null;
  const focusBlocks = s.plan.blocks.filter((b) => b.kind === "focus").length;
  const done = s.plan.blocks.slice(0, s.plan.index + 1).filter((b) => b.kind === "focus").length;
  const next = s.plan.blocks[s.plan.index + 1] ?? null;
  return { round: Math.max(1, done), of: focusBlocks, next };
}

export function pauseFocus() {
  const s = useFocus.getState().session;
  if (!s || s.endsAt == null) return;
  save({ ...s, endsAt: null, left: timeLeft(s) });
}

export function resumeFocus() {
  const s = useFocus.getState().session;
  if (!s || s.left == null) return;
  save({ ...s, endsAt: Date.now() + s.left, left: null });
}

export function extendFocus(minutes: number) {
  const s = useFocus.getState().session;
  if (!s) return;
  const add = minutes * 60_000;
  const running = s.endsAt != null;
  // Extending a finished session starts it again from now.
  const base = running ? Math.max(Date.now(), s.endsAt!) : null;
  const length = s.length + add;
  save({
    ...s,
    length,
    // The round itself grows, so moving on to the break credits all of it.
    plan: s.plan ? { ...s.plan, blocks: s.plan.blocks.map((b, i) => (i === s.plan!.index ? { ...b, ms: length } : b)) } : s.plan,
    endsAt: running ? base! + add : null,
    left: running ? null : (s.left ?? 0) + add,
  });
}

export function stopFocus() {
  finishCurrent();
  save(null);
  useFocus.setState({ expanded: false });
}

export const setFocusExpanded = (expanded: boolean) => useFocus.setState({ expanded });

// ---------------------------------------------------------------------------
// Telling the user it's over

async function requestAlerts() {
  if (isNative()) {
    // (Without permission the timer still runs; only the alerts are missing.)
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      if ((await LocalNotifications.checkPermissions()).display !== "granted") await LocalNotifications.requestPermissions();
    } catch { /* Asked again at the next session. */ }
  } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

export const MAX_FOCUS_NOTIFICATIONS = 40;
export const isFocusNotification = (id: number) => id >= FOCUS_NOTIFICATION_ID && id < FOCUS_NOTIFICATION_ID + MAX_FOCUS_NOTIFICATIONS;

// ---------------------------------------------------------------------------
// On the phone: the notification and the round ends live natively

interface NativeFocusState {
  /** Whose session it is (carried through untouched by the phone's timer). */
  taskId?: string | null;
  title: string;
  blocks: FocusBlock[];
  index: number;
  endsAt: number;
  left: number;
  paused: boolean;
}

/** The session as it was when Stop was pressed in the notification. */
interface StoppedNativeState extends NativeFocusState {
  stoppedAt: number;
  stoppedRev: number;
}

interface FocusTimerPlugin {
  update(options: { state: NativeFocusState | null }): Promise<void>;
  get(): Promise<{ rev: number; state: NativeFocusState | null; opened: boolean; stopped?: StoppedNativeState | null }>;
  addListener(event: "changed" | "open", listener: () => void): Promise<{ remove: () => void }>;
}
const FocusTimer = registerPlugin<FocusTimerPlugin>("FocusTimer");

/** The session as the phone's timer keeps it: every round, which one is on, and when it ends. */
export function toNative(s: FocusSession): NativeFocusState {
  const blocks = s.plan ? s.plan.blocks.map((b, i) => (i === s.plan!.index ? { ...b, ms: s.length } : b)) : [{ kind: s.kind, ms: s.length }];
  const paused = s.endsAt == null;
  return { taskId: s.taskId, title: s.title, blocks, index: s.plan?.index ?? 0, endsAt: s.endsAt ?? 0, left: paused ? (s.left ?? 0) : 0, paused };
}

/** What the phone's timer did (a button in the notification, rounds that ended) as the app's session. */
export function fromNative(n: NativeFocusState, current: FocusSession | null): FocusSession {
  const index = Math.min(n.index, n.blocks.length - 1);
  const block = n.blocks[index];
  return {
    // (Older builds' state has no task: then it's still the app's own session.)
    taskId: n.taskId !== undefined ? n.taskId : (current?.taskId ?? null),
    title: n.title,
    length: block.ms,
    endsAt: n.paused ? null : n.endsAt,
    left: n.paused ? n.left : null,
    kind: block.kind,
    plan: n.blocks.length > 1 ? { blocks: n.blocks, index } : null,
  };
}

const REV = "focus.nativeRev";
let legacyCleared = false;

let nativeQueue: Promise<void> = Promise.resolve();

/** Sends the session to the phone's timer, in order (a quick pause and resume can't arrive swapped). */
function scheduleEnd(session: FocusSession | null) {
  if (!isNative()) return Promise.resolve();
  nativeQueue = nativeQueue
    .then(() => sendToNative(session))
    .then(
      () => {
        if (useFocus.getState().nativeError) useFocus.setState({ nativeError: null });
      },
      (e) => useFocus.setState({ nativeError: e instanceof Error ? e.message : String(e) }),
    );
  return nativeQueue;
}

/** Sends the current session to the phone's timer again (after it failed). */
export const retryNativeTimer = () => scheduleEnd(useFocus.getState().session);

async function sendToNative(session: FocusSession | null) {
  // Before the native timer, round ends were scheduled local notifications.
  if (!legacyCleared) {
    legacyCleared = true;
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({
      notifications: Array.from({ length: MAX_FOCUS_NOTIFICATIONS }, (_, i) => ({ id: FOCUS_NOTIFICATION_ID + i })),
    }).catch(() => {});
  }
  const live = session && (session.endsAt == null ? (session.left ?? 0) > 0 : totalLeft(session) > 0);
  await FocusTimer.update({ state: live ? toNative(session) : null });
}

/** Takes in what was done from the notification since the app last looked. */
async function syncFromNative() {
  const asked = generation;
  const result = await FocusTimer.get().catch(() => null);
  if (!result) return;
  // Started or changed here while asking: what the timer said is out of date,
  // and the app's change (on its way to the timer) replaces it.
  if (asked !== generation) {
    setLocal(REV, result.rev);
    return;
  }
  if (result.opened && useFocus.getState().session) useFocus.setState({ expanded: true });
  const known = getLocal<number | null>(REV, null);
  setLocal(REV, result.rev);
  const current = useFocus.getState().session;
  // Changed from the notification; or the app lost its copy (the web view
  // keeps storage a moment before writing it, and a killed app loses that).
  const adopt = (known != null && known !== result.rev) || (!current && result.state != null);
  if (!adopt) return;
  const session = result.state ? fromNative(result.state, current) : null;
  // Stopped or finished on the phone while the app slept: the time studied still comes off the task.
  const stopped = result.stopped;
  const same = !!current && !!stopped && (stopped.taskId === undefined || stopped.taskId === current.taskId);
  if (!session && same && stopped.stoppedRev === result.rev) credit(fromNative(stopped, current), stopped.stoppedAt);
  setLocal(STORE, session);
  useFocus.setState({ session, ...(session ? {} : { expanded: false }) });
}

/** On the phone: keeps the app's timer and the notification's in step. */
export function startFocusBridge() {
  if (!isNative()) return;
  void syncFromNative().then(() => scheduleEnd(useFocus.getState().session));
  void FocusTimer.addListener("changed", () => void syncFromNative());
  void FocusTimer.addListener("open", () => {
    if (useFocus.getState().session) useFocus.setState({ expanded: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncFromNative();
  });
}

/** In the browser, while the page is open: a notification and a soft chime. */
export function announceEnd(session: FocusSession) {
  if (isNative()) return;
  chime();
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
    new Notification(session.kind === "break" ? "Break’s over" : "Time’s up", {
      body: session.kind === "break" ? "Back to it when you’re ready." : session.title || "Your focus session has ended.",
      tag: "focus",
    });
  }
}

function chime() {
  try {
    const audio = new AudioContext();
    const now = audio.currentTime;
    // Two soft sine notes, a fifth apart.
    [659.25, 987.77].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 1.25);
    });
    setTimeout(() => void audio.close(), 2000);
  } catch {
    // No audio: the notification and the timer's own state are enough.
  }
}

/** Focus lengths offered for a task: common ones, plus the task's own time. */
export function focusLengths(minutes?: number): number[] {
  const options = [25, 45, 60];
  if (minutes && minutes >= 10 && minutes <= 180 && !options.includes(minutes)) options.push(minutes);
  return options.sort((a, b) => a - b);
}

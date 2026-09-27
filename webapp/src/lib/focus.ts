"use client";

// The focus timer: one session at a time, for a task or on its own. It
// survives reloads, and on the phone the end is a scheduled notification, so
// it arrives even with the app closed. Nothing is recorded afterwards.

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

export const useFocus = create<{ session: FocusSession | null; expanded: boolean }>(() => ({
  session: typeof window === "undefined" ? null : getLocal<FocusSession | null>(STORE, null),
  expanded: false,
}));

const save = (session: FocusSession | null) => {
  setLocal(STORE, session);
  useFocus.setState({ session });
  void scheduleEnd(session);
};

export const timeLeft = (s: FocusSession, now = Date.now()) => Math.max(0, s.endsAt != null ? s.endsAt - now : (s.left ?? 0));

export function startFocus(minutes: number, task?: { id: string; title: string } | null, kind: FocusSession["kind"] = "focus") {
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
  let s: FocusSession | null = useFocus.getState().session;
  if (!s?.plan || s.endsAt == null || s.endsAt > now) return false;
  const { blocks } = s.plan;
  let moved = false;
  while (s.plan && s.endsAt != null && s.endsAt <= now && s.plan.index < blocks.length - 1) {
    const index: number = s.plan.index + 1;
    const block: FocusBlock = blocks[index];
    s = { ...s, kind: block.kind, length: block.ms, endsAt: s.endsAt + block.ms, left: null, plan: { blocks, index } };
    moved = true;
  }
  if (moved) save(s);
  return moved;
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
  save({
    ...s,
    length: s.length + add,
    endsAt: running ? base! + add : null,
    left: running ? null : (s.left ?? 0) + add,
  });
}

export function stopFocus() {
  save(null);
  useFocus.setState({ expanded: false });
}

export const setFocusExpanded = (expanded: boolean) => useFocus.setState({ expanded });

// ---------------------------------------------------------------------------
// Telling the user it's over

async function requestAlerts() {
  if (isNative()) {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    if ((await LocalNotifications.checkPermissions()).display !== "granted") await LocalNotifications.requestPermissions();
  } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

const MAX_ROUNDS = 40;

async function scheduleEnd(session: FocusSession | null) {
  if (!isNative()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.cancel({
    notifications: Array.from({ length: MAX_ROUNDS }, (_, i) => ({ id: FOCUS_NOTIFICATION_ID + i })),
  }).catch(() => {});
  if (!session?.endsAt || session.endsAt <= Date.now()) return;
  if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
  // The end of this round, and of each round after it, so they arrive with the app closed.
  const ends: { at: number; kind: FocusBlock["kind"]; last: boolean }[] = [];
  const blocks = session.plan?.blocks ?? [];
  const index = session.plan?.index ?? 0;
  let at = session.endsAt;
  ends.push({ at, kind: session.kind, last: !session.plan || index === blocks.length - 1 });
  for (let i = index + 1; i < blocks.length && ends.length < MAX_ROUNDS; i++) {
    at += blocks[i].ms;
    ends.push({ at, kind: blocks[i].kind, last: i === blocks.length - 1 });
  }
  await LocalNotifications.schedule({
    notifications: ends.map((end, i) => ({
      id: FOCUS_NOTIFICATION_ID + i,
      title: end.kind === "break" ? "Break’s over" : end.last ? "Time’s up" : `Take ${POMODORO_BREAK} minutes`,
      body:
        end.kind === "break"
          ? `Back to ${session.title || "it"}.`
          : end.last
            ? session.title || "Your focus session has ended."
            : `Round done${session.title ? ` on ${session.title}` : ""}. A short break starts now.`,
      channelId: "tasks",
      smallIcon: "ic_stat_todo",
      iconColor: "#2F5FD0",
      schedule: { at: new Date(end.at), allowWhileIdle: true },
      extra: { focus: true },
    })),
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

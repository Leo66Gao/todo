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
}

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

async function scheduleEnd(session: FocusSession | null) {
  if (!isNative()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.cancel({ notifications: [{ id: FOCUS_NOTIFICATION_ID }] }).catch(() => {});
  if (!session?.endsAt || session.endsAt <= Date.now()) return;
  if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
  await LocalNotifications.schedule({
    notifications: [
      {
        id: FOCUS_NOTIFICATION_ID,
        title: session.kind === "break" ? "Break’s over" : "Time’s up",
        body: session.kind === "break" ? "Back to it when you’re ready." : session.title || "Your focus session has ended.",
        channelId: "tasks",
        smallIcon: "ic_stat_todo",
        iconColor: "#2F5FD0",
        schedule: { at: new Date(session.endsAt), allowWhileIdle: true },
        extra: { focus: true },
      },
    ],
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

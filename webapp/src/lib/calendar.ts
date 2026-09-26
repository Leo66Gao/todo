// Google Calendar access for the web app — a port of the Flutter app's
// GoogleCalendarService (web path). Access tokens are short-lived; they are
// cached per account under the same key Flutter web used and silently
// refreshed through Google Identity Services (`prompt: none`).

import { googleWebClientId } from "./firebase";
import { parseDartDate, toDartIso } from "./dart";
import * as prefs from "./prefs";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken(overrides?: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient(config: Record<string, unknown>): GisTokenClient;
        };
      };
    };
  }
}

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoading = null;
      reject(new Error("Google Identity Services failed to load."));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

async function requestToken(
  interactive: boolean,
  loginHint: string | null,
): Promise<{ accessToken: string; expiry: Date } | null> {
  if (!googleWebClientId) return null;
  await loadGis();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: { accessToken: string; expiry: Date } | null, error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };
    const client = window.google!.accounts!.oauth2!.initTokenClient({
      client_id: googleWebClientId,
      // `email` lets the token be checked against the signed-in account.
      scope: `${CALENDAR_SCOPE} email`,
      include_granted_scopes: true,
      prompt: interactive ? "" : "none",
      login_hint: loginHint ?? undefined,
      callback: (response: TokenResponse) => {
        if (response.error) {
          const detail = response.error_description
            ? `${response.error}: ${response.error_description}`
            : response.error;
          finish(null, new Error(`Google auth error: ${detail}`));
          return;
        }
        if (!response.access_token) {
          finish(null);
          return;
        }
        finish({
          accessToken: response.access_token,
          expiry: new Date(Date.now() + (response.expires_in ?? 3300) * 1000),
        });
      },
      error_callback: (error: { type?: string } | null) =>
        error ? finish(null, new Error(`Google Identity error: ${error.type}`)) : finish(null),
    });
    client.requestAccessToken();
    setTimeout(() => finish(null), interactive ? 120000 : 8000);
  });
}

/**
 * The Google account an access token was issued for. `login_hint` is only a
 * hint, so a token is checked before it is used to write events.
 */
async function tokenEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { email?: string; email_verified?: string | boolean };
  return typeof data.email === "string" ? data.email.toLowerCase() : null;
}

const sameAccount = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface EventInput {
  eventId?: string | null;
  title: string;
  description: string | null;
  startTime: Date;
  durationMinutes: number;
  isAllDay: boolean;
  taskId: string;
  ownerUid: string;
}

const ymd = (d: Date) =>
  `${String(d.getFullYear()).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function eventBody(input: EventInput, withId: boolean) {
  const s = input.startTime;
  const startAt = new Date(s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds());
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] },
    extendedProperties: { private: { todoTaskId: input.taskId, firebaseUid: input.ownerUid } },
  };
  if (withId && input.eventId) body.id = input.eventId;
  if (!input.isAllDay) {
    const minutes = input.durationMinutes > 0 ? input.durationMinutes : 30;
    const endAt = new Date(startAt.getTime() + minutes * 60000);
    body.start = { dateTime: startAt.toISOString(), timeZone: "UTC" };
    body.end = { dateTime: endAt.toISOString(), timeZone: "UTC" };
  } else {
    const next = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate() + 1);
    body.start = { date: ymd(startAt) };
    body.end = { date: ymd(next) };
  }
  return body;
}

export class GoogleCalendar {
  email: string | null = null;
  lastError: string | null = null;
  lastErrorStatus: number | null = null;
  private token: string | null = null;
  private expiry: Date | null = null;
  private sessionUid: string | null = null;

  get isConnected() {
    return this.token != null && this.email != null;
  }

  private sessionKey(uid: string) {
    return `calendar.webSession.${uid}`;
  }

  private setError(prefix: string, error: unknown) {
    this.lastError = `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
    this.lastErrorStatus = error instanceof ApiError ? error.status : null;
    if (this.lastErrorStatus === 401) {
      this.token = null;
      this.expiry = null;
      this.email = null;
      this.clearCached();
    }
  }

  private clearError() {
    this.lastError = null;
    this.lastErrorStatus = null;
  }

  async authorize(opts: { interactive: boolean; email: string | null; uid: string }) {
    this.sessionUid = opts.uid;
    try {
      let expectedEmail = opts.email;
      if (!opts.interactive && this.restoreCached(opts.email)) {
        expectedEmail ??= this.email;
        let matchingAccount = false;
        try {
          matchingAccount = this.token != null && sameAccount(await tokenEmail(this.token), expectedEmail);
        } catch {
          // A cached token whose owner cannot be checked must not write events.
        }
        if (matchingAccount && await this.verifyAccess()) return this.email;
        this.clearSession();
        this.sessionUid = opts.uid;
      }
      const token = await requestToken(opts.interactive, expectedEmail ?? this.email);
      if (!token) return null;
      const email = expectedEmail ?? this.email;
      if (!email) throw new Error("Google Calendar did not return an account email.");
      if (!sameAccount(await tokenEmail(token.accessToken), email)) {
        throw new Error(`Choose ${email} to connect Google Calendar.`);
      }
      this.apply(email, token.accessToken, token.expiry, opts.uid);
      return email;
    } catch (error) {
      this.setError(opts.interactive ? "Sign-in failed" : "Silent sign-in failed", error);
      return null;
    }
  }

  connectWithAccessToken(email: string, accessToken: string, uid: string) {
    this.apply(email, accessToken, new Date(Date.now() + 55 * 60000), uid);
  }

  private apply(email: string, token: string, expiry: Date, uid: string) {
    this.sessionUid = uid;
    this.email = email;
    this.token = token;
    this.expiry = expiry;
    prefs.setString(
      this.sessionKey(uid),
      JSON.stringify({ token, email, expiry: toDartIso(expiry) }),
    );
  }

  private restoreCached(expectedEmail: string | null): boolean {
    const uid = this.sessionUid;
    if (!uid) return false;
    try {
      const raw = prefs.getString(this.sessionKey(uid));
      if (!raw) return false;
      const data = JSON.parse(raw);
      const expiry = parseDartDate(data.expiry);
      if (!data.token || !data.email || !expiry) return false;
      if (expectedEmail && data.email !== expectedEmail) return false;
      if (expiry.getTime() <= Date.now() + 2 * 60000) return false;
      this.email = data.email;
      this.token = data.token;
      this.expiry = expiry;
      return true;
    } catch {
      return false;
    }
  }

  private clearCached() {
    if (this.sessionUid) prefs.remove(this.sessionKey(this.sessionUid));
  }

  clearSession() {
    this.clearCached();
    this.token = null;
    this.expiry = null;
    this.email = null;
    this.sessionUid = null;
  }

  private async currentToken(): Promise<string | null> {
    const needsRefresh = !this.token || !this.expiry || this.expiry.getTime() - 2 * 60000 <= Date.now();
    if (!needsRefresh) return this.token;
    try {
      const refreshed = await requestToken(false, this.email);
      if (
        refreshed &&
        this.email &&
        this.sessionUid &&
        sameAccount(await tokenEmail(refreshed.accessToken), this.email)
      ) {
        this.apply(this.email, refreshed.accessToken, refreshed.expiry, this.sessionUid);
      }
    } catch {
      // Keep the old token; the request will report 401 if it is dead.
    }
    return this.token;
  }

  private async request(method: string, url: string, body?: unknown) {
    const token = await this.currentToken();
    if (!token) throw new ApiError("No Google Calendar session is available.", 401);
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        message = (await response.json())?.error?.message ?? message;
      } catch {
        // Non-JSON error body.
      }
      throw new ApiError(message, response.status);
    }
    return response.status === 204 ? null : response.json().catch(() => null);
  }

  async verifyAccess(): Promise<boolean> {
    this.clearError();
    try {
      await this.request("GET", `${API}?maxResults=1&fields=items(id)`);
      return true;
    } catch (error) {
      this.setError("Calendar verification failed", error);
      return false;
    }
  }

  async insertEvent(input: EventInput): Promise<string | null> {
    this.clearError();
    try {
      const created = await this.request("POST", API, eventBody(input, true));
      return (created?.id as string) ?? null;
    } catch (error) {
      if (input.eventId && error instanceof ApiError && error.status === 409) {
        try {
          await this.request("PUT", `${API}/${encodeURIComponent(input.eventId)}`, eventBody(input, false));
          return input.eventId;
        } catch (inner) {
          this.setError("Insert conflict recovery failed", inner);
          return null;
        }
      }
      this.setError("Insert failed", error);
      return null;
    }
  }

  async updateEvent(input: EventInput & { eventId: string }): Promise<boolean> {
    this.clearError();
    try {
      // A full replacement avoids leaving both `date` and `dateTime` on an
      // event that moved between all-day and timed.
      await this.request("PUT", `${API}/${encodeURIComponent(input.eventId)}`, eventBody(input, false));
      return true;
    } catch (error) {
      this.setError("Update failed", error);
      return false;
    }
  }

  async deleteEvent(eventId: string): Promise<boolean> {
    this.clearError();
    try {
      await this.request("DELETE", `${API}/${encodeURIComponent(eventId)}`);
      return true;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 410)) return true;
      this.setError("Delete failed", error);
      return false;
    }
  }
}

// Outbox keying, shared with the Flutter app's calendar_outbox.dart.
export type CalendarAction = Record<string, unknown> & {
  operation: "upsert" | "delete";
  taskId: string;
  eventId: string;
};

export const calendarActionKey = (a: CalendarAction) =>
  a.operation === "delete" ? `delete:${a.eventId}` : `upsert:${a.taskId}`;

export function normalizeOutbox(decoded: Record<string, unknown>): Record<string, CalendarAction> {
  const out: Record<string, CalendarAction> = {};
  for (const value of Object.values(decoded)) {
    const action = value as CalendarAction;
    out[calendarActionKey(action)] = action;
  }
  return out;
}

// Device storage that speaks the same format as Flutter's shared_preferences
// on the web (`flutter.<key>` → JSON-encoded value in localStorage). Served
// from the same origin, the new web app picks up the Flutter web build's
// offline cache, pending sync writes and signed-out workspace as-is.

const PREFIX = "flutter.";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getRaw(key: string): unknown {
  const s = storage();
  const raw = s?.getItem(PREFIX + key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function getString(key: string): string | null {
  const value = getRaw(key);
  return typeof value === "string" ? value : null;
}

export function getBool(key: string): boolean | null {
  const value = getRaw(key);
  return typeof value === "boolean" ? value : null;
}

export function getStringList(key: string): string[] | null {
  const value = getRaw(key);
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? value : null;
}

function write(key: string, value: unknown) {
  const s = storage();
  if (!s) return;
  s.setItem(PREFIX + key, JSON.stringify(value));
}

export const setString = (key: string, value: string) => write(key, value);
export const setBool = (key: string, value: boolean) => write(key, value);
export const setStringList = (key: string, value: string[]) => write(key, value);

export function remove(key: string) {
  storage()?.removeItem(PREFIX + key);
}

/** Web-app-only UI preferences (not part of the shared workspace). */
export function getLocal<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(`todo.web.${key}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setLocal(key: string, value: unknown) {
  try {
    storage()?.setItem(`todo.web.${key}`, JSON.stringify(value));
  } catch {
    // Storage full or blocked: UI preferences are best-effort.
  }
}

// Shared settings records that two devices commonly change at once are
// merged when they meet, rather than kept as "Sync conflict" notes: the task
// order, the tags, the source library and each note's history. Each merge
// is three-way when this device knows the value its edit started from (the
// base): something removed on one side stays removed, something added on
// either side is kept, an edit made on one side is kept, and for anything
// both changed this device's edit wins.

import { mergeVersions, type Version } from "./versions";

/**
 * `local` with the other side's additions, removals and edits since `base`
 * folded in. An item both have takes the other side's version when only
 * that side changed it (compared with the base); this side's when it did.
 */
export function mergeById<T>(local: T[], base: T[] | null, remote: T[], id: (item: T) => string): T[] {
  const baseById = new Map((base ?? []).map((item) => [id(item), item]));
  const baseIds = new Set(baseById.keys());
  const remoteById = new Map(remote.map((item) => [id(item), item]));
  const remoteIds = new Set(remoteById.keys());
  const localIds = new Set(local.map(id));
  const same = (a: T | undefined, b: T | undefined) => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);
  const out = local
    // Removed on the other device since the base.
    .filter((item) => !(baseIds.has(id(item)) && !remoteIds.has(id(item))))
    // Unchanged here but edited there: the other device's edit.
    .map((item) => (same(item, baseById.get(id(item))) ? (remoteById.get(id(item)) ?? item) : item));
  remote.forEach((item, i) => {
    const key = id(item);
    // Already here, or removed on this device since the base.
    if (localIds.has(key) || baseIds.has(key)) return;
    // Placed after the nearest item before it on the other device.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const found = out.findIndex((o) => id(o) === id(remote[j]));
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    out.splice(at, 0, item);
  });
  return out;
}

function parse(payload: string | null): unknown {
  if (payload == null) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const withIds = (value: unknown): { id: string }[] | null =>
  Array.isArray(value) && value.every((v) => isObject(v) && typeof v.id === "string") ? (value as { id: string }[]) : null;
const versionList = (value: unknown): Version[] | null =>
  isObject(value) && Array.isArray(value.versions) && value.versions.every((v) => isObject(v) && typeof v.at === "number")
    ? (value.versions as Version[])
    : null;

/**
 * The merged payload for a record both devices changed, or null when it
 * isn't one that merges (or a value doesn't read as expected): the caller
 * then keeps the other device's value and saves this one as a copy.
 */
export function mergeRecord(key: string, local: string, base: string | null, remote: string): string | null {
  const [l, b, r] = [parse(local), parse(base), parse(remote)];
  if (l === undefined || r === undefined) return null;

  if (key === "settings:order" || key === "settings:tags") {
    if (!isStringList(l) || !isStringList(r)) return null;
    return JSON.stringify(mergeById(l, isStringList(b) ? b : null, r, (s) => s));
  }

  if (key === "settings:sources") {
    if (!isObject(l) || !isObject(r)) return null;
    const [ls, rs] = [withIds(l.sources ?? []), withIds(r.sources ?? [])];
    if (!ls || !rs) return null;
    const bs = isObject(b) ? withIds(b.sources ?? []) : null;
    return JSON.stringify({ ...r, ...l, sources: mergeById(ls, bs, rs, (s) => s.id) });
  }

  if (key.startsWith("settings:versions:")) {
    const [lv, rv] = [versionList(l), versionList(r)];
    if (!lv || !rv) return null;
    return JSON.stringify({ versions: mergeVersions(lv, rv) });
  }

  return null;
}

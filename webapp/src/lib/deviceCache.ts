// Durable workspace data, stored per record rather than serializing the entire
// workspace into synchronous localStorage after every edit. A record and its
// outbox entry are committed in the same IndexedDB transaction.
import * as prefs from "./prefs";
import { recoveryRecords } from "./recordRecovery";

export interface DeviceCache {
  records: Record<string, string>;
  pending: Record<string, string | null>;
  bases: Record<string, string | null>;
  pendingIds: Record<string, string>;
  lastSync: number | null;
  retryAt?: number | null;
  retryReason?: string | null;
  retryError?: string | null;
  lastUploadedAt?: number | null;
}

export const emptyDeviceCache = (): DeviceCache => ({ records: {}, pending: {}, bases: {}, pendingIds: {}, lastSync: null });
const DATABASE = "todo-workspaces";
const GUEST = "";
let database: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("accounts", { keyPath: "uid" });
      for (const name of ["records", "outbox"]) {
        db.createObjectStore(name, { keyPath: ["uid", "key"] }).createIndex("account", "uid");
      }
    };
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error("Close other Todo tabs to update device storage.")); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
  });
  return database;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Device save was interrupted."));
    tx.onerror = () => reject(tx.error);
  });
}

function decodeSaved(raw: string): DeviceCache {
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || !value.records || typeof value.records !== "object") throw new Error("Invalid device cache");
  for (const payload of Object.values(value.records)) if (typeof payload !== "string") throw new Error("Invalid saved record");
  return {
    ...emptyDeviceCache(), ...value,
    pending: value.pending ?? {}, bases: value.bases ?? {}, pendingIds: value.pendingIds ?? {},
    lastSync: typeof value.lastSync === "number" ? value.lastSync : null,
  };
}

/** Used for migration and for browsers that do not provide IndexedDB. */
function readLegacy(uid: string): DeviceCache | null {
  const raw = prefs.getString(uid ? `cloud.${uid}` : "activeGuestWorkspace");
  if (raw == null) return null;
  try {
    return decodeSaved(uid ? raw : JSON.stringify({ records: JSON.parse(raw) }));
  } catch {
    prefs.setString(uid ? `cloud.${uid}.recovery` : "activeGuestWorkspace.recovery", raw);
    throw new Error("A damaged device cache was backed up. Your cloud copy has not been replaced.");
  }
}

/** One store per sync session; its queue captures each state before awaits. */
export class WorkspaceCache {
  onRecovery: ((uid: string, entries: Record<string, { payload: string; operationId: string }>) => void) | null = null;
  private previous = new Map<string, DeviceCache>();
  private queue: Promise<void> = Promise.resolve();

  async read(uid: string): Promise<DeviceCache | null> {
    await this.queue.catch(() => {});
    if (typeof indexedDB === "undefined") return readLegacy(uid);
    const db = await open();
    const tx = db.transaction(["accounts", "records", "outbox"], "readonly");
    const done = completed(tx);
    const [meta, records, outbox] = await Promise.all([
      result(tx.objectStore("accounts").get(uid)),
      result(tx.objectStore("records").index("account").getAll(uid)),
      result(tx.objectStore("outbox").index("account").getAll(uid)),
    ]);
    await done;
    if (!meta) {
      const legacy = readLegacy(uid);
      if (legacy) await this.save(uid, legacy);
      return legacy;
    }
    const cache: DeviceCache = { ...emptyDeviceCache(), ...meta };
    for (const record of records) cache.records[record.key] = record.payload;
    for (const entry of outbox) {
      cache.pending[entry.key] = entry.payload;
      cache.bases[entry.key] = entry.base;
      cache.pendingIds[entry.key] = entry.operationId;
      if (entry.payload == null) delete cache.records[entry.key];
      else cache.records[entry.key] = entry.payload;
    }
    this.previous.set(uid, cache);
    return cache;
  }

  save(uid: string, state: DeviceCache): Promise<void> {
    const snapshot: DeviceCache = {
      ...state, records: { ...state.records }, pending: { ...state.pending },
      bases: { ...state.bases }, pendingIds: { ...state.pendingIds },
    };
    const pass = this.queue.catch(() => {}).then(() => this.write(uid, snapshot));
    this.queue = pass;
    return pass;
  }

  private async write(uid: string, state: DeviceCache) {
    if (typeof indexedDB === "undefined") {
      if (!prefs.setString(uid ? `cloud.${uid}` : "activeGuestWorkspace", JSON.stringify(uid ? state : state.records))) {
        throw new Error("This browser is blocking device storage.");
      }
      return;
    }
    const db = await open();
    const previous = this.previous.get(uid) ?? emptyDeviceCache();
    const tx = db.transaction(["accounts", "records", "outbox"], "readwrite", { durability: "strict" });
    const done = completed(tx);
    tx.objectStore("accounts").put({ uid, lastSync: state.lastSync, retryAt: state.retryAt, retryReason: state.retryReason, retryError: state.retryError, lastUploadedAt: state.lastUploadedAt });
    const records = tx.objectStore("records");
    const outbox = tx.objectStore("outbox");
    const recovered: Record<string, { payload: string; operationId: string }> = {};
    const preserve = (key: string, payload: string) => {
      for (const [copyKey, value] of recoveryRecords(key, payload, crypto.randomUUID())) {
        const operationId = crypto.randomUUID();
        recovered[copyKey] = { payload: value, operationId };
        records.put({ uid, key: copyKey, payload: value });
        if (uid) outbox.put({ uid, key: copyKey, payload: value, base: null, operationId });
      }
    };
    for (const key of new Set([...Object.keys(previous.records), ...Object.keys(state.records)])) {
      if (previous.records[key] === state.records[key]) continue;
      const replace = () => {
        if (key in state.records) records.put({ uid, key, payload: state.records[key] });
        else records.delete([uid, key]);
      };
      if (uid) replace();
      else {
        const check = records.get([uid, key]);
        check.onsuccess = () => {
          const other = check.result?.payload;
          if (typeof other === "string" && other !== previous.records[key] && other !== state.records[key]) preserve(key, other);
          replace();
        };
      }
    }
    for (const key of new Set([...Object.keys(previous.pending), ...Object.keys(state.pending)])) {
      if (key in state.pending) {
        if (previous.pendingIds[key] !== state.pendingIds[key] || previous.pending[key] !== state.pending[key] || previous.bases[key] !== state.bases[key]) {
          const check = outbox.get([uid, key]);
          check.onsuccess = () => {
            const other = check.result;
            if (other && other.operationId !== previous.pendingIds[key] && other.operationId !== state.pendingIds[key] && other.payload != null && other.payload !== state.pending[key]) {
              preserve(key, other.payload);
            }
            outbox.put({ uid, key, payload: state.pending[key], base: state.bases[key] ?? null, operationId: state.pendingIds[key] });
          };
        }
      } else {
        // Another tab may have saved a newer edit while this tab uploaded.
        // Acknowledging our operation must never erase that newer outbox entry.
        const check = outbox.get([uid, key]);
        check.onsuccess = () => { if (check.result?.operationId === previous.pendingIds[key]) outbox.delete([uid, key]); };
      }
    }
    await done;
    this.previous.set(uid, state);
    if (Object.keys(recovered).length) this.onRecovery?.(uid, recovered);
    // Remove the large legacy copy only after the migration is durable.
    try { prefs.remove(uid ? `cloud.${uid}` : "activeGuestWorkspace"); } catch { /* IndexedDB is already durable. */ }
    prefs.setLocal(`workspace.cached.${uid}`, true);
  }
}

export const guestCache = new WorkspaceCache();
export const readGuestCache = () => guestCache.read(GUEST);
export const saveGuestCache = (records: Record<string, string>) => guestCache.save(GUEST, { ...emptyDeviceCache(), records });

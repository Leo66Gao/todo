// A line-for-line port of the Flutter app's CloudSyncService. Both clients
// must follow exactly the same protocol against users/{uid}/records:
//
// - one document per entity: { kind, payload (JSON string), deleted, updatedAt }
// - deletions are tombstones and always win over stale offline edits
// - a durable outbox (with the value each edit was based on) is replayed in
//   transactions; a conflicting edit becomes a visible "conflict copy"
//
// The device cache lives under the same key as Flutter web (`cloud.<uid>`).

import {
  collection,
  doc,
  getDocsFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  type CollectionReference,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Unsubscribe,
} from "firebase/firestore";
import { toDartIso } from "./dart";
import * as prefs from "./prefs";

type Records = Record<string, string>;
type Pending = Record<string, string | null>;

const MAX_CHARS = 690000;
const MAX_BYTES = 900000;
const byteLength = (s: string) => new TextEncoder().encode(s).length;
const fitsCloud = (s: string) => s.length <= MAX_CHARS && byteLength(s) <= MAX_BYTES;

function millisOf(ts: unknown): number | null {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return null;
}

export class CloudSync {
  onRecords: ((records: Records) => void) | null = null;
  onStatus: ((status: string, error: string | null) => void) | null = null;

  private uid: string | null = null;
  private records: Records = {};
  private pending: Pending = {};
  private bases: Pending = {};
  private pendingIds: Record<string, string> = {};
  private lastSyncMillis: number | null = null;
  private flushing = false;
  private generation = 0;
  private unsubscribe: Unsubscribe | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;
  private resub: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly db: Firestore) {}

  private get collectionRef(): CollectionReference<DocumentData> {
    return collection(this.db, "users", this.uid!, "records");
  }

  get lastSync() {
    return this.lastSyncMillis;
  }

  get hasPending() {
    return Object.keys(this.pending).length > 0;
  }

  async connect(uid: string): Promise<Records> {
    await this.disconnect();
    this.uid = uid;
    const generation = this.generation;
    const saved = prefs.getString(`cloud.${uid}`);
    if (saved != null) {
      try {
        const data = JSON.parse(saved);
        this.records = { ...(data.records as Records) };
        this.pending = { ...(data.pending as Pending) };
        this.bases = data.bases && typeof data.bases === "object" ? { ...data.bases } : {};
        this.pendingIds =
          data.pendingIds && typeof data.pendingIds === "object" ? { ...data.pendingIds } : {};
        this.lastSyncMillis = typeof data.lastSync === "number" ? data.lastSync : null;
      } catch {
        // Preserve the damaged cache for recovery instead of uploading a blank
        // workspace over the user's cloud records.
        prefs.setString(`cloud.${uid}.recovery`, saved);
        this.records = {};
        this.pending = {};
        this.bases = {};
        this.pendingIds = {};
        this.lastSyncMillis = null;
        this.onStatus?.("Recovering from cloud", "A damaged device cache was backed up.");
      }
    }
    if (Object.keys(this.pending).some((k) => !(k in this.pendingIds))) {
      for (const key of Object.keys(this.pending)) {
        this.pendingIds[key] ??= crypto.randomUUID();
      }
      this.persist();
    }
    this.listen(generation);
    this.retry = setInterval(() => void this.flush(), 15000);
    void this.flush();
    return { ...this.records };
  }

  private overlapQuery(): Query<DocumentData> {
    const overlapMs = this.lastSyncMillis! > 5000 ? this.lastSyncMillis! - 5000 : 0;
    return query(this.collectionRef, where("updatedAt", ">", Timestamp.fromMillis(overlapMs)));
  }

  private listen(generation: number) {
    this.unsubscribe?.();
    const isFullSync = this.lastSyncMillis == null || Object.keys(this.records).length === 0;
    let checkedFullServerSnapshot = false;
    let deliveredInitialRecords = false;
    let lastStatus: string | null = null;
    const q = isFullSync ? this.collectionRef : this.overlapQuery();

    this.unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (generation !== this.generation) return;
        let recordsChanged = false;
        if (isFullSync && !snapshot.metadata.fromCache && !checkedFullServerSnapshot) {
          checkedFullServerSnapshot = true;
          const ids = new Set(snapshot.docs.map((d) => d.id));
          for (const id of Object.keys(this.records)) {
            if (!ids.has(id) && !(id in this.pending)) {
              delete this.records[id];
              recordsChanged = true;
            }
          }
        }
        let maxUpdated: number | null = null;
        for (const change of snapshot.docChanges({ includeMetadataChanges: true })) {
          const id = change.doc.id;
          if (change.type === "removed") {
            if (isFullSync && !(id in this.pending) && id in this.records) {
              delete this.records[id];
              recordsChanged = true;
            }
            continue;
          }
          const data = change.doc.data();
          const ms = millisOf(data?.updatedAt);
          if (ms != null && (maxUpdated == null || ms > maxUpdated)) maxUpdated = ms;
          if (id in this.pending) continue;
          if (data?.deleted === true) {
            if (id in this.records) {
              delete this.records[id];
              recordsChanged = true;
            }
          } else if (typeof data?.payload === "string" && this.records[id] !== data.payload) {
            this.records[id] = data.payload;
            recordsChanged = true;
          }
        }
        let watermarkChanged = false;
        if (maxUpdated != null && maxUpdated > (this.lastSyncMillis ?? 0)) {
          this.lastSyncMillis = maxUpdated;
          watermarkChanged = true;
        }
        if (recordsChanged || !deliveredInitialRecords) {
          deliveredInitialRecords = true;
          this.onRecords?.({ ...this.records });
        }
        if (recordsChanged || watermarkChanged) {
          try {
            this.persist();
          } catch (error) {
            this.onStatus?.("Device storage needs attention", String(error));
          }
        }
        const status = this.hasPending
          ? "Changes waiting to sync"
          : snapshot.metadata.fromCache
            ? "Offline · saved on this device"
            : "Synced";
        if (status !== lastStatus) {
          lastStatus = status;
          this.onStatus?.(status, null);
        }
      },
      (error) => {
        if (generation !== this.generation) return;
        this.onStatus?.("Sync needs attention", String(error));
        if (this.resub) clearTimeout(this.resub);
        this.resub = setTimeout(() => {
          if (generation === this.generation && this.uid != null) this.listen(generation);
        }, 8000);
      },
    );
  }

  private persist() {
    const uid = this.uid;
    if (!uid) return;
    const encoded = JSON.stringify({
      records: this.records,
      pending: this.pending,
      bases: this.bases,
      pendingIds: this.pendingIds,
      ...(this.lastSyncMillis != null ? { lastSync: this.lastSyncMillis } : {}),
    });
    prefs.setString(`cloud.${uid}`, encoded);
  }

  async writeChanges(changes: Pending): Promise<void> {
    if (!this.uid) throw new Error("Sign in before saving cloud changes.");
    const keys = Object.keys(changes);
    if (keys.length === 0) return;
    for (const key of keys) {
      if (!(key in this.pending)) this.bases[key] = this.records[key] ?? null;
      const value = changes[key];
      this.pending[key] = value;
      this.pendingIds[key] = crypto.randomUUID();
      if (value == null) delete this.records[key];
      else this.records[key] = value;
    }
    this.persist();
    this.onStatus?.("Changes waiting to sync", null);
    void this.flush();
  }

  private document(key: string, payload: string | null) {
    return {
      kind: key.split(":")[0],
      payload: payload ?? "",
      deleted: payload == null,
      updatedAt: serverTimestamp(),
    };
  }

  /**
   * A conflicting local edit becomes a visible copy. Settings and unreadable
   * payloads become a note holding the raw local value so nothing is lost.
   */
  private conflictCopy(key: string, payload: string, copyId: string): [string, string] | null {
    const kind = key.split(":")[0];
    try {
      if (kind !== "settings") {
        const value = JSON.parse(payload) as Record<string, unknown>;
        value.id = copyId;
        const nameKey = kind === "folder" ? "name" : "title";
        value[nameKey] = `${value[nameKey] ?? "Untitled"} (conflict copy)`;
        if (kind === "task") {
          value.googleEventId = null;
          value.calendarEventRevision = 0;
          value.isConflictCopy = true;
        }
        const encoded = JSON.stringify(value);
        if (fitsCloud(encoded)) return [`${kind}:${copyId}`, encoded];
      }
    } catch {
      // Fall through: preserve malformed data in a readable note.
    }
    const now = toDartIso(new Date());
    const note = JSON.stringify({
      id: copyId,
      title: `Sync conflict: ${key}`,
      content: `Local version of ${key}:\n\n${payload}`,
      createdAt: now,
      updatedAt: now,
    });
    return fitsCloud(note) ? [`note:${copyId}`, note] : null;
  }

  /** Imports only missing documents; existing records and tombstones win. */
  async importMissing(legacy: Records): Promise<void> {
    const col = this.collectionRef;
    const generation = this.generation;
    const entries = Object.entries(legacy);
    for (let start = 0; start < entries.length; start += 50) {
      if (generation !== this.generation) throw new Error("Account changed during import.");
      const chunk = entries.slice(start, start + 50);
      await runTransaction(this.db, async (tx) => {
        const exists: Record<string, boolean> = {};
        for (const [key] of chunk) exists[key] = (await tx.get(doc(col, key))).exists();
        for (const [key, value] of chunk) {
          if (!exists[key]) tx.set(doc(col, key), this.document(key, value));
        }
      });
    }
  }

  async flush(): Promise<void> {
    if (!this.uid || this.flushing || !this.hasPending) return;
    this.flushing = true;
    const generation = this.generation;
    const col = this.collectionRef;
    try {
      while (this.hasPending && generation === this.generation) {
        const entries = Object.entries(this.pending).slice(0, 50);
        const operationIds: Record<string, string> = {};
        for (const [key] of entries) operationIds[key] = this.pendingIds[key];
        const bases: Pending = {};
        for (const [key] of entries) if (key in this.bases) bases[key] = this.bases[key];

        const outcome = await runTransaction(this.db, async (tx) => {
          const snapshots: Record<string, DocumentSnapshot<DocumentData>> = {};
          for (const [key] of entries) snapshots[key] = await tx.get(doc(col, key));
          const tombstones = new Set<string>();
          const conflicts: Record<string, string> = {};
          const copies: Record<string, [string, string]> = {};
          const oversized = new Set<string>();
          for (const [key, value] of entries) {
            const remote = snapshots[key];
            if (remote.data()?.deleted === true) {
              tombstones.add(key);
              continue;
            }
            if (value == null || !remote.exists()) continue;
            const remotePayload = (remote.data()?.payload as string | undefined) ?? null;
            if (remotePayload === value) continue;
            if (key in bases && remotePayload === bases[key]) continue;
            conflicts[key] = remotePayload ?? "";
          }
          const candidates: Record<string, [string, string] | null> = {};
          for (const [key, value] of entries) {
            if (key in conflicts) candidates[key] = this.conflictCopy(key, value!, operationIds[key]);
          }
          const copySnapshots: Record<string, DocumentSnapshot<DocumentData>> = {};
          for (const key of Object.keys(conflicts)) {
            const copy = candidates[key];
            if (copy) copySnapshots[key] = await tx.get(doc(col, copy[0]));
          }
          for (const [key, value] of entries) {
            if (tombstones.has(key)) continue;
            if (key in conflicts) {
              const copy = candidates[key];
              if (!copy) {
                oversized.add(key);
              } else {
                const existing = copySnapshots[key];
                if (!existing.exists()) tx.set(doc(col, copy[0]), this.document(copy[0], copy[1]));
                copies[key] = [copy[0], (existing.data()?.payload as string | undefined) ?? copy[1]];
              }
            } else if (snapshots[key].data()?.payload !== value || !snapshots[key].exists()) {
              tx.set(doc(col, key), this.document(key, value));
            }
            // Otherwise this exact write already landed before an earlier
            // attempt lost its acknowledgement.
          }
          return { tombstones, conflicts, copies, oversized };
        });
        if (generation !== this.generation) return;

        for (const key of outcome.oversized) {
          const value = entries.find(([k]) => k === key)?.[1];
          prefs.setString(
            `cloud.${this.uid}.conflict.${operationIds[key]}`,
            JSON.stringify({ key, payload: value }),
          );
        }
        let recordsChanged = false;
        for (const [key, value] of entries) {
          const sameOperation = this.pendingIds[key] === operationIds[key];
          const clear = () => {
            delete this.pending[key];
            delete this.bases[key];
            delete this.pendingIds[key];
          };
          if (outcome.tombstones.has(key)) {
            clear();
            delete this.records[key];
            recordsChanged = true;
          } else if (key in outcome.conflicts) {
            const copy = outcome.copies[key];
            if (copy) {
              this.records[copy[0]] = copy[1];
              recordsChanged = true;
            }
            if (sameOperation) {
              this.records[key] = outcome.conflicts[key];
              clear();
              recordsChanged = true;
            }
          } else if (sameOperation) {
            clear();
          } else {
            // A newer local edit arrived mid-transaction; its base is the
            // value this transaction just wrote.
            this.bases[key] = value;
          }
        }
        if (recordsChanged) this.onRecords?.({ ...this.records });
        this.persist();
        if (Object.keys(outcome.conflicts).length > 0) {
          this.onStatus?.(
            "Sync conflicts saved as copies",
            outcome.oversized.size === 0
              ? null
              : "An oversized local version was backed up on this device.",
          );
        }
      }

      if (generation === this.generation) {
        // A remote edit can arrive while an ID is protected by the outbox;
        // fetch again after acknowledgement so it is not lost.
        const isFull = this.lastSyncMillis == null;
        const snapshot = await getDocsFromServer(isFull ? col : this.overlapQuery());
        if (generation !== this.generation) return;
        let recordsChanged = isFull;
        if (isFull) {
          const remote: Records = {};
          for (const d of snapshot.docs) {
            const data = d.data();
            if (data.deleted !== true && typeof data.payload === "string") remote[d.id] = data.payload;
          }
          for (const [key, value] of Object.entries(this.pending)) {
            if (value == null) delete remote[key];
            else remote[key] = value;
          }
          this.records = remote;
        } else {
          for (const d of snapshot.docs) {
            if (d.id in this.pending) continue;
            const data = d.data();
            if (data.deleted === true) {
              if (d.id in this.records) {
                delete this.records[d.id];
                recordsChanged = true;
              }
            } else if (typeof data.payload === "string" && this.records[d.id] !== data.payload) {
              this.records[d.id] = data.payload;
              recordsChanged = true;
            }
          }
        }
        let maxUpdated: number | null = null;
        for (const d of snapshot.docs) {
          const ms = millisOf(d.data().updatedAt);
          if (ms != null && (maxUpdated == null || ms > maxUpdated)) maxUpdated = ms;
        }
        let watermarkChanged = false;
        if (maxUpdated != null && maxUpdated > (this.lastSyncMillis ?? 0)) {
          this.lastSyncMillis = maxUpdated;
          watermarkChanged = true;
        }
        if (recordsChanged) this.onRecords?.({ ...this.records });
        if (recordsChanged || watermarkChanged) this.persist();
        if (generation === this.generation) {
          this.onStatus?.(this.hasPending ? "Changes waiting to sync" : "Synced", null);
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.onStatus?.("Changes saved locally · retrying", String(error));
      }
    } finally {
      if (generation === this.generation) this.flushing = false;
    }
  }

  async disconnect(): Promise<void> {
    this.generation++;
    if (this.retry) clearInterval(this.retry);
    if (this.resub) clearTimeout(this.resub);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.retry = null;
    this.resub = null;
    this.uid = null;
    this.records = {};
    this.pending = {};
    this.bases = {};
    this.pendingIds = {};
    this.lastSyncMillis = null;
    this.flushing = false;
  }
}

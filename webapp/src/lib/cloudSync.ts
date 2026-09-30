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
import { WorkspaceCache } from "./deviceCache";
import { syncFailure } from "./syncPolicy";
import { payloadFits, recoveryRecords } from "./recordRecovery";

type Records = Record<string, string>;
type Pending = Record<string, string | null>;

export interface SyncDetails {
  pending: { key: string; deleting: boolean }[];
  lastDownloadedAt: number | null;
  lastUploadedAt: number | null;
  retryAt: number | null;
  pauseReason: string | null;
  error: string | null;
  recordsReceived: number;
  recordsUploaded: number;
}

/**
 * Uploads are grouped rather than sent on every save: each change is on the
 * device at once (and survives the app closing), then goes up within a
 * second, or within 20 seconds for note text, which changes as you type and
 * would otherwise cost a read and a write per pause. Anything waiting goes up
 * straight away when the app is put away or the page is left.
 */
const UPLOAD_SOON_MS = 1000;
const UPLOAD_NOTES_MS = 20000;
const isTypingRecord = (key: string) => key.startsWith("note:") || key.startsWith("settings:versions:");

const validChange = (key: string, value: string | null) => /^(task|note|project|folder|settings):[^/]+$/.test(key) && key.length <= 200 && (value == null || payloadFits(value));

function millisOf(ts: unknown): number | null {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return null;
}

export class CloudSync {
  onRecords: ((records: Records) => void) | null = null;
  onStatus: ((status: string, error: string | null) => void) | null = null;
  onDetails: ((details: SyncDetails) => void) | null = null;

  private uid: string | null = null;
  private records: Records = {};
  private pending: Pending = {};
  private bases: Pending = {};
  private pendingIds: Record<string, string> = {};
  private lastSyncMillis: number | null = null;
  private cache = new WorkspaceCache();
  private deferred = new Map<string, { payload: string | null; at: number }>();
  private retryAt: number | null = null;
  private retryReason: string | null = null;
  private failureCount = 0;
  private lastUploadedAt: number | null = null;
  private lastDownloadedAt: number | null = null;
  private recordsReceived = 0;
  private recordsUploaded = 0;
  private storageError: string | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  /** The upload pass in progress, shared by everyone who asks for one. */
  private inflight: Promise<void> | null = null;
  private lastFlushError: string | null = null;
  private generation = 0;
  private uploadTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadDue = 0;
  private readonly uploadNowIfHidden = () => {
    if (document.visibilityState === "hidden") {
      void this.flush();
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.unsubscribe?.();
        this.unsubscribe = null;
      }, 60_000);
    } else {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = null;
      if (!this.unsubscribe && this.uid) this.listen(this.generation);
      void this.flush();
    }
  };
  private readonly uploadOnLeave = () => void this.flush();
  private unsubscribe: Unsubscribe | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;
  private resub: ReturnType<typeof setTimeout> | null = null;
  /** Uploads as soon as the connection returns, not at the next retry. */
  private readonly reconnected = () => {
    if (!this.unsubscribe && this.uid) this.listen(this.generation);
    void this.flush();
  };

  constructor(private readonly db: Firestore) {
    this.cache.onRecovery = (uid, entries) => {
      if (uid !== this.uid) return;
      for (const [key, entry] of Object.entries(entries)) {
        this.records[key] = entry.payload;
        this.pending[key] = entry.payload;
        this.bases[key] = null;
        this.pendingIds[key] = entry.operationId;
      }
      this.onRecords?.({ ...this.records });
      this.status("Competing device edits saved as conflict copies");
      this.scheduleUpload(UPLOAD_SOON_MS);
    };
  }

  private get collectionRef(): CollectionReference<DocumentData> {
    return collection(this.db, "users", this.uid!, "records");
  }

  get lastSync() {
    return this.lastSyncMillis;
  }

  get hasPending() {
    return Object.keys(this.pending).length > 0;
  }

  private details() {
    this.onDetails?.({
      pending: Object.entries(this.pending).map(([key, value]) => ({ key, deleting: value == null })),
      lastDownloadedAt: this.lastDownloadedAt, lastUploadedAt: this.lastUploadedAt,
      retryAt: this.retryAt, pauseReason: this.retryReason,
      error: this.storageError ?? this.lastFlushError,
      recordsReceived: this.recordsReceived, recordsUploaded: this.recordsUploaded,
    });
  }

  private status(label: string, error: string | null = null) {
    const quota = this.paused && this.retryReason === "quota";
    this.onStatus?.(this.storageError ? "Device storage needs attention" : quota ? "Sync paused: quota reached" : label, this.storageError ?? (quota ? this.lastFlushError : error));
    this.details();
  }

  private get paused() { return this.retryAt != null && this.retryAt > Date.now(); }

  /** A single explicit retry from the sync panel; automatic retries respect backoff. */
  async retryNow() {
    this.retryAt = null;
    this.retryReason = null;
    this.lastFlushError = null;
    if (!this.unsubscribe && this.uid) this.listen(this.generation);
    await this.flush();
    this.details();
  }

  private failed(error: unknown) {
    const failure = syncFailure(error, this.failureCount++);
    this.retryAt = failure.retryAt;
    this.retryReason = failure.reason;
    this.lastFlushError = failure.message;
    this.status(failure.reason === "quota" ? "Sync paused: quota reached" : "Saved on this device, retrying", failure.message);
    this.remember();
  }

  private remember() {
    const generation = this.generation;
    void this.persist().catch((error) => { if (generation === this.generation) this.storageFailed(error); });
  }

  private storageFailed(error: unknown) {
    this.storageError = error instanceof Error ? error.message : String(error);
    this.status("Device storage needs attention", this.storageError);
  }

  async connect(uid: string): Promise<Records> {
    await this.disconnect();
    this.uid = uid;
    const generation = this.generation;
    const saved = await this.cache.read(uid).catch((error) => { if (generation === this.generation) this.storageFailed(error); return null; });
    if (generation !== this.generation || this.uid !== uid) return {};
    if (saved != null) {
        const data = saved;
        this.records = { ...(data.records as Records) };
        this.pending = { ...(data.pending as Pending) };
        this.bases = data.bases && typeof data.bases === "object" ? { ...data.bases } : {};
        this.pendingIds =
          data.pendingIds && typeof data.pendingIds === "object" ? { ...data.pendingIds } : {};
        this.lastSyncMillis = typeof data.lastSync === "number" ? data.lastSync : null;
        this.retryAt = data.retryAt ?? null;
        this.retryReason = data.retryReason ?? null;
        this.lastUploadedAt = data.lastUploadedAt ?? null;
        this.lastFlushError = data.retryError ?? null;
    }
    if (Object.keys(this.pending).some((k) => !(k in this.pendingIds))) {
      for (const key of Object.keys(this.pending)) {
        this.pendingIds[key] ??= crypto.randomUUID();
      }
      await this.persist();
    }
    this.listen(generation);
    // Retries what failed; changes still in their grouping window wait for it.
    this.retry = setInterval(() => {
      if (!this.paused) {
        if (!this.unsubscribe && (typeof document === "undefined" || !document.hidden)) this.listen(this.generation);
        if (!this.uploadTimer) void this.flush();
      }
    }, 30000);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.reconnected);
      document.addEventListener("visibilitychange", this.uploadNowIfHidden);
      window.addEventListener("pagehide", this.uploadOnLeave);
    }
    void this.flush();
    if (this.paused) this.status("Sync paused: quota reached", this.lastFlushError);
    this.details();
    return { ...this.records };
  }

  private overlapQuery(): Query<DocumentData> {
    const overlapMs = this.lastSyncMillis! > 5000 ? this.lastSyncMillis! - 5000 : 0;
    return query(this.collectionRef, where("updatedAt", ">", Timestamp.fromMillis(overlapMs)));
  }

  private listen(generation: number) {
    if (this.paused) return;
    this.unsubscribe?.();
    const isFullSync = this.lastSyncMillis == null;
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
          const confirmed = !snapshot.metadata.fromCache && !change.doc.metadata.hasPendingWrites;
          if (confirmed && ms != null && (maxUpdated == null || ms > maxUpdated)) maxUpdated = ms;
          if (id in this.pending) {
            if (confirmed && ms != null) this.deferred.set(id, { payload: data.deleted ? null : data.payload, at: ms });
            continue;
          }
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
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          this.lastDownloadedAt = Date.now();
          this.recordsReceived += snapshot.docChanges().filter((c) => c.type !== "removed").length;
          // An empty account is a valid completed initial sync too.
          if (this.lastSyncMillis == null) { this.lastSyncMillis = 0; watermarkChanged = true; }
          if (!(this.paused && this.retryReason === "quota")) {
            this.retryAt = null;
            this.retryReason = null;
            this.failureCount = 0;
            this.lastFlushError = null;
          }
        }
        if (recordsChanged || !deliveredInitialRecords) {
          deliveredInitialRecords = true;
          this.onRecords?.({ ...this.records });
        }
        if (recordsChanged || watermarkChanged) {
          this.remember();
        }
        const status = this.hasPending
          ? "Changes waiting to sync"
          : snapshot.metadata.fromCache
            ? "Offline, saved on this device"
            : "Synced";
        if (status !== lastStatus) {
          lastStatus = status;
          this.status(status);
        }
        this.details();
      },
      (error) => {
        if (generation !== this.generation) return;
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.failed(error);
        if (this.resub) clearTimeout(this.resub);
        this.resub = setTimeout(() => {
          if (generation === this.generation && this.uid != null && (typeof document === "undefined" || !document.hidden)) this.listen(generation);
        }, Math.max(1000, (this.retryAt ?? Date.now() + 30_000) - Date.now()));
      },
    );
  }

  private async persist(): Promise<void> {
    const uid = this.uid;
    const generation = this.generation;
    if (!uid) return;
    await this.cache.save(uid, {
      records: this.records,
      pending: this.pending,
      bases: this.bases,
      pendingIds: this.pendingIds,
      lastSync: this.lastSyncMillis,
      retryAt: this.retryAt, retryReason: this.retryReason, retryError: this.lastFlushError, lastUploadedAt: this.lastUploadedAt,
    });
    if (generation === this.generation) this.storageError = null;
  }

  async writeChanges(changes: Pending): Promise<void> {
    if (!this.uid) throw new Error("Sign in before saving cloud changes.");
    const keys = Object.keys(changes);
    if (keys.length === 0) return;
    const generation = this.generation;
    for (const key of keys) {
      if (!(key in this.pending)) this.bases[key] = this.records[key] ?? null;
      const value = changes[key];
      this.pending[key] = value;
      this.pendingIds[key] = crypto.randomUUID();
      if (value == null) delete this.records[key];
      else this.records[key] = value;
    }
    // Upload even when the device copy can't be written, but report it so the
    // caller keeps the change and tries to store it again.
    let failure: unknown = null;
    try {
      await this.persist();
    } catch (error) {
      failure = error;
      if (generation === this.generation) this.storageFailed(error);
    }
    if (generation !== this.generation) return;
    this.status(this.paused ? "Sync paused" : "Changes waiting to sync", this.lastFlushError);
    this.scheduleUpload(keys.every(isTypingRecord) ? UPLOAD_NOTES_MS : UPLOAD_SOON_MS);
    if (failure) throw failure;
  }

  private document(key: string, payload: string | null) {
    return {
      kind: key.split(":")[0],
      payload: payload ?? "",
      deleted: payload == null,
      updatedAt: serverTimestamp(),
    };
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

  /**
   * Uploads pending changes and confirms them against the server. Resolves
   * when every change is acknowledged; throws with the reason when some are
   * still waiting (for example offline), so a caller can tell a local-only
   * save from one that has reached the cloud.
   */
  async uploadNow(): Promise<void> {
    const generation = this.generation;
    if (this.paused) throw new Error(this.lastFlushError ?? "Sync is paused until its next retry. Your changes remain on this device.");
    // A pass already under way may have started before the latest changes.
    for (let attempt = 0; attempt < 3 && this.hasPending; attempt++) {
      this.lastFlushError = null;
      await this.flush();
      if (generation !== this.generation) throw new Error("Account changed during upload.");
      if (this.lastFlushError) break;
    }
    if (this.hasPending) {
      throw new Error(this.lastFlushError ?? "Changes are still waiting to upload.");
    }
  }

  /** Uploads within `delay`, or sooner if an earlier upload is already due. */
  private scheduleUpload(delay: number) {
    const due = Date.now() + delay;
    if (this.uploadTimer && this.uploadDue <= due) return;
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadDue = due;
    this.uploadTimer = setTimeout(() => void this.flush(), delay);
  }

  flush(): Promise<void> {
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    if (!this.uid || this.paused || (!this.hasPending && !this.inflight)) return Promise.resolve();
    if (!this.inflight) {
      const pass: Promise<void> = this.runFlush().finally(() => {
        if (this.inflight === pass) this.inflight = null;
      });
      this.inflight = pass;
    }
    return this.inflight;
  }

  private async runFlush(): Promise<void> {
    if (!this.hasPending) return;
    const generation = this.generation;
    const col = this.collectionRef;
    try {
      while (this.hasPending && generation === this.generation) {
        const blocked = Object.entries(this.pending).filter(([key, value]) => !validChange(key, value));
        const entries = Object.entries(this.pending).filter(([key, value]) => validChange(key, value)).slice(0, 50);
        if (!entries.length) {
          this.lastFlushError = `${blocked.length} changes exceed cloud limits or have invalid record IDs. They remain on this device; shorten them or export a backup.`;
          await this.persist();
          this.status("Some changes cannot sync", this.lastFlushError);
          return;
        }
        const operationIds: Record<string, string> = {};
        for (const [key] of entries) operationIds[key] = this.pendingIds[key];
        const bases: Pending = {};
        for (const [key] of entries) if (key in this.bases) bases[key] = this.bases[key];

        const outcome = await runTransaction(this.db, async (tx) => {
          const snapshots: Record<string, DocumentSnapshot<DocumentData>> = {};
          for (const [key] of entries) snapshots[key] = await tx.get(doc(col, key));
          const tombstones = new Set<string>();
          const conflicts: Record<string, string> = {};
          const copies: Record<string, [string, string][]> = {};
          const remoteAt: Record<string, number> = {};
          let writes = 0;
          for (const [key, value] of entries) {
            const remote = snapshots[key];
            remoteAt[key] = millisOf(remote.data()?.updatedAt) ?? 0;
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
          const candidates: Record<string, [string, string][]> = {};
          const copySnapshots: Record<string, DocumentSnapshot<DocumentData>> = {};
          for (const [key, value] of entries) {
            if (!(key in conflicts)) continue;
            candidates[key] = recoveryRecords(key, value!, operationIds[key]);
            for (const [copyKey] of candidates[key]) copySnapshots[copyKey] = await tx.get(doc(col, copyKey));
          }
          for (const [key, value] of entries) {
            if (tombstones.has(key)) continue;
            if (key in conflicts) {
              copies[key] = candidates[key].map(([copyKey, payload]) => {
                const existing = copySnapshots[copyKey];
                if (!existing.exists()) { tx.set(doc(col, copyKey), this.document(copyKey, payload)); writes++; }
                return [copyKey, (existing.data()?.payload as string | undefined) ?? payload];
              });
            } else if (snapshots[key].data()?.payload !== value || !snapshots[key].exists()) {
              tx.set(doc(col, key), this.document(key, value));
              writes++;
            }
            // Otherwise this exact write already landed before an earlier
            // attempt lost its acknowledgement.
          }
          return { tombstones, conflicts, copies, remoteAt, writes };
        });
        if (generation !== this.generation) return;
        this.recordsUploaded += outcome.writes;
        this.recordsReceived += entries.length;
        this.lastUploadedAt = Date.now();

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
            for (const [copyKey, payload] of outcome.copies[key] ?? []) {
              this.records[copyKey] = payload;
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
          const deferred = this.deferred.get(key);
          if (!(key in this.pending)) {
            if (deferred && deferred.at > outcome.remoteAt[key] && !outcome.tombstones.has(key)) {
              if (deferred.payload == null) delete this.records[key];
              else this.records[key] = deferred.payload;
              recordsChanged = true;
            }
            this.deferred.delete(key);
          }
        }
        if (recordsChanged) this.onRecords?.({ ...this.records });
        await this.persist();
        if (Object.keys(outcome.conflicts).length > 0) {
          this.status("Sync conflicts saved as copies");
        }
      }

      if (generation === this.generation) {
        // The live listener supplies updates; deferred events above reconcile
        // writes that arrived during a transaction. No second collection query.
        this.retryAt = null;
        this.retryReason = null;
        this.lastFlushError = null;
        this.failureCount = 0;
        this.status(this.hasPending ? "Changes waiting to sync" : "Synced");
      }
    } catch (error) {
      if (generation === this.generation) {
        // Being offline isn't a fault: the changes upload when it's back.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          this.lastFlushError = String(error);
          this.status("Offline, saved on this device");
        } else this.failed(error);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.generation++;
    if (this.retry) clearInterval(this.retry);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.reconnected);
      document.removeEventListener("visibilitychange", this.uploadNowIfHidden);
      window.removeEventListener("pagehide", this.uploadOnLeave);
    }
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = null;
    if (this.resub) clearTimeout(this.resub);
    if (this.hideTimer) clearTimeout(this.hideTimer);
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
    this.inflight = null;
    this.deferred.clear();
    this.retryAt = null;
    this.retryReason = null;
    this.failureCount = 0;
    this.lastFlushError = null;
    this.storageError = null;
    this.lastUploadedAt = null;
    this.lastDownloadedAt = null;
    this.recordsReceived = 0;
    this.recordsUploaded = 0;
    this.details();
  }
}

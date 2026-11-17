// The user's workspace records (users/{uid}/records) over Firestore's REST
// API, as the user: every request carries their own Firebase ID token, so the
// project's security rules apply exactly as they do to the apps.
//
// Writes follow the apps' sync protocol (webapp/src/lib/cloudSync.ts): one
// document per entity, { kind, payload, deleted, updatedAt }, updatedAt set by
// the server, and tombstones never overwritten. Each edit is read-modify-write
// with the document's update time as a precondition, so an edit made on a
// device in between is never lost: the read is simply retried.

export interface FirebaseEnv {
  FIREBASE_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  FIRESTORE_DATABASE: string;
}

export class SignInExpired extends Error {}

const idTokens = new Map<string, { token: string; expires: number }>();

/** Exchanges a Firebase refresh token for an ID token (cached until shortly before it expires). */
export async function idToken(env: FirebaseEnv, refreshToken: string): Promise<{ token: string; uid: string }> {
  const cached = idTokens.get(refreshToken);
  const now = Date.now();
  const res = cached && cached.expires > now + 60_000
    ? null
    : await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      });
  if (res) {
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; user_id?: string; expires_in?: string; error?: { message?: string } };
    if (!res.ok || !body.id_token || !body.user_id) {
      const reason = body.error?.message ?? `HTTP ${res.status}`;
      if (/TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|INVALID_GRANT_TYPE/.test(reason)) throw new SignInExpired(reason);
      throw new Error(`Could not sign in to Firebase: ${reason}`);
    }
    idTokens.set(refreshToken, { token: body.id_token, expires: now + Number(body.expires_in ?? 3600) * 1000 });
    return { token: body.id_token, uid: body.user_id };
  }
  const token = cached!.token;
  return { token, uid: uidOf(token) };
}

function uidOf(jwt: string): string {
  const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return (JSON.parse(atob(part)) as { user_id: string }).user_id;
}

export interface StoredRecord {
  key: string;
  payload: string;
  updateTime: string;
}

type Value = { stringValue?: string; booleanValue?: boolean };
interface Doc {
  name: string;
  fields?: Record<string, Value>;
  updateTime: string;
}

export class Workspace {
  private constructor(
    private readonly env: FirebaseEnv,
    private readonly token: string,
    readonly uid: string,
  ) {}

  static async open(env: FirebaseEnv, refreshToken: string): Promise<Workspace> {
    const { token, uid } = await idToken(env, refreshToken);
    return new Workspace(env, token, uid);
  }

  private get root() {
    return `projects/${this.env.FIREBASE_PROJECT_ID}/databases/${this.env.FIRESTORE_DATABASE}/documents`;
  }
  private docName(key: string) {
    return `${this.root}/users/${this.uid}/records/${key}`;
  }

  private async call(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`https://firestore.googleapis.com/v1/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...init?.headers },
    });
  }

  private static live(doc: Doc | undefined): StoredRecord | null {
    if (!doc || doc.fields?.deleted?.booleanValue === true) return null;
    const payload = doc.fields?.payload?.stringValue;
    if (typeof payload !== "string" || !payload) return null;
    return { key: doc.name.slice(doc.name.lastIndexOf("/") + 1), payload, updateTime: doc.updateTime };
  }

  /** Every live record of a kind ("task", "project", …). */
  async list(kind: string): Promise<StoredRecord[]> {
    const res = await this.call(`${this.root}/users/${this.uid}:runQuery`, {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "records" }],
          where: { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: kind } } },
        },
      }),
    });
    if (!res.ok) throw new Error(`Could not read your ${kind}s (HTTP ${res.status}): ${await res.text()}`);
    const rows = (await res.json()) as { document?: Doc }[];
    return rows.map((r) => Workspace.live(r.document)).filter((r): r is StoredRecord => r != null);
  }

  /** One record, or null when it doesn't exist or was deleted. */
  async get(key: string): Promise<StoredRecord | null> {
    const res = await this.call(this.docName(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not read ${key} (HTTP ${res.status})`);
    return Workspace.live((await res.json()) as Doc);
  }

  /**
   * Writes a record. With `basedOn` (the update time it was read at) the
   * write only lands if nobody changed it since; without, only if it's new.
   * Returns false when that precondition failed.
   */
  async put(key: string, payload: string, basedOn: string | null): Promise<boolean> {
    const res = await this.call(`${this.root}:commit`, {
      method: "POST",
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: this.docName(key),
              fields: { kind: { stringValue: key.split(":")[0] }, payload: { stringValue: payload }, deleted: { booleanValue: false } },
            },
            updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
            currentDocument: basedOn ? { updateTime: basedOn } : { exists: false },
          },
        ],
      }),
    });
    if (res.ok) return true;
    const text = await res.text();
    if (res.status === 409 || /FAILED_PRECONDITION|ABORTED/.test(text)) return false;
    throw new Error(`Could not save ${key} (HTTP ${res.status}): ${text}`);
  }

  /**
   * Reads a record, applies `edit` to its parsed payload and writes it back,
   * retrying from a fresh read if it changed in between. `edit` returns null
   * (or throws) to give up without writing.
   */
  async update(key: string, edit: (value: Record<string, unknown>) => Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const record = await this.get(key);
      if (!record) return null;
      const next = edit(JSON.parse(record.payload) as Record<string, unknown>);
      if (!next) return null;
      if (await this.put(key, JSON.stringify(next), record.updateTime)) return next;
    }
    throw new Error(`${key} kept changing on another device; try again in a moment.`);
  }
}

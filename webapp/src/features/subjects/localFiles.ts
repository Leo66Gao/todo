"use client";

// Opening a material's file from the web app. A web page can't open
// "/Users/…" by its path (browsers block file: links), so the file is picked
// once on each computer: Chrome and Edge keep a handle to it here, in this
// browser only, and later clicks open it. PDFs, pictures, text and video show
// in a viewer in the app; other kinds are saved as a copy. Browsers without
// file handles (Safari, Firefox, the Android app) copy the path instead, to
// paste into Finder or Explorer.

import { create } from "zustand";
import type { Material } from "@/lib/model";
import { toast } from "@/ui/toast";
import { fileName } from "./materials";

const DB = "todo-files";
const STORE = "handles";

interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  queryPermission?(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" }): Promise<PermissionState>;
}

type Picker = (options?: { multiple?: boolean; id?: string }) => Promise<FileHandle[]>;
const picker = (): Picker | null =>
  typeof window !== "undefined" && "showOpenFilePicker" in window ? (window as unknown as { showOpenFilePicker: Picker }).showOpenFilePicker : null;

/** Whether this browser can keep a file to open later (Chrome, Edge). */
export const canLinkFiles = () => picker() != null;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const conn = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(conn.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    conn.close();
  }
}

/**
 * Linked files, kept in memory too: picking a file or asking to read it again
 * must start inside the click, before anything is awaited.
 */
export const useLinkedFiles = create<{ handles: Map<string, FileHandle>; loaded: boolean }>(() => ({ handles: new Map(), loaded: false }));

export async function loadLinkedFiles() {
  if (useLinkedFiles.getState().loaded || !canLinkFiles()) return;
  try {
    const conn = await db();
    const handles = new Map<string, FileHandle>();
    await new Promise<void>((resolve, reject) => {
      const request = conn.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        handles.set(String(cursor.key), cursor.value as FileHandle);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    conn.close();
    useLinkedFiles.setState({ handles, loaded: true });
  } catch {
    useLinkedFiles.setState({ loaded: true });
  }
}

function remember(id: string, handle: FileHandle | null) {
  const handles = new Map(useLinkedFiles.getState().handles);
  if (handle) handles.set(id, handle);
  else handles.delete(id);
  useLinkedFiles.setState({ handles });
  void (handle ? run("readwrite", (s) => s.put(handle, id)) : run("readwrite", (s) => s.delete(id))).catch(() => {});
}

export const forgetFile = (id: string) => remember(id, null);

/** Asks for the file and keeps it for this material on this computer. */
export async function linkFile(material: Material): Promise<FileHandle | null> {
  const pick = picker();
  if (!pick) return null;
  try {
    const [handle] = await pick({ multiple: false, id: "materials" });
    if (!handle) return null;
    remember(material.id, handle);
    if (material.path && handle.name !== fileName(material.path)) {
      toast(`Linked “${handle.name}”, though the path names “${fileName(material.path)}”.`);
    }
    return handle;
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") toast("That file couldn’t be linked.");
    return null;
  }
}

// ---------------------------------------------------------------------------
// The viewer

export interface ShownFile {
  name: string;
  type: string;
  url: string;
}

export const useFileViewer = create<{ file: ShownFile | null }>(() => ({ file: null }));

export function closeFileViewer() {
  const shown = useFileViewer.getState().file;
  useFileViewer.setState({ file: null });
  // Kept a moment for the closing animation.
  if (shown) setTimeout(() => URL.revokeObjectURL(shown.url), 1000);
}

/** Kinds the app can show itself; anything else is saved as a copy. */
const VIEWABLE = /^(application\/pdf|image\/|text\/|video\/|audio\/)/;

/** Opens the material's file: from its link on this computer, or by asking for it once. */
export function openFile(material: Material) {
  if (!canLinkFiles()) {
    void copyPath(material);
    return;
  }
  const known = useLinkedFiles.getState().handles.get(material.id);
  // Both the picker and the permission prompt start here, inside the click.
  const handle = known ? Promise.resolve(known) : linkFile(material);
  const permitted = known?.queryPermission
    ? known.queryPermission({ mode: "read" }).then((state) => (state === "granted" ? state : (known.requestPermission?.({ mode: "read" }) ?? state)))
    : Promise.resolve<PermissionState>("granted");
  void (async () => {
    const h = await handle;
    if (!h) return;
    try {
      if ((await permitted) !== "granted") return;
      const file = await h.getFile();
      const url = URL.createObjectURL(file);
      if (VIEWABLE.test(file.type)) {
        closeFileViewer();
        useFileViewer.setState({ file: { name: file.name, type: file.type, url } });
        return;
      }
      // Word, slides and the like: the browser saves a copy to open.
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast(
        `Saved a copy of “${file.name}” to Downloads. Edit the original from Finder.`,
        material.path ? { label: "Copy path", run: () => void copyPath(material) } : undefined,
      );
    } catch {
      // Moved, renamed or deleted: forget it and offer to pick it again.
      forgetFile(material.id);
      toast("That file has moved or can’t be read any more.", { label: "Choose it", run: () => openFile(material) });
    }
  })();
}

export async function copyPath(material: Material) {
  if (!material.path) return;
  try {
    await navigator.clipboard.writeText(material.path);
    const mac = /Mac/i.test(navigator.platform);
    toast(mac ? "Path copied. In Finder, press ⇧⌘G and paste to open it." : "Path copied. Paste it into File Explorer’s address bar to open it.");
  } catch {
    toast("Couldn’t copy the path.");
  }
}

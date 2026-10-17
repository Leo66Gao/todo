"use client";

// Opening a material's file from the web app. A web page can't open
// "/Users/…" by its path (browsers block file: links), so:
// - On a Mac with Todo File Opener installed (webapp/mac-file-opener) and
//   turned on in Settings, the path goes to that helper, which opens the file
//   in its own app, as double-clicking it in Finder would.
// - Otherwise the file is picked once on each computer: Chrome and Edge keep
//   a handle to it here, in this browser only, and later clicks open it. PDFs,
//   pictures, text and video show in a viewer in the app; other kinds are
//   saved as a copy.
// - Browsers without file handles (Safari, Firefox, the Android app) copy the
//   path instead, to paste into Finder or Explorer.

import { create } from "zustand";
import type { Material } from "@/lib/model";
import { isNative } from "@/lib/native";
import { getLocal, setLocal } from "@/lib/prefs";
import { routeHref } from "@/shell/nav";
import { toast } from "@/ui/toast";
import { fileName } from "./materials";

// ---------------------------------------------------------------------------
// Todo File Opener (a Mac helper)

const OPENER = "files.macOpener";

/** A Mac browser (not the phone app), where the helper can be installed. */
export const isMacBrowser = () => typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) && !isNative();

/** Whether paths open with Todo File Opener on this computer (set in Settings). */
export const useMacOpener = create<{ on: boolean }>(() => ({ on: typeof window !== "undefined" && isMacBrowser() && getLocal<boolean>(OPENER, false) }));

export function setMacOpener(on: boolean) {
  setLocal(OPENER, on);
  useMacOpener.setState({ on });
}

/** Hands the path to Todo File Opener: open the file, or show it in Finder. */
export function openOnMac(path: string, how: "open" | "reveal" = "open") {
  const a = document.createElement("a");
  a.href = `todo-open://${how}?path=${encodeURIComponent(path)}`;
  a.click();
}

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
  if (material.path && useMacOpener.getState().on) {
    openOnMac(material.path);
    return;
  }
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
      if (VIEWABLE.test(file.type)) {
        // A blob URL belongs to the app's own origin, so a web page (or any
        // text that a browser might run as one) is shown as plain text: its
        // scripts would otherwise run with the app's sign-in and keys.
        const text = file.type.startsWith("text/");
        const shown = text ? new Blob([file], { type: "text/plain;charset=utf-8" }) : file;
        closeFileViewer();
        useFileViewer.setState({ file: { name: file.name, type: text ? "text/plain" : file.type, url: URL.createObjectURL(shown) } });
        return;
      }
      const url = URL.createObjectURL(file);
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
    toast(
      mac ? "Path copied. In Finder, press ⇧⌘G and paste to open it." : "Path copied. Paste it into File Explorer’s address bar to open it.",
      // Opening it straight away needs the helper (Settings → Files).
      isMacBrowser() && !useMacOpener.getState().on ? { label: "Open directly", run: () => window.history.pushState(null, "", routeHref({ view: "settings" })) } : undefined,
    );
  } catch {
    toast("Couldn’t copy the path.");
  }
}

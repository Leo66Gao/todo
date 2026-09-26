"use client";

import { create } from "zustand";
import { getLocal, setLocal } from "@/lib/prefs";

// Liquid Glass is a per-device look (like the window size), so its settings
// live in this browser only and never touch the synced workspace.

export type GlassFinish = "clear" | "balanced" | "frosted";
export type PresetId = "harbour" | "citrus" | "prism" | "contour" | "ember" | "studio";
export type BackgroundId = PresetId | "image";

export interface GlassPrefs {
  enabled: boolean;
  background: BackgroundId;
  finish: GlassFinish;
  /** Highlights follow the pointer (desktop). */
  pointerLight: boolean;
}

const DEFAULTS: GlassPrefs = { enabled: false, background: "harbour", finish: "balanced", pointerLight: true };
const KEY = "glass";

interface GlassState extends GlassPrefs {
  /** The personal background, decoded; null until loaded or when there is none. */
  image: ImageBitmap | null;
  hasImage: boolean;
}

export const useGlassPrefs = create<GlassState>(() => ({ ...DEFAULTS, image: null, hasImage: false }));

function persist() {
  const { enabled, background, finish, pointerLight } = useGlassPrefs.getState();
  setLocal(KEY, { enabled, background, finish, pointerLight });
}

export function restoreGlassPrefs() {
  const saved = getLocal<Partial<GlassPrefs>>(KEY, {});
  useGlassPrefs.setState({ ...DEFAULTS, ...saved });
  // Development aid: `?glass=<preset>` turns the theme on with that background.
  if (process.env.NODE_ENV !== "production") {
    const preset = new URLSearchParams(location.search).get("glass");
    if (preset) useGlassPrefs.setState({ enabled: true, background: preset as BackgroundId });
  }
  void loadImage().then((image) => {
    if (image) useGlassPrefs.setState({ image, hasImage: true });
    else if (useGlassPrefs.getState().background === "image") setGlassPrefs({ background: DEFAULTS.background });
  });
}

export function setGlassPrefs(patch: Partial<GlassPrefs>) {
  useGlassPrefs.setState(patch);
  persist();
}

// ---------------------------------------------------------------------------
// Personal image: stored in IndexedDB (localStorage is too small for images).

const DB = "todo-web";
const STORE = "images";
const IMAGE_KEY = "glass-background";
/** Longest side kept; larger photos are scaled down before saving. */
const MAX_SIDE = 2560;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function loadImage(): Promise<ImageBitmap | null> {
  try {
    const blob = await withStore<Blob | undefined>("readonly", (s) => s.get(IMAGE_KEY) as IDBRequest<Blob | undefined>);
    return blob ? await createImageBitmap(blob) : null;
  } catch {
    return null;
  }
}

/** Scales the photo down, stores it and makes it the background. */
export async function setBackgroundImage(file: File): Promise<void> {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
  source.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be read."))), "image/jpeg", 0.9),
  );
  await withStore("readwrite", (s) => s.put(blob, IMAGE_KEY));
  const image = await createImageBitmap(blob);
  useGlassPrefs.getState().image?.close();
  useGlassPrefs.setState({ image, hasImage: true });
  setGlassPrefs({ background: "image" });
}

export async function removeBackgroundImage(): Promise<void> {
  await withStore("readwrite", (s) => s.delete(IMAGE_KEY));
  useGlassPrefs.getState().image?.close();
  useGlassPrefs.setState({ image: null, hasImage: false });
  if (useGlassPrefs.getState().background === "image") setGlassPrefs({ background: DEFAULTS.background });
}

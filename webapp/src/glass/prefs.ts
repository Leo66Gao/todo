"use client";

import { create } from "zustand";
import { getLocal, setLocal } from "@/lib/prefs";

// Liquid Glass is a per-device look (like the window size), so its settings
// live in this browser only and never touch the synced workspace.

/** Backgrounds drawn by the renderer. */
export type PresetId = "harbour" | "contour" | "ember" | "studio";
/** Photographs shipped with the app (public/backgrounds). */
export type PhotoId = "alpine" | "lake" | "forest" | "coast" | "dunes";
export type BackgroundId = PresetId | PhotoId | "image";

export const PRESET_IDS: readonly PresetId[] = ["harbour", "contour", "ember", "studio"];
export const PHOTO_IDS: readonly PhotoId[] = ["alpine", "lake", "forest", "coast", "dunes"];
export const isPhoto = (id: string): id is PhotoId => (PHOTO_IDS as readonly string[]).includes(id);
const isBackground = (id: unknown): id is BackgroundId =>
  typeof id === "string" && (id === "image" || isPhoto(id) || (PRESET_IDS as readonly string[]).includes(id));

export interface GlassPrefs {
  enabled: boolean;
  background: BackgroundId;
  /** How much the glass blurs what is behind it: 0 none … 1 fully diffused. */
  blur: number;
  /** Milky haze in the glass: 0 clear … 1 fully frosted. */
  frost: number;
  /** Corner radius of the glass panels, in CSS px; controls scale with it. */
  radius: number;
  /** Light text in light mode, for darker backgrounds. */
  lightText: boolean;
  /** Highlights follow the pointer (desktop). */
  pointerLight: boolean;
}

const DEFAULTS: GlassPrefs = { enabled: false, background: "harbour", blur: 0.75, frost: 0.4, radius: 22, lightText: false, pointerLight: true };
export const RADIUS_RANGE = [10, 34] as const;
const KEY = "glass";

interface GlassState extends GlassPrefs {
  /** The personal background, decoded; null until loaded or when there is none. */
  image: ImageBitmap | null;
  hasImage: boolean;
}

export const useGlassPrefs = create<GlassState>(() => ({ ...DEFAULTS, image: null, hasImage: false }));

function persist() {
  const { enabled, background, blur, frost, radius, lightText, pointerLight } = useGlassPrefs.getState();
  setLocal(KEY, { enabled, background, blur, frost, radius, lightText, pointerLight });
}

export function restoreGlassPrefs() {
  const { finish, ...saved } = getLocal<Partial<GlassPrefs> & { finish?: string }>(KEY, {});
  // The earlier three-step setting maps onto the blur slider.
  const fromFinish = finish === "clear" ? 0.25 : finish === "frosted" ? 0.9 : undefined;
  useGlassPrefs.setState({ ...DEFAULTS, ...(fromFinish != null && { blur: fromFinish }), ...saved });
  const state = useGlassPrefs.getState();
  for (const key of ["blur", "frost", "radius"] as const) {
    if (typeof state[key] !== "number" || !Number.isFinite(state[key])) useGlassPrefs.setState({ [key]: DEFAULTS[key] });
  }
  // Backgrounds retired since they were chosen fall back to the default.
  if (!isBackground(useGlassPrefs.getState().background)) setGlassPrefs({ background: DEFAULTS.background });
  // Development aid: `?glass=<preset>` turns the theme on with that background.
  if (process.env.NODE_ENV !== "production") {
    const preset = new URLSearchParams(location.search).get("glass");
    if (isBackground(preset)) useGlassPrefs.setState({ enabled: true, background: preset });
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

"use client";

import type { PhotoId } from "./prefs";

/**
 * Landscape photographs shipped with the app, from Unsplash (Unsplash
 * License). Each has a full copy (2560px) and a small one for previews.
 */
export const PHOTOS: { id: PhotoId; name: string }[] = [
  { id: "alpine", name: "Alpine" }, // unsplash.com/photos/z_f2JrBRbOg
  { id: "lake", name: "Lake" }, // unsplash.com/photos/Tr-faG4v38w
  { id: "forest", name: "Forest" }, // images.unsplash.com/photo-1542273917363-3b1817f69a2d
  { id: "coast", name: "Coast" }, // images.unsplash.com/photo-1510414842594-a61c69b5ae57
  { id: "dunes", name: "Dunes" }, // images.unsplash.com/photo-1611522135886-a632d94ff6ae
];

const requests = new Map<string, Promise<ImageBitmap>>();
const loaded = new Map<string, ImageBitmap>();

const url = (id: PhotoId, size: "full" | "small") => `/backgrounds/${id}${size === "small" ? "-small" : ""}.jpg`;

/** Decodes a photograph once; later calls share the same bitmap. */
export function loadPhoto(id: PhotoId, size: "full" | "small" = "full"): Promise<ImageBitmap> {
  const key = url(id, size);
  let request = requests.get(key);
  if (!request) {
    request = fetch(key)
      .then((response) => {
        if (!response.ok) throw new Error(`Background ${key} failed to load (${response.status})`);
        return response.blob();
      })
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        loaded.set(key, bitmap);
        return bitmap;
      });
    request.catch(() => requests.delete(key));
    requests.set(key, request);
  }
  return request;
}

/** The decoded photograph, if it is already in memory. */
export function loadedPhoto(id: PhotoId, size: "full" | "small" = "full"): ImageBitmap | null {
  return loaded.get(url(id, size)) ?? null;
}

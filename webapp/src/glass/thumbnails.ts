"use client";

import { GlassEngine, type Shape } from "./engine";
import { isPhoto, type BackgroundId, type PhotoId, type PresetId } from "./prefs";
import { loadPhoto } from "./photos";

const cache = new Map<string, string>();

const W = 132;
const H = 88;

function shape(partial: Partial<Shape> & Pick<Shape, "x" | "y" | "w" | "h" | "radius" | "kind">): Shape {
  return { hover: 0, press: 0, opacity: 1, clip: null, ...partial };
}

/**
 * Previews of each background with a little glass on it, rendered by the same
 * engine as the app (one short-lived WebGL context for the whole set).
 */
export async function renderThumbnails(
  ids: Exclude<BackgroundId, "image">[],
  dark: boolean,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing = ids.filter((id) => {
    const hit = cache.get(`${id}:${dark}`);
    if (hit) out[id] = hit;
    return !hit;
  });
  if (missing.length === 0) return out;
  // Photographs render from their small copies.
  const photos = new Map<PhotoId, ImageBitmap>();
  await Promise.all(
    missing.filter(isPhoto).map((id) =>
      loadPhoto(id, "small")
        .then((bitmap) => void photos.set(id, bitmap))
        .catch(() => {}),
    ),
  );
  const canvas = document.createElement("canvas");
  let engine: GlassEngine;
  try {
    engine = new GlassEngine(canvas);
  } catch {
    return out;
  }
  engine.resize(W, H, 2);
  const level1 = [shape({ x: 10, y: 10, w: 46, h: 68, radius: 11, kind: "chrome" })];
  const level2 = [
    shape({ x: 15, y: 17, w: 36, h: 13, radius: 6.5, kind: "control" }),
    shape({ x: 72, y: 54, w: 46, h: 22, radius: 11, kind: "ink" }),
  ];
  for (const id of missing) {
    const photo = isPhoto(id) ? photos.get(id) : undefined;
    if (isPhoto(id) && !photo) continue;
    engine.setLook({
      background: photo ? "image" : (id as PresetId),
      image: photo ?? null,
      dark,
      frost: 0.5,
      pointerLight: false,
      solid: false,
    });
    engine.render(level1, level2, [0, 0, 0]);
    const url = canvas.toDataURL("image/jpeg", 0.88);
    cache.set(`${id}:${dark}`, url);
    out[id] = url;
  }
  engine.dispose();
  return out;
}

/** A small cover-cropped copy of the personal image for its tile. */
export function imageThumbnail(image: ImageBitmap): string {
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const s = Math.max(canvas.width / image.width, canvas.height / image.height);
  const w = image.width * s;
  const h = image.height * s;
  canvas.getContext("2d")!.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.85);
}

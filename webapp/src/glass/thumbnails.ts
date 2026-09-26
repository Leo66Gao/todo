"use client";

import { GlassEngine, type Shape } from "./engine";
import type { GlassFinish, PresetId } from "./prefs";

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
export function renderThumbnails(presets: PresetId[], dark: boolean, finish: GlassFinish): Record<string, string> {
  const out: Record<string, string> = {};
  const missing = presets.filter((p) => {
    const hit = cache.get(`${p}:${dark}:${finish}`);
    if (hit) out[p] = hit;
    return !hit;
  });
  if (missing.length === 0) return out;
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
  for (const preset of missing) {
    engine.setLook({ background: preset, image: null, dark, finish, pointerLight: false, solid: false });
    engine.render(level1, level2, [0, 0, 0]);
    const url = canvas.toDataURL("image/jpeg", 0.88);
    cache.set(`${preset}:${dark}:${finish}`, url);
    out[preset] = url;
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

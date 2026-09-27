"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "./cn";

// Glass for the phone's floating buttons and bars: the page behind is
// blurred a little and bent at the rim through an SVG displacement map (as a
// real lens would), with a bright specular edge on top. Chromium, which the
// Android app runs in, takes url() filters in backdrop-filter; other browsers
// fall back to plain frosted glass.

const maps = new Map<string, string>();

/**
 * A displacement map for a rounded rectangle: red and green hold how far to
 * look inwards, growing towards the rim over the bezel, so the edge magnifies
 * and bends what is behind it.
 */
function lensMap(w: number, h: number, radius: number, bezel: number): string {
  const key = `${w}x${h}r${radius}b${bezel}`;
  const hit = maps.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw, hh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r);
      const qy = Math.abs(py) - (hh - r);
      let depth: number;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        depth = r - len;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        depth = r - qx;
        nx = Math.sign(px);
      } else {
        depth = r - qy;
        ny = Math.sign(py);
      }
      // 1 at the rim, easing to 0 at the inner edge of the bezel: a rounded
      // (circular) profile, so the bend steepens sharply right at the edge.
      const t = depth <= 0 ? 1 : depth >= bezel ? 0 : 1 - depth / bezel;
      const m = 1 - Math.sqrt(Math.max(0, 1 - t * t));
      const i = (y * w + x) * 4;
      img.data[i] = 128 - nx * m * 127;
      img.data[i + 1] = 128 - ny * m * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  maps.set(key, url);
  return url;
}

/** The filter itself: refraction, with the colours split a touch at the rim. */
export function LensFilter({ id, w, h, radius, bezel, scale = 26 }: { id: string; w: number; h: number; radius: number; bezel: number; scale?: number }) {
  // (Only rendered after mount, inside the app shell, so the DOM is there.)
  const url = useMemo(() => (typeof document === "undefined" ? "" : lensMap(w, h, radius, bezel)), [w, h, radius, bezel]);
  if (!url) return null;
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
      <filter id={id} filterUnits="userSpaceOnUse" x="0" y="0" width={w} height={h} colorInterpolationFilters="sRGB">
        <feImage href={url} x="0" y="0" width={w} height={h} preserveAspectRatio="none" result="m" />
        <feDisplacementMap in="SourceGraphic" in2="m" scale={scale * 1.1} xChannelSelector="R" yChannelSelector="G" result="dr" />
        <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cr" />
        <feDisplacementMap in="SourceGraphic" in2="m" scale={scale} xChannelSelector="R" yChannelSelector="G" result="dg" />
        <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cg" />
        <feDisplacementMap in="SourceGraphic" in2="m" scale={scale * 0.9} xChannelSelector="R" yChannelSelector="G" result="db" />
        <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cb" />
        <feComposite in="cr" in2="cg" operator="arithmetic" k2="1" k3="1" result="rg" />
        <feComposite in="rg" in2="cb" operator="arithmetic" k2="1" k3="1" />
      </filter>
    </svg>
  );
}

/** Shared filters for the fixed-size round buttons (see the lens-chip and lens-round utilities). */
export function LensDefs() {
  return (
    <>
      <LensFilter id="lens-c44" w={44} h={44} radius={22} bezel={15} scale={34} />
      <LensFilter id="lens-c58" w={58} h={58} radius={29} bezel={20} scale={44} />
    </>
  );
}

/**
 * Glass that sizes itself to its parent (which must be positioned and
 * rounded): for bars whose width varies, like the tab bar.
 */
export function GlassLens({ radius, bezel = 20, className }: { radius: number; bezel?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const id = `lens-${useId().replace(/:/g, "")}`;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // While the glass is changing size (a capsule widening), drawing a new
  // refraction map every frame would drop frames: it stays plain frosted until
  // the size has held still for a moment.
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    let first = true;
    let last = "";
    const measure = () => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (w <= 0 || h <= 0 || `${w}x${h}` === last) return;
      last = `${w}x${h}`;
      const commit = () => {
        setSettling(false);
        setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
      };
      window.clearTimeout(timer);
      if (first) {
        first = false;
        commit();
      } else {
        setSettling(true);
        timer = window.setTimeout(commit, 90);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn("lens-surface pointer-events-none absolute inset-0 rounded-[inherit]", className)}
      style={size ? { backdropFilter: `blur(1.5px) saturate(1.9) brightness(1.04)${settling ? "" : ` url(#${id})`}` } : undefined}
    >
      {size && <LensFilter id={id} w={size.w} h={size.h} radius={Math.min(radius, size.h / 2)} bezel={bezel} scale={48} />}
    </span>
  );
}

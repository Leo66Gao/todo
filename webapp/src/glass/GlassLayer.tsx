"use client";

import { useEffect, useRef } from "react";
import { GlassEngine, IDENTITY_VIEW, ShapeTracker, type ViewMap } from "./engine";
import { isPhoto, PHOTO_IDS, PRESET_IDS, useGlassOn, useGlassPrefs } from "./prefs";
import { loadedPhoto, loadPhoto } from "./photos";
import { noteScroll } from "./registry";
import { reportGlassTop } from "@/lib/native";

const PRESET_CLASSES = [...PRESET_IDS, ...PHOTO_IDS, "image"].map((p) => `glass-bg-${p}`);

/** Keeps <html> classes in step with the theme: `glass`, a background class, and the CSS fallback. */
export function useGlassDocumentClasses() {
  const enabled = useGlassOn();
  const background = useGlassPrefs((s) => s.background);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("glass", enabled);
    root.classList.remove(...PRESET_CLASSES);
    if (enabled) root.classList.add(`glass-bg-${background}`);
    return () => {
      root.classList.remove("glass", ...PRESET_CLASSES);
    };
  }, [enabled, background]);

  // Overlays drawn in CSS follow the frost setting too: whiter, and grained.
  const frost = useGlassPrefs((s) => s.frost);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--glass-frost", String(enabled ? frost : 0));
    root.classList.toggle("glass-frosty", enabled && frost > 0.15);
  }, [enabled, frost]);

  const lightText = useGlassPrefs((s) => s.lightText);
  useEffect(() => {
    document.documentElement.classList.toggle("glass-light-text", enabled && lightText);
  }, [enabled, lightText]);
}

/**
 * The Liquid Glass canvas: fixed behind the page, it paints the background
 * and every registered glass surface. Without WebGL2 the theme falls back to
 * CSS (`glass-css`): a gradient background and backdrop-filter surfaces.
 */
export function GlassLayer() {
  const enabled = useGlassOn();
  useGlassDocumentClasses();
  if (!enabled) return null;
  return <GlassCanvas />;
}

function GlassCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A fresh canvas per mount: a released WebGL context can't be reused.
    const canvas = document.createElement("canvas");
    canvas.className = "glass-canvas";
    canvas.setAttribute("aria-hidden", "true");
    hostRef.current!.appendChild(canvas);
    const root = document.documentElement;
    let engine: GlassEngine;
    try {
      engine = new GlassEngine(canvas);
    } catch (error) {
      console.warn(error);
      canvas.remove();
      root.classList.add("glass-css");
      return () => root.classList.remove("glass-css");
    }
    root.classList.remove("glass-css");
    engine.onTopColor = reportGlassTop;
    const tracker = new ShapeTracker();
    // Development aid: `?glass-bg` shows the bare background.
    const bareBackground = process.env.NODE_ENV !== "production" && location.search.includes("glass-bg");
    if (bareBackground) root.classList.add("glass-bare");
    const pointer = { x: -1e4, y: -1e4, down: false, inside: false, fine: false, moved: 0, influence: 0 };
    const reducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)");
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

    let photoRequest = 0;
    const applyLook = () => {
      const s = useGlassPrefs.getState();
      const common = {
        dark: root.classList.contains("dark"),
        blur: s.blur,
        frost: s.frost,
        lightText: s.lightText && !root.classList.contains("dark"),
        pointerLight: s.pointerLight,
        solid: reducedTransparency.matches,
      };
      const request = ++photoRequest;
      if (isPhoto(s.background)) {
        const id = s.background;
        const show = (image: ImageBitmap) => {
          if (request === photoRequest) engine.setLook({ ...common, background: "image", image });
        };
        const full = loadedPhoto(id);
        if (full) return show(full);
        // The small copy arrives almost at once and reads the same behind
        // frosted glass; the full photograph replaces it when it lands.
        void loadPhoto(id, "small")
          .then(show)
          .then(() => loadPhoto(id))
          .then(show)
          .catch((error) => console.warn(error));
        return;
      }
      engine.setLook({
        ...common,
        background: s.background === "image" ? (s.image ? "image" : "harbour") : s.background,
        image: s.image,
      });
    };
    applyLook();
    const unsubscribe = useGlassPrefs.subscribe(applyLook);
    const darkObserver = new MutationObserver(applyLook);
    darkObserver.observe(root, { attributes: true, attributeFilter: ["class"] });
    reducedTransparency.addEventListener("change", applyLook);

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.inside = true;
      pointer.fine = e.pointerType === "mouse" || e.pointerType === "pen";
      pointer.moved = performance.now();
    };
    const onDown = (e: PointerEvent) => {
      onMove(e);
      pointer.down = true;
    };
    const onUp = (e: PointerEvent) => {
      pointer.down = false;
      // Touches leave no hovering pointer behind.
      if (e.pointerType === "touch") pointer.inside = false;
    };
    const onLeave = () => {
      pointer.inside = false;
      pointer.down = false;
    };
    // Lists hand their glass cards to CSS while they scroll.
    const onScroll = (e: Event) => {
      if (e.target instanceof Element) noteScroll(e.target);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    let influence = 0;
    let frame = 0;
    let visible = !document.hidden;
    // Pinch zoom: Chrome and Firefox scale this fixed canvas with the page,
    // but desktop Safari leaves it as it is on screen while the page grows,
    // so there the shapes are mapped through the zoom to stay under their
    // elements. (The background stays put, as Safari's own fixed layers do.)
    const safariDesktop =
      /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(navigator.userAgent) && navigator.maxTouchPoints === 0;
    const viewMap = (): ViewMap => {
      const vv = window.visualViewport;
      if (!safariDesktop || !vv || Math.abs(vv.scale - 1) < 0.001) return IDENTITY_VIEW;
      return { scale: vv.scale, x: vv.offsetLeft, y: vv.offsetTop };
    };
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!visible) return;
      // The layout viewport's size: unlike innerWidth in Safari, a pinch doesn't change it.
      const { clientWidth, clientHeight } = document.documentElement;
      engine.resize(clientWidth || window.innerWidth, clientHeight || window.innerHeight, window.devicePixelRatio || 1);
      // The highlight leans towards a mouse; it eases back when the mouse leaves.
      const wantLight = useGlassPrefs.getState().pointerLight && finePointer.matches && pointer.inside && pointer.fine ? 1 : 0;
      influence += (wantLight - influence) * 0.12;
      if (Math.abs(wantLight - influence) < 0.002) influence = wantLight;
      pointer.influence = influence;
      const view = viewMap();
      const [level1, level2] = bareBackground ? [[], []] : tracker.collect(pointer, view);
      const px = Math.round((pointer.x - view.x) * view.scale);
      const py = Math.round((pointer.y - view.y) * view.scale);
      engine.render(level1, level2, [px, py, Math.round(influence * 500) / 500]);
    };
    frame = requestAnimationFrame(tick);
    const onVisibility = () => {
      visible = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(frame);
      root.classList.add("glass-css");
    };
    canvas.addEventListener("webglcontextlost", onLost);
    requestAnimationFrame(() => canvas.classList.add("is-ready"));

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      darkObserver.disconnect();
      reducedTransparency.removeEventListener("change", applyLook);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      engine.dispose();
      canvas.remove();
      root.classList.remove("glass-css");
    };
  }, []);

  return <div ref={hostRef} className="contents" />;
}

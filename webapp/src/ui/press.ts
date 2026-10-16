"use client";

// Touch feedback for the phone. A tap is often shorter than a frame or two,
// so :active barely shows; instead, anything pressable sinks the moment a
// finger lands, stays down for at least a beat, and springs back on release.
// Small controls sink further than mid-sized ones. Wide rows don't move: in a
// card, a shrunken row showed the card's edge around its highlight. Uses the
// `scale` property, so it composes with transforms set elsewhere (motion, drag).

const PRESSABLE = 'button, a[href], [role="button"], [role="tab"], [role="checkbox"], [role="menuitem"], summary, label';
const DOWN = "scale 120ms cubic-bezier(0.3, 0.7, 0.4, 1)";
// A spring with a whisper of overshoot, as a CSS easing.
const UP = "scale 420ms linear(0, 0.18 4%, 0.52 12%, 0.84 22%, 1.02 34%, 1.04 44%, 1.015 60%, 1.002 78%, 1)";
const HOLD = 90;

let started = false;

export function startPressFeedback() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let current: { el: HTMLElement; at: number; base: string; x: number; y: number } | null = null;

  const release = () => {
    const c = current;
    if (!c) return;
    current = null;
    const wait = Math.max(0, HOLD - (performance.now() - c.at));
    window.setTimeout(() => {
      c.el.style.transition = [c.base, UP].filter(Boolean).join(", ");
      c.el.style.scale = "";
      window.setTimeout(() => {
        if (current?.el !== c.el) c.el.style.transition = c.base;
      }, 440);
    }, wait);
  };

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(PRESSABLE);
      if (!el || el.closest("[data-no-press]") || (el as HTMLButtonElement).disabled) return;
      release();
      const width = el.offsetWidth;
      if (width > 240) return;
      // Buttons and chips dip clearly; wider ones less.
      const depth = width > 120 ? 0.965 : 0.9;
      const base = el.style.transition;
      const computed = base || getComputedStyle(el).transition;
      const keep = computed && !computed.startsWith("all 0s") ? computed : "";
      current = { el, at: performance.now(), base, x: e.clientX, y: e.clientY };
      el.style.transition = [keep, DOWN].filter(Boolean).join(", ");
      el.style.scale = String(depth);
    },
    { passive: true, capture: true },
  );
  window.addEventListener("pointerup", release, { passive: true, capture: true });
  window.addEventListener("pointercancel", release, { passive: true, capture: true });
  // A drag or swipe that starts on a button isn't a press.
  window.addEventListener(
    "pointermove",
    (e) => {
      if (current && Math.hypot(e.clientX - current.x, e.clientY - current.y) > 10) release();
    },
    { passive: true, capture: true },
  );
  // Nor is a scroll that starts on a button isn't a press.
  window.addEventListener("scroll", release, { passive: true, capture: true });
}

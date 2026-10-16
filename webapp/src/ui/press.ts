"use client";

// Touch feedback for the phone. A tap is often shorter than a frame or two,
// so :active barely shows; instead, anything pressable sinks once a finger has
// rested on it for a moment, stays down for at least a beat, and springs back
// on release. Small controls sink further than mid-sized ones. Wide rows don't
// move (in a card, a shrunken row showed the card's edge around it): they take
// a light tint instead ([data-pressed], in globals.css). The short wait means
// a touch that turns into a scroll or a swipe never dips; a tap quicker than
// the wait still shows its press on release. Uses the `scale` property, so it
// composes with transforms set elsewhere (motion, drag).

const PRESSABLE = 'button, a[href], [role="button"], [role="tab"], [role="checkbox"], [role="menuitem"], summary, label';
const DOWN = "scale 120ms cubic-bezier(0.3, 0.7, 0.4, 1)";
// A spring with a whisper of overshoot, as a CSS easing.
const UP = "scale 420ms linear(0, 0.18 4%, 0.52 12%, 0.84 22%, 1.02 34%, 1.04 44%, 1.015 60%, 1.002 78%, 1)";
/** How long a finger rests before the press shows. */
const WAIT = 60;
/** The least time a press stays shown. */
const HOLD = 90;

let started = false;

type Press = { el: HTMLElement; x: number; y: number; base: string; wide: boolean; shownAt: number | null; timer: number };

export function startPressFeedback() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let current: Press | null = null;

  const show = (p: Press) => {
    p.shownAt = performance.now();
    if (p.wide) {
      p.el.dataset.pressed = "";
      return;
    }
    // Buttons and chips dip clearly; wider ones less.
    const depth = p.el.offsetWidth > 120 ? 0.965 : 0.9;
    const computed = p.base || getComputedStyle(p.el).transition;
    const keep = computed && !computed.startsWith("all 0s") ? computed : "";
    p.el.style.transition = [keep, DOWN].filter(Boolean).join(", ");
    p.el.style.scale = String(depth);
  };

  const hide = (p: Press) => {
    if (p.wide) {
      delete p.el.dataset.pressed;
      return;
    }
    p.el.style.transition = [p.base, UP].filter(Boolean).join(", ");
    p.el.style.scale = "";
    window.setTimeout(() => {
      if (current?.el !== p.el) p.el.style.transition = p.base;
    }, 440);
  };

  /** Lets go: a press that was showing (or a tap too quick to show) springs back after its beat. */
  const release = (tapped: boolean) => {
    const p = current;
    if (!p) return;
    current = null;
    window.clearTimeout(p.timer);
    if (p.shownAt == null) {
      if (!tapped) return;
      show(p);
    }
    const wait = Math.max(0, HOLD - (performance.now() - (p.shownAt ?? 0)));
    window.setTimeout(() => hide(p), wait);
  };

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(PRESSABLE);
      if (!el || el.closest("[data-no-press]") || (el as HTMLButtonElement).disabled) return;
      release(false);
      const p: Press = { el, x: e.clientX, y: e.clientY, base: el.style.transition, wide: el.offsetWidth > 240, shownAt: null, timer: 0 };
      p.timer = window.setTimeout(() => {
        if (current === p) show(p);
      }, WAIT);
      current = p;
    },
    { passive: true, capture: true },
  );
  window.addEventListener("pointerup", () => release(true), { passive: true, capture: true });
  window.addEventListener("pointercancel", () => release(false), { passive: true, capture: true });
  // A drag or swipe that starts on a button isn't a press.
  window.addEventListener(
    "pointermove",
    (e) => {
      if (current && Math.hypot(e.clientX - current.x, e.clientY - current.y) > 10) release(false);
    },
    { passive: true, capture: true },
  );
  // Nor is a scroll that starts on one.
  window.addEventListener("scroll", () => release(false), { passive: true, capture: true });
}

"use client";

// Scrolling in step with the glass. Browsers scroll on a thread of their own,
// so a list moves a frame or more (more in Safari) before the page's script
// hears of it, and the glass drawn under its rows trails behind. While Liquid
// Glass is on, wheel and trackpad scrolling is applied here instead, on the
// page's thread, so rows and their glass move in the same frame. A mouse
// wheel's notches glide over a few frames, as they do natively.

const OVERLAY = '[data-overlay], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

type Axis = "x" | "y";

/** Wheel distance still to glide, per scrolling element. */
const gliding = new Map<HTMLElement, { x: number; y: number }>();

function canScroll(el: HTMLElement, axis: Axis, delta: number) {
  const style = getComputedStyle(el);
  if (!/(auto|scroll)/.test(axis === "y" ? style.overflowY : style.overflowX)) return false;
  const pos = axis === "y" ? el.scrollTop : el.scrollLeft;
  const max = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  if (max <= 1) return false;
  return delta < 0 ? pos > 0.5 : pos < max - 0.5;
}

function onWheel(e: WheelEvent) {
  // Pinch zoom arrives as a wheel with ctrl held; overlays scroll natively.
  if (e.defaultPrevented || e.ctrlKey || !(e.target instanceof Element) || e.target.closest(OVERLAY)) return;
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
  const dx = e.deltaX * scale;
  const dy = e.deltaY * scale;
  const axis: Axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
  const delta = axis === "y" ? dy : dx;
  if (!delta) return;
  for (let node: Element | null = e.target; node && node !== document.body; node = node.parentElement) {
    if (!(node instanceof HTMLElement) || !canScroll(node, axis, delta)) continue;
    e.preventDefault();
    // A mouse wheel's notch (a large, whole step) glides; a trackpad's
    // stream of small steps, already smooth, applies at once.
    if (e.deltaMode !== 0 || Math.abs(delta) >= 60) {
      const g = gliding.get(node) ?? { x: 0, y: 0 };
      g[axis] += delta;
      gliding.set(node, g);
    } else if (axis === "y") node.scrollTop += delta;
    else node.scrollLeft += delta;
    return;
  }
  // Nothing left to scroll: no elastic bounce of the whole page, which the
  // glass can't follow. (Sideways stays native, for swiping back and forth.)
  if (axis === "y") e.preventDefault();
}

/** Moves gliding scrolls on by a frame; called before the glass reads positions. */
export function stepScroll() {
  for (const [el, g] of gliding) {
    const sx = Math.abs(g.x) < 1 ? g.x : g.x * 0.3;
    const sy = Math.abs(g.y) < 1 ? g.y : g.y * 0.3;
    el.scrollLeft += sx;
    el.scrollTop += sy;
    g.x -= sx;
    g.y -= sy;
    if (!g.x && !g.y) gliding.delete(el);
  }
}

/** Takes over wheel scrolling until the returned function is called. */
export function syncScrolling() {
  document.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    document.removeEventListener("wheel", onWheel, { capture: true });
    gliding.clear();
  };
}

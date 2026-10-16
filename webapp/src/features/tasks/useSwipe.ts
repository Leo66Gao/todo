"use client";

import { useRef, useState } from "react";
import { animate, useMotionValue } from "motion/react";
import { haptic } from "@/lib/native";
import { springs } from "@/ui/motion";

const THRESHOLD = 72;
const LOCK = 10;
/** A touch held still this long is a long press (a drag or the editor), never a swipe (ms). */
const HOLD = 240;

/**
 * Horizontal swipe on touch screens: right past the threshold runs `onRight`,
 * left runs `onLeft`. Vertical movement is left to scrolling (the row sets
 * `touch-action: pan-y`). A long press belongs to dragging: a touch that
 * rests before it moves never swipes, and `cancel` stops one when a drag
 * starts, so moving a task to another day can't also complete or delete it.
 * A quick flick counts as well as a long swipe. A delete carries the row on
 * off the side at the finger's speed before it goes; anything else springs
 * back the same way.
 */
export function useSwipe(onRight: () => void, onLeft: () => void) {
  const x = useMotionValue(0);
  const start = useRef<{ x: number; y: number; at: number; axis: "x" | "y" | "none" | null } | null>(null);
  /** The finger's last few positions, for its speed when it lets go. */
  const trail = useRef<{ x: number; t: number }[]>([]);
  const swiped = useRef(false);
  const [armed, setArmed] = useState<"left" | "right" | null>(null);

  /** The finger's sideways speed (px/s) over its last 100 ms. */
  const speed = () => {
    const points = trail.current;
    if (points.length < 2) return 0;
    const a = points[0];
    const b = points[points.length - 1];
    return ((b.x - a.x) / Math.max(1, b.t - a.t)) * 1000;
  };

  const reset = (velocity = 0) => {
    start.current = null;
    trail.current = [];
    setArmed(null);
    void animate(x, 0, { ...springs.snappy, velocity });
  };

  const handlers = {
    onTouchStart(e: React.TouchEvent) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, at: e.timeStamp, axis: null };
      trail.current = [];
      swiped.current = false;
    },
    onTouchMove(e: React.TouchEvent) {
      const s = start.current;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.axis) {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
        s.axis = e.timeStamp - s.at > HOLD ? "none" : Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
      }
      if (s.axis !== "x") return;
      swiped.current = true;
      const now = performance.now();
      trail.current = [...trail.current.filter((p) => now - p.t < 100), { x: t.clientX, t: now }];
      // Rubber-band past the threshold so the row never flies off.
      const over = Math.max(0, Math.abs(dx) - THRESHOLD);
      const shown = Math.sign(dx) * (Math.min(Math.abs(dx), THRESHOLD) + over * 0.35);
      x.set(shown);
      const next = dx >= THRESHOLD ? "right" : dx <= -THRESHOLD ? "left" : null;
      // A tick as the action arms, so it's felt before letting go.
      if (next && next !== armed) haptic();
      setArmed(next);
    },
    onTouchEnd(e: React.TouchEvent) {
      const swiping = start.current?.axis === "x";
      const v = speed();
      // A flick past a short way counts too.
      const shown = x.get();
      const flick = Math.abs(shown) > 36 && Math.abs(v) > 700 ? (v > 0 ? "right" : "left") : null;
      const fire = swiping ? (armed ?? flick) : null;
      if (fire === "left") {
        // Off the side at the finger's speed, then gone.
        start.current = null;
        trail.current = [];
        setArmed(null);
        haptic("medium");
        const width = (e.currentTarget as HTMLElement).offsetWidth;
        void animate(x, -width, { ...springs.panel, velocity: Math.min(v, -600) }).then(onLeft);
        return;
      }
      reset(swiping ? v : 0);
      if (fire === "right") onRight();
    },
    onTouchCancel: () => reset(),
  };

  /** True once, right after a swipe, so the tap that ends it is ignored. */
  const consumeSwipe = () => {
    const was = swiped.current;
    swiped.current = false;
    return was;
  };

  /** Drops a swipe in progress (a drag took the touch over). */
  const cancel = () => {
    if (!start.current) return;
    start.current.axis = "none";
    setArmed(null);
    void animate(x, 0, springs.snappy);
  };

  return { x, armed, handlers, consumeSwipe, cancel };
}

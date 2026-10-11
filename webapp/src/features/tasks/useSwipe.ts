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
 */
export function useSwipe(onRight: () => void, onLeft: () => void) {
  const x = useMotionValue(0);
  const start = useRef<{ x: number; y: number; at: number; axis: "x" | "y" | "none" | null } | null>(null);
  const swiped = useRef(false);
  const [armed, setArmed] = useState<"left" | "right" | null>(null);

  const reset = () => {
    start.current = null;
    setArmed(null);
    void animate(x, 0, springs.snappy);
  };

  const handlers = {
    onTouchStart(e: React.TouchEvent) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, at: e.timeStamp, axis: null };
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
      // Rubber-band past the threshold so the row never flies off.
      const over = Math.max(0, Math.abs(dx) - THRESHOLD);
      const shown = Math.sign(dx) * (Math.min(Math.abs(dx), THRESHOLD) + over * 0.35);
      x.set(shown);
      const next = dx >= THRESHOLD ? "right" : dx <= -THRESHOLD ? "left" : null;
      // A tick as the action arms, so it's felt before letting go.
      if (next && next !== armed) haptic();
      setArmed(next);
    },
    onTouchEnd() {
      const fire = start.current?.axis === "x" ? armed : null;
      reset();
      if (fire === "right") onRight();
      if (fire === "left") onLeft();
    },
    onTouchCancel: reset,
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

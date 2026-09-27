import type { Transition } from "motion/react";

/**
 * Motion vocabulary. Everything the user causes answers with a spring —
 * quick to start, settling without a visible bounce.
 */
export const springs = {
  /** Small controls: thumbs, checkmarks, selection pills. */
  snappy: { type: "spring", stiffness: 620, damping: 42, mass: 0.7 } satisfies Transition,
  /** The selected tab's bubble gliding between tabs: a little give at the end. */
  pill: { type: "spring", stiffness: 480, damping: 30, mass: 0.8 } satisfies Transition,
  /** A finger pressing down. */
  press: { type: "spring", stiffness: 900, damping: 40, mass: 0.5 } satisfies Transition,
  /** Rows moving, lists reflowing. */
  layout: { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } satisfies Transition,
  /** Panels and sheets. */
  panel: { type: "spring", stiffness: 360, damping: 36, mass: 1 } satisfies Transition,
  /** Modals: a touch softer on arrival. */
  modal: { type: "spring", stiffness: 440, damping: 34, mass: 0.9 } satisfies Transition,
} as const;

export const fade = { duration: 0.14, ease: [0.2, 0.9, 0.25, 1] } satisfies Transition;

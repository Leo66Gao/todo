"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/ui/cn";
import { haptic } from "@/lib/native";

/**
 * The completion box. Its outline carries the task's priority colour (as in
 * the original app); checking fills it with ink and draws the tick.
 */
export function TaskCheck({
  checked,
  color,
  onToggle,
  size = 18,
  round = true,
  className,
}: {
  checked: boolean;
  color?: string;
  onToggle: () => void;
  size?: number;
  /** A circle, for things to get done; square for picking from a list. */
  round?: boolean;
  className?: string;
}) {
  // Only animate changes the user makes, not the first paint of a list.
  const [animateIn, setAnimateIn] = useState(false);

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Mark as not done" : "Mark as done"}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        setAnimateIn(true);
        if (!checked) haptic();
        onToggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn("group/check relative flex shrink-0 items-center justify-center", className)}
      style={{ width: size + 8, height: size + 8 }}
    >
      <motion.span
        className={cn("absolute border-[1.5px]", round ? "rounded-full" : "rounded-[5px]")}
        style={{ width: size, height: size }}
        initial={false}
        animate={{
          backgroundColor: checked ? "var(--ink)" : "rgba(0,0,0,0)",
          borderColor: checked ? "var(--ink)" : (color ?? "var(--ink-4)"),
          scale: checked && animateIn ? [1, 0.84, 1] : 1,
        }}
        transition={{
          backgroundColor: { duration: 0.12 },
          borderColor: { duration: 0.12 },
          scale: { duration: 0.3, ease: [0.3, 0.8, 0.3, 1] },
        }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.88 }}
      />
      <svg viewBox="0 0 16 16" className="pointer-events-none relative" style={{ width: size - 5, height: size - 5 }}>
        <motion.path
          key={checked ? "on" : "off"}
          d="M3.5 8.4l3 3 6-6.6"
          fill="none"
          strokeWidth={2.1}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={
            checked
              ? "stroke-on-ink"
              : "stroke-ink-3 opacity-0 transition-opacity duration-150 group-hover/check:opacity-50"
          }
          initial={{ pathLength: checked && animateIn ? 0 : 1 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.24, delay: 0.05, ease: [0.3, 0.8, 0.3, 1] }}
        />
      </svg>
    </button>
  );
}

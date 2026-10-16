"use client";

import { forwardRef, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "motion/react";
import { Slider as RSlider, Switch as RSwitch } from "radix-ui";
import { cn } from "./cn";
import { springs } from "./motion";
import { useGlass, useMergedRefs } from "@/glass/registry";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-on-ink hover:bg-ink/88 pointer-fine:active:bg-ink/80",
  secondary: "bg-fill text-ink hover:bg-fill-strong pointer-fine:active:bg-line-strong",
  ghost: "text-ink-2 hover:bg-fill hover:text-ink pointer-fine:active:bg-fill-strong",
  danger: "bg-danger text-white hover:bg-danger/90 pointer-fine:active:bg-danger/85",
  accent: "bg-accent-soft text-accent hover:bg-accent/15 pointer-fine:active:bg-accent/20",
};

const sizes: Record<Size, string> = {
  // (A little taller on phones, for a finger.)
  sm: "h-[26px] px-2.5 text-xs gap-1.5 rounded-[calc(var(--radius-ctl)_-_1px)] max-md:h-9 max-md:px-3.5 max-md:text-[13px]",
  md: "h-[30px] px-3 text-sm gap-1.5 rounded-ctl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...rest },
  ref,
) {
  // In the Liquid Glass theme primary actions are ink-tinted glass, and
  // secondary ones a raised plate of glass.
  const glassRef = useGlass<HTMLButtonElement>({ level: 2, kind: "ink", interactive: true, inScroll: true });
  const plateRef = useGlass<HTMLButtonElement>({ level: 2, kind: "plate", interactive: true, inScroll: true });
  const glass = rest.disabled ? undefined : variant === "primary" ? glassRef : variant === "secondary" ? plateRef : undefined;
  const refs = useMergedRefs(ref, glass);
  return (
    <button
      ref={refs}
      type={type}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap",
        "transition-[background-color,color,transform,opacity] duration-150 pointer-fine:active:scale-[0.97]",
        "disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: "sm" | "md"; active?: boolean }
>(function IconButton({ label, size = "md", active, className, children, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-ctl text-ink-3",
        // (Pressed with a mouse it sinks and darkens; a touch gets the shared
        // press feedback instead: a grey disc flashing over glass looked off.)
        "transition-[background-color,color,transform] duration-150 hover:bg-fill hover:text-ink pointer-fine:active:scale-[0.94] pointer-fine:active:bg-fill-strong",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-fill text-ink",
        size === "sm" ? "size-6" : "size-[30px]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "hover-only inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1",
        "border border-line-strong/70 bg-card font-sans text-[10.5px] font-medium text-ink-3",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * Segmented control with a sliding thumb. As on Apple's, pressing lifts the
 * thumb (it swells past the track) and it follows the pointer from option to
 * option; letting go picks the one under it.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  const thumbGlass = useGlass<HTMLSpanElement>({ level: 2, kind: "control", inScroll: true });
  // The track is a plate of glass the thumb slides on.
  const trackGlass = useGlass<HTMLDivElement>({ level: 2, kind: "plate", inScroll: true });
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  // The option under a pressed pointer (the thumb sits there, lifted).
  const [held, setHeld] = useState<T | null>(null);
  const optionAt = (x: number) => {
    let best: T | null = null;
    let distance = Infinity;
    for (const [v, el] of buttons.current) {
      const r = el.getBoundingClientRect();
      const d = Math.abs(x - (r.left + r.width / 2));
      if (d < distance) {
        distance = d;
        best = v;
      }
    }
    return best;
  };
  const shown = held ?? value;
  return (
    <div
      ref={trackGlass}
      role="radiogroup"
      // (Sliding along it picks an option; it mustn't pull the menu drawer.)
      data-hswipe
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setHeld(optionAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (held != null) setHeld(optionAt(e.clientX));
      }}
      onPointerUp={() => {
        if (held != null && held !== value) onChange(held);
        setHeld(null);
      }}
      onPointerCancel={() => setHeld(null)}
      className={cn(
        "relative inline-flex touch-pan-y rounded-[calc(var(--radius-ctl)_+_1px)] bg-fill p-[2px]",
        size === "sm" ? "h-[26px]" : "h-[30px]",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === shown;
        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) buttons.current.set(option.value, el);
              else buttons.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            // Pointer presses are handled by the track; this is for the keyboard.
            onClick={(e) => {
              if (e.detail === 0) onChange(option.value);
            }}
            className={cn(
              "relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[calc(var(--radius-ctl)_-_1px)] px-3 font-medium whitespace-nowrap max-sm:gap-1 max-sm:px-2",
              "transition-colors duration-150",
              size === "sm" ? "text-xs" : "text-sm",
              selected ? "text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {selected && (
              <motion.span
                ref={thumbGlass}
                layoutId={`seg-${id}`}
                transition={springs.snappy}
                // Lifted, the thumb swells past the track like a drop of glass.
                animate={{ scaleX: held != null ? 1.08 : 1, scaleY: held != null ? 1.34 : 1 }}
                className="absolute inset-0 rounded-[calc(var(--radius-ctl)_-_1px)] bg-raised shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_1px_3px_rgb(0_0_0/0.1)] dark:bg-fill-strong"
              />
            )}
            <span className="relative flex items-center gap-1.5">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className={cn(
        "relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors duration-200",
        checked ? "bg-ink" : "bg-fill-strong",
      )}
    >
      <RSwitch.Thumb
        className={cn(
          "block size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-[var(--ease-out)]",
          checked ? "translate-x-[14px]" : "translate-x-[2px]",
        )}
      />
    </RSwitch.Root>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  dormant,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Rendered muted until the user first touches it. */
  dormant?: boolean;
  label: string;
}) {
  const ticks = Math.round((max - min) / step);
  return (
    <RSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v)}
      aria-label={label}
      // Its own sideways drag: page swipes (like the menu's) leave it alone.
      data-hswipe
      className="group relative flex h-5 w-full touch-none select-none items-center max-md:h-9"
    >
      <RSlider.Track className="relative h-[3px] grow overflow-hidden rounded-full bg-fill-strong">
        <RSlider.Range className={cn("absolute h-full rounded-full", dormant ? "bg-transparent" : "bg-ink")} />
      </RSlider.Track>
      {ticks <= 12 && (
        <div className="pointer-events-none absolute inset-x-[7px] flex justify-between">
          {Array.from({ length: ticks + 1 }, (_, i) => (
            <span key={i} className="h-[3px] w-px bg-canvas/80" />
          ))}
        </div>
      )}
      <RSlider.Thumb
        className={cn(
          "block size-[14px] rounded-full border shadow-[0_1px_3px_rgb(0_0_0/0.2)] outline-none",
          "transition-[transform,background-color] duration-150 hover:scale-110 pointer-fine:active:scale-95",
          "focus-visible:ring-2 focus-visible:ring-accent-line",
          dormant ? "border-line-strong bg-raised" : "border-transparent bg-ink",
        )}
      />
    </RSlider.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-[1.5px] border-ink-4 border-t-ink-2",
        className,
      )}
    />
  );
}

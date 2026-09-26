"use client";

import { useCallback, useMemo, type Ref, type RefCallback } from "react";

/**
 * Glass surfaces the WebGL layer draws behind the DOM. Each registered element
 * becomes transparent in the Liquid Glass theme and the renderer paints the
 * glass exactly under it, following its live position every frame.
 *
 * Level 1 sits on the background (sidebar, content panel, tab bar). Level 2
 * sits on a level-1 surface (selection pills, primary buttons, task cards) and
 * refracts that surface. Overlays are left to CSS: the renderer is behind the
 * page, so it can't draw over DOM content. Scrolled content moves on the
 * compositor ahead of the next frame, so shapes in a list (`inScroll`) hand
 * over to a CSS look while their list is scrolling.
 */
export type GlassKind =
  /** The large reading surface behind task content: frosted and well tinted. */
  | "slab"
  /** Navigation chrome: sidebar, inspector, tab bar. Clearer than a slab. */
  | "chrome"
  /** Clear lens-like controls: selection pills, segmented thumbs. */
  | "control"
  /** Ink-tinted glass for primary actions and the selected day. */
  | "ink"
  /** A recessed well, e.g. the search field. */
  | "well"
  /** A thin plate under a task in a scrolling list. */
  | "card";

export interface GlassSpec {
  level: 1 | 2;
  kind: GlassKind;
  /** Corner radius in CSS px; "pill" is half the short side. Read from CSS when omitted. */
  radius?: number | "pill";
  /** Hover and press respond with light and a slight squeeze. */
  interactive?: boolean;
  /** Allow inside a scroll area that rarely scrolls (e.g. the sidebar list). */
  inScroll?: boolean;
}

/** Space between glass panels in the Liquid Glass theme (CSS px). */
export const GLASS_GAP = 10;

export interface GlassEntry {
  el: HTMLElement;
  spec: GlassSpec;
  /** Level-1 ancestor that clips a level-2 shape (e.g. a collapsing sidebar). */
  clip: HTMLElement | null;
  /** Nearest scrolling ancestor of a shape in a list (null: none; undefined: not looked up). */
  scroller?: HTMLElement | null;
  radiusPx: number | null;
  born: number;
}

export const glassEntries = new Map<HTMLElement, GlassEntry>();
let generation = 0;
export const registryGeneration = () => generation;

const OVERLAY = '[data-overlay], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

export function registerGlass(el: HTMLElement, spec: GlassSpec): () => void {
  if (el.closest(OVERLAY) || (spec.level === 2 && !spec.inScroll && el.closest(".scroll-area"))) return () => {};
  el.dataset.glass = String(spec.level);
  el.dataset.glassKind = spec.kind;
  glassEntries.set(el, { el, spec, clip: null, radiusPx: null, born: performance.now() });
  generation++;
  return () => {
    glassEntries.delete(el);
    delete el.dataset.glass;
    delete el.dataset.glassKind;
    generation++;
  };
}

// Scroll activity per scrolling element, so list shapes can step aside while it moves.
const scrolledAt = new WeakMap<Element, number>();
const settle = new WeakMap<Element, number>();
/** How long after the last scroll event a list counts as still moving (ms). */
export const SCROLL_SETTLE = 140;

export function noteScroll(el: Element) {
  scrolledAt.set(el, performance.now());
  el.classList.add("glass-scrolling");
  clearTimeout(settle.get(el));
  settle.set(
    el,
    window.setTimeout(() => el.classList.remove("glass-scrolling"), SCROLL_SETTLE),
  );
}

export const isScrolling = (el: Element) => performance.now() - (scrolledAt.get(el) ?? -1e9) < SCROLL_SETTLE;

/** Ref callback that registers the element as a glass surface while mounted. */
export function useGlass<T extends HTMLElement>(spec: GlassSpec) {
  const { level, kind, radius, interactive, inScroll } = spec;
  return useCallback(
    (el: T | null) => {
      if (!el) return;
      return registerGlass(el, { level, kind, radius, interactive, inScroll });
    },
    [level, kind, radius, interactive, inScroll],
  );
}

/** Combines refs (including React 19 cleanup-returning callbacks) into one. */
export function useMergedRefs<T>(a: Ref<T> | undefined, b: Ref<T> | undefined): RefCallback<T> {
  return useMemo(() => mergeRefs(a, b), [a, b]);
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (value: T | null) => {
    const cleanups: Array<() => void> = [];
    for (const ref of refs) {
      if (typeof ref === "function") {
        const cleanup = ref(value);
        cleanups.push(typeof cleanup === "function" ? cleanup : () => ref(null));
      } else if (ref) {
        (ref as { current: T | null }).current = value;
        cleanups.push(() => {
          (ref as { current: T | null }).current = null;
        });
      }
    }
    return () => cleanups.forEach((c) => c());
  };
}

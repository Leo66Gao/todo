"use client";

import { useSyncExternalStore } from "react";

/** Live result of a CSS media query (false during server rendering). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const PHONE = "(max-width: 639px)";

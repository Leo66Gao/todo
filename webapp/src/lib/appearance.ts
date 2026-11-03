"use client";

import { create } from "zustand";
import type { ThemeMode } from "@/lib/model";
import { getLocal, setLocal } from "@/lib/prefs";

// Appearance belongs to this browser. The synced workspace still understands
// its legacy themeMode field for older clients, but the web UI ignores it.
export type Corners = "standard" | "round";

export const useAppearance = create<{ themeMode: ThemeMode; corners: Corners }>(() => ({ themeMode: "system", corners: "standard" }));

export function restoreAppearance() {
  const saved = getLocal<unknown>("theme", "system");
  useAppearance.setState({
    themeMode: saved === "light" || saved === "dark" ? saved : "system",
    corners: getLocal<unknown>("corners", "standard") === "round" ? "round" : "standard",
  });
}

export function setThemeMode(themeMode: ThemeMode) {
  if (useAppearance.getState().themeMode === themeMode) return;
  useAppearance.setState({ themeMode });
  setLocal("theme", themeMode);
}

/** Round: buttons, fields, menus and small controls become capsules (big boxes keep their corners). */
export function setCorners(corners: Corners) {
  if (useAppearance.getState().corners === corners) return;
  useAppearance.setState({ corners });
  setLocal("corners", corners);
}

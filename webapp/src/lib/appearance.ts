"use client";

import { create } from "zustand";
import type { ThemeMode } from "@/lib/model";
import { getLocal, setLocal } from "@/lib/prefs";

// Appearance belongs to this browser. The synced workspace still understands
// its legacy themeMode field for older clients, but the web UI ignores it.
export const useAppearance = create<{ themeMode: ThemeMode }>(() => ({ themeMode: "system" }));

export function restoreAppearance() {
  const saved = getLocal<unknown>("theme", "system");
  useAppearance.setState({ themeMode: saved === "light" || saved === "dark" ? saved : "system" });
}

export function setThemeMode(themeMode: ThemeMode) {
  if (useAppearance.getState().themeMode === themeMode) return;
  useAppearance.setState({ themeMode });
  setLocal("theme", themeMode);
}

"use client";

// Working without a connection. Data is always saved on the device first
// (see cloudSync.ts); on the web, a service worker also keeps the app itself,
// so it opens offline. The Android app ships its files and needs neither.

import { toast } from "@/ui/toast";
import { isNative } from "./native";

let started = false;

export function startOffline() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (process.env.NODE_ENV === "production" && !isNative() && "serviceWorker" in navigator) {
    // After load, so installing never competes with the first paint.
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }
  window.addEventListener("offline", () => toast("You’re offline. Changes will sync later."));
}

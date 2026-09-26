"use client";

// The Android app (Capacitor) runs this same web app in a native shell. This
// module is the only place that knows: sign-in, Google API tokens, the system
// bars, the back button and haptics go through native code there, and fall
// back to the web (or to nothing) in a browser.

import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from "@capacitor/core";

export const isNative = () => Capacitor.isNativePlatform();

interface GoogleAuthorizationPlugin {
  authorize(options: { scopes: string[]; email?: string | null; interactive?: boolean }): Promise<{ accessToken?: string }>;
}

/** Google API access tokens from Android (see GoogleAuthorizationPlugin.java). */
export const GoogleAuthorization = registerPlugin<GoogleAuthorizationPlugin>("GoogleAuthorization");

/** Native Google sign-in; returns the ID token for Firebase's web SDK. */
export async function nativeGoogleSignIn(): Promise<string | null> {
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  const result = await FirebaseAuthentication.signInWithGoogle();
  return result.credential?.idToken ?? null;
}

export async function nativeSignOut() {
  if (!isNative()) return;
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  await FirebaseAuthentication.signOut().catch(() => {});
}

/** A light tap of feedback (task done, sheet snaps). No-op in a browser. */
export function haptic(kind: "light" | "medium" | "success" = "light") {
  if (!isNative()) return;
  void import("@capacitor/haptics").then(({ Haptics, ImpactStyle, NotificationType }) =>
    kind === "success"
      ? Haptics.notification({ type: NotificationType.Success })
      : Haptics.impact({ style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light }),
  );
}

interface AppChromePlugin {
  setBackground(options: { color: string }): Promise<void>;
}
const AppChrome = registerPlugin<AppChromePlugin>("AppChrome");

let chrome = "";
/**
 * Matches the system bars to what's at the top of the app: icon colour for
 * contrast, and (for older WebViews, which inset the page) the strip colour.
 */
function applyChrome(color: string, lightContent: boolean) {
  const key = `${color}/${lightContent}`;
  if (!isNative() || chrome === key) return;
  chrome = key;
  void SystemBars.setStyle({ style: lightContent ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  void AppChrome.setBackground({ color }).catch(() => {});
}

/** What's under the status bar in Liquid Glass (set by the renderer). */
let glassTop: [number, number, number] | null = null;
export function reportGlassTop(rgb: [number, number, number]) {
  glassTop = rgb;
  syncChrome();
}

const hex = (rgb: [number, number, number]) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

function syncChrome() {
  const root = document.documentElement;
  const glass = root.classList.contains("glass") && !root.classList.contains("glass-css");
  if (glass && glassTop) {
    const [r, g, b] = glassTop;
    applyChrome(hex(glassTop), (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55);
  } else {
    const dark = root.classList.contains("dark");
    applyChrome(dark ? "#161618" : "#ffffff", dark);
  }
}

let started = false;
/** Wires the native shell once: system bars, back button, splash screen. */
export async function startNative() {
  if (started || !isNative()) return;
  started = true;
  const root = document.documentElement;
  root.classList.add("native");
  syncChrome();
  new MutationObserver(syncChrome).observe(root, { attributes: true, attributeFilter: ["class"] });

  const { App } = await import("@capacitor/app");
  // Back closes the top overlay first (Escape does that everywhere in the
  // app), then goes back through the app's pages, then leaves the app.
  await App.addListener("backButton", ({ canGoBack }) => {
    const overlay = document.querySelector('[role="dialog"], [role="menu"], [data-overlay]');
    if (overlay) {
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } else if (canGoBack && history.length > 1) {
      history.back();
    } else {
      void App.minimizeApp();
    }
  });

  const { SplashScreen } = await import("@capacitor/splash-screen");
  // After the first frame, so the app appears fully drawn.
  requestAnimationFrame(() => requestAnimationFrame(() => void SplashScreen.hide({ fadeOutDuration: 180 })));
}

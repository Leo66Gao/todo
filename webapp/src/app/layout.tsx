import type { Metadata, Viewport } from "next";
import { Figtree, Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "quill/dist/quill.core.css";
import "./globals.css";
import "@/glass/glass.css";
import { Shell } from "@/shell/Shell";
import { ErrorBoundary } from "@/shell/ErrorBoundary";

// Geist for the interface: a crisp neo-grotesque that stays precise at small
// sizes. Page titles keep Figtree, the app's original geometric face. Geist
// Mono sets the phone's small print (dates and the line over a title).
const ui = Geist({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const title = Figtree({ subsets: ["latin"], variable: "--font-title", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-numeric", display: "swap" });

export const metadata: Metadata = {
  title: "Todo",
  description: "Tasks, assignments, subjects and notes — synced with the Todo phone app.",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  // Added to the home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: "Todo", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
  // Content runs under the notch and home indicator; safe-area insets pad it.
  viewportFit: "cover",
};

// In the Android app, the launch screen gives way to the page's own spinner
// at its first frame, so it shows while the app itself loads (the app hides
// the launch screen too, in case this runs before the native bridge is ready).
const splashBoot = `try{var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform()&&C.nativePromise){requestAnimationFrame(function(){requestAnimationFrame(function(){C.nativePromise("SplashScreen","hide",{fadeOutDuration:120}).catch(function(){})})})}}catch(e){}`;

// Applies the saved appearance (and Liquid Glass, which phones don't use)
// before first paint so it never flashes.
const themeBoot = `try{var m=JSON.parse(localStorage.getItem("todo.web.theme")||'"system"');var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);var g=JSON.parse(localStorage.getItem("todo.web.glass")||"{}");var c=window.Capacitor,ph=(c&&c.isNativePlatform&&c.isNativePlatform())||matchMedia("(max-width: 767px)").matches;if(g.enabled&&!ph){document.documentElement.classList.add("glass","glass-bg-"+(g.background||"harbour"))}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${title.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <script dangerouslySetInnerHTML={{ __html: splashBoot }} />
      </head>
      <body>
        <ErrorBoundary whole>
          <Suspense>
            <Shell />
          </Suspense>
        </ErrorBoundary>
        {children}
      </body>
    </html>
  );
}

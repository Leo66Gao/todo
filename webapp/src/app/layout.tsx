import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "quill/dist/quill.core.css";
import "./globals.css";
import "@/glass/glass.css";
import { Shell } from "@/shell/Shell";

// One typeface throughout: Inter, with its optical sizes, so large titles
// tighten and small labels open up the way a system font does.
const ui = Inter({ subsets: ["latin"], axes: ["opsz"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = {
  title: "Todo",
  description: "Tasks, assignments, subjects and notes — synced with the Todo phone app.",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
  // Added to the home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: "Todo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8e8e4" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
  // Content runs under the notch and home indicator; safe-area insets pad it.
  viewportFit: "cover",
};

// Applies the saved appearance (and Liquid Glass, which phones don't use)
// before first paint so it never flashes.
const themeBoot = `try{var m=JSON.parse(localStorage.getItem("todo.web.theme")||'"system"');var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);var g=JSON.parse(localStorage.getItem("todo.web.glass")||"{}");var c=window.Capacitor,ph=(c&&c.isNativePlatform&&c.isNativePlatform())||matchMedia("(max-width: 767px)").matches;if(g.enabled&&!ph){document.documentElement.classList.add("glass","glass-bg-"+(g.background||"harbour"))}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={ui.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <Suspense>
          <Shell />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

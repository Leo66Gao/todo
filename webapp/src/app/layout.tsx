import type { Metadata, Viewport } from "next";
import { Figtree, Geist } from "next/font/google";
import { Suspense } from "react";
import "quill/dist/quill.core.css";
import "./globals.css";
import "@/glass/glass.css";
import { Shell } from "@/shell/Shell";

// Geist for the interface: a crisp neo-grotesque that stays precise at small
// sizes. Page titles keep Figtree, the app's original geometric face.
const ui = Geist({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const title = Figtree({ subsets: ["latin"], variable: "--font-title", display: "swap" });

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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#161618" },
  ],
  // Content runs under the notch and home indicator; safe-area insets pad it.
  viewportFit: "cover",
};

// Applies the saved appearance (and Liquid Glass) before first paint so it never flashes.
const themeBoot = `try{var m=JSON.parse(localStorage.getItem("todo.web.theme")||'"system"');var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);var g=JSON.parse(localStorage.getItem("todo.web.glass")||"{}");if(g.enabled){document.documentElement.classList.add("glass","glass-bg-"+(g.background||"harbour"));if(g.radius)document.documentElement.style.setProperty("--glass-radius",g.radius+"px")}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${title.variable}`} suppressHydrationWarning>
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

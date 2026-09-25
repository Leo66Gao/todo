import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { Suspense } from "react";
import "quill/dist/quill.core.css";
import "./globals.css";
import { Shell } from "@/shell/Shell";

// Figtree: a clean geometric grotesque — close in spirit to the Poppins the
// app started with, but tuned for dense UI text.
const ui = Figtree({ subsets: ["latin"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = {
  title: "Todo",
  description: "Tasks, assignments, subjects and notes — synced with the Todo phone app.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b1e" },
  ],
};

// Applies the saved appearance before first paint so dark mode never flashes.
const themeBoot = `try{var m=JSON.parse(localStorage.getItem("todo.web.theme")||'"system"');var d=m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}`;

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

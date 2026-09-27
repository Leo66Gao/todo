"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Share, SquarePlus, X } from "lucide-react";
import { isNative } from "@/lib/native";
import { getLocal, setLocal } from "@/lib/prefs";
import { springs } from "@/ui/motion";

const KEY = "todo.web.installHint";

type Kind = "ios" | "prompt";
type PromptEvent = Event & { prompt: () => Promise<void> };

/**
 * On a phone's browser, a one-time card that explains how to put Todo on the
 * home screen, where it opens full screen and works offline. iPhones have no
 * install prompt, so it shows Safari's steps; Android Chrome gets a button.
 */
export function InstallHint() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);

  useEffect(() => {
    if (isNative() || getLocal(KEY, false)) return;
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (standalone || !matchMedia("(max-width: 767px)").matches) return;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as PromptEvent);
      setKind("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Not on the very first seconds of a first visit.
    const timer = ios ? window.setTimeout(() => setKind("ios"), 2500) : 0;
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.clearTimeout(timer);
    };
  }, []);

  const close = () => {
    setLocal(KEY, true);
    setKind(null);
  };

  return (
    <AnimatePresence>
      {kind && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.97 }}
          transition={springs.modal}
          className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-50 flex items-start gap-3 rounded-[22px] border border-line bg-card p-4 shadow-modal md:hidden"
        >
          <svg viewBox="0 0 64 64" aria-hidden className="size-11 shrink-0">
            <rect width="64" height="64" rx="15" fill="#1d1d20" />
            <path d="M20 33.5l8 8 16-18" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Install Todo</div>
            {kind === "ios" ? (
              <p className="mt-0.5 text-[13px] leading-snug text-ink-3">
                Tap <Share className="inline size-[15px] -translate-y-px text-accent" /> Share, then{" "}
                <SquarePlus className="inline size-[15px] -translate-y-px" /> Add to Home Screen. It opens full screen and works offline.
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-3">Add it to your home screen. It opens full screen and works offline.</p>
                <button
                  type="button"
                  className="mt-2.5 h-9 rounded-full bg-ink px-4 text-[13px] font-semibold text-on-ink"
                  onClick={() => {
                    void prompt?.prompt();
                    close();
                  }}
                >
                  Install
                </button>
              </>
            )}
          </div>
          <button type="button" aria-label="Close" onClick={close} className="-m-1 flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3">
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

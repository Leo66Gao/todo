"use client";

import { AnimatePresence, motion } from "motion/react";
import { create } from "zustand";
import { springs } from "./motion";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let nextId = 1;

export function toast(message: string, action?: { label: string; run: () => void }) {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }));
  setTimeout(() => dismiss(id), action ? 5000 : 3000);
}

function dismiss(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function ToastHost() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[80] flex flex-col items-center gap-2 max-md:bottom-[calc(54px+env(safe-area-inset-bottom)+84px)]"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.14 } }}
            transition={springs.panel}
            className="pointer-events-auto flex h-10 items-center gap-3 rounded-[11px] bg-ink pr-1.5 pl-4 text-sm text-on-ink shadow-lift"
          >
            <span className="max-w-[340px] truncate">{t.message}</span>
            {t.action ? (
              <button
                className="h-7 rounded-[7px] px-2.5 text-sm font-semibold text-on-ink/90 transition-colors hover:bg-on-ink/12"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : (
              <span className="w-2.5" />
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

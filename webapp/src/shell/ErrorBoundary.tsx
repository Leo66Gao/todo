"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { makeBackup } from "@/lib/backup";
import { workspaceRecords } from "@/store/workspace";

// What's left on screen when something fails to draw: a way to reload, and a
// way to save everything to a file first. Without it a single bad record or
// a missing script after an update left a blank page.

/** True for a script of this build that couldn't be loaded (usually: a newer version was deployed). */
function isChunkError(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|error loading dynamically/i.test(text);
}

const RELOADED = "todo.chunkReload";

/** Reloads once for a missing script; false if it already did lately (so it can't loop). */
function reloadForChunk() {
  try {
    const last = Number(sessionStorage.getItem(RELOADED) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOADED, String(Date.now()));
  } catch {
    // No session storage: reload anyway.
  }
  window.location.reload();
  return true;
}

let watching = false;

/** A script that fails to load outside rendering (a lazy import in a handler) reloads the app once too. */
export function startChunkRecovery() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("unhandledrejection", (e) => {
    if (isChunkError(e.reason)) reloadForChunk();
  });
}

function saveBackup() {
  try {
    const file = makeBackup(workspaceRecords());
    const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Todo backup ${file.exportedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    // Nothing more to try here.
  }
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; whole?: boolean }, { error: unknown; key?: string }> {
  state: { error: unknown; key?: string } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: unknown; key?: string }) {
    // Going to another page tries again.
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
    if (isChunkError(error)) reloadForChunk();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={this.props.whole ? "flex h-dvh items-center justify-center p-6" : "flex flex-1 items-center justify-center p-6"}>
        <div className="max-w-sm text-center">
          <div className="text-base font-semibold text-ink">This page couldn’t be shown</div>
          <p className="mt-1.5 text-sm text-ink-3">Your tasks and notes are safe. Reloading usually fixes it; you can also save a backup first.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" onClick={() => window.location.reload()} className="h-9 rounded-ctl bg-ink px-4 text-sm font-medium text-on-ink">
              Reload
            </button>
            <button type="button" onClick={saveBackup} className="h-9 rounded-ctl bg-fill px-4 text-sm font-medium text-ink">
              Save backup
            </button>
          </div>
        </div>
      </div>
    );
  }
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { ChevronLeft } from "lucide-react";
import { deltaFromContent } from "@/lib/delta";
import { deltaToHtml } from "@/lib/deltaHtml";
import type { Version } from "@/lib/versions";
import { useWorkspace } from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/controls";
import { Modal } from "@/ui/overlay";
import { PHONE, useMedia } from "@/ui/useMedia";
import { noteVersions, restoreVersion } from "./noteActions";

type Katex = typeof import("katex").default;

const when = (at: number) => {
  const date = new Date(at);
  if (isToday(date)) return `Today ${format(date, "HH.mm")}`;
  if (isYesterday(date)) return `Yesterday ${format(date, "HH.mm")}`;
  return format(date, date.getFullYear() === new Date().getFullYear() ? "EEE d MMM, HH.mm" : "d MMM yyyy, HH.mm");
};

export function VersionHistory({ noteId, open, onOpenChange }: { noteId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const side = useWorkspace((s) => s.side);
  // Re-read when the synced record changes.
  const versions = useMemo(() => noteVersions(noteId), [noteId, side]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<number | null>(null);
  const phone = useMedia(PHONE);
  const [katex, setKatex] = useState<Katex | null>(null);
  useEffect(() => {
    if (open && !katex) void import("katex").then((m) => setKatex(() => m.default));
  }, [open, katex]);

  const index = selected ?? (phone ? null : 0);
  const version = index != null ? versions[index] : undefined;
  const html = useMemo(() => {
    if (!version) return "";
    return deltaToHtml(deltaFromContent(version.content), {
      formula: (tex, display) =>
        katex ? katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" }) : null,
    });
  }, [version, katex]);

  const restore = (v: Version) => {
    restoreVersion(noteId, v);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setSelected(null);
      }}
      width={860}
      label="Version history"
      initialFocus={(e) => e.preventDefault()}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
          {phone && version ? (
            <Button variant="ghost" size="sm" className="-ml-2" icon={<ChevronLeft className="size-4" />} onClick={() => setSelected(null)}>
              Versions
            </Button>
          ) : (
            <h2 className="text-sm font-semibold">Version history</h2>
          )}
          <span className="flex-1" />
          {version && (
            <Button size="sm" variant="primary" onClick={() => restore(version)}>
              Restore
            </Button>
          )}
        </div>
        {versions.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-3">
            No earlier versions yet. While you edit, the note is kept here every ten minutes.
          </p>
        ) : (
          <div className="flex min-h-0 max-sm:flex-1 max-sm:flex-col sm:h-[min(64vh,600px)]">
            {(!phone || !version) && (
              <ul className="scroll-area shrink-0 p-1.5 sm:w-56 sm:border-r sm:border-line">
                {versions.map((v, i) => (
                  <li key={v.at}>
                    <button
                      type="button"
                      onClick={() => setSelected(i)}
                      className={cn(
                        "flex w-full flex-col rounded-ctl px-2.5 py-2 text-left transition-colors",
                        i === index ? "bg-fill-strong" : "hover:bg-fill",
                      )}
                    >
                      <span className="tnum text-sm">{when(v.at)}</span>
                      <span className="truncate text-xs text-ink-3">{v.title || "Untitled note"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {version && (
              <article className="scroll-area min-h-0 flex-1 px-6 py-5 max-sm:px-4">
                <h1 className="font-display text-lg font-semibold tracking-[-0.01em]">{version.title || "Untitled note"}</h1>
                <div className="doc-preview mt-3" dangerouslySetInnerHTML={{ __html: html }} />
              </article>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

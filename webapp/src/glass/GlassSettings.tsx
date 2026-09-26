"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ImagePlus, X } from "lucide-react";
import { cn } from "@/ui/cn";
import { springs } from "@/ui/motion";
import { toast } from "@/ui/toast";
import {
  removeBackgroundImage,
  setBackgroundImage,
  setGlassPrefs,
  useGlassPrefs,
  type BackgroundId,
  type PhotoId,
  type PresetId,
} from "./prefs";
import { PHOTOS } from "./photos";
import { imageThumbnail, renderThumbnails } from "./thumbnails";

const PRESETS: { id: PresetId | PhotoId; name: string; dark?: string }[] = [
  { id: "harbour", name: "Harbour" },
  { id: "contour", name: "Contour" },
  { id: "ember", name: "Afterglow", dark: "Ember" },
  { id: "studio", name: "Studio" },
  ...PHOTOS,
];

function useDarkClass() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Background picker: the presets (rendered with real glass) and a personal image. */
export function BackgroundPicker() {
  const background = useGlassPrefs((s) => s.background);
  const finish = useGlassPrefs((s) => s.finish);
  const image = useGlassPrefs((s) => s.image);
  const dark = useDarkClass();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Rendering the previews takes a moment; let the page paint first.
    let live = true;
    const id = requestAnimationFrame(() => {
      void renderThumbnails(PRESETS.map((p) => p.id), dark, finish).then((next) => live && setThumbs(next));
    });
    return () => {
      live = false;
      cancelAnimationFrame(id);
    };
  }, [dark, finish]);

  const imageThumb = useMemo(() => (image ? imageThumbnail(image) : null), [image]);

  const choose = (id: BackgroundId) => setGlassPrefs({ background: id });
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await setBackgroundImage(file);
    } catch {
      toast("That image couldn’t be opened. Try a JPEG, PNG or HEIC photo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="px-4 pt-1 pb-4">
    <div className="grid grid-cols-5 gap-2.5 max-sm:grid-cols-3">
      {PRESETS.map((p) => (
        <Tile
          key={p.id}
          label={dark && p.dark ? p.dark : p.name}
          selected={background === p.id}
          onClick={() => choose(p.id)}
          src={thumbs[p.id]}
        />
      ))}
      <div className="relative">
        {imageThumb ? (
          <>
            <Tile label="Your image" selected={background === "image"} onClick={() => choose("image")} src={imageThumb} />
            <button
              type="button"
              aria-label="Remove your image"
              onClick={() => void removeBackgroundImage()}
              className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-transform active:scale-90"
            >
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="group flex w-full flex-col items-stretch gap-1.5 text-left"
          >
            <span className="flex aspect-[3/2] items-center justify-center rounded-[10px] border border-dashed border-line-strong text-ink-3 transition-colors group-hover:border-ink-4 group-hover:text-ink-2">
              <ImagePlus className="size-5" />
            </span>
            <span className="px-0.5 text-xs text-ink-2">{busy ? "Adding…" : "Your image"}</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
    </div>
    {imageThumb && (
      <p className="mt-3 text-xs text-ink-3">
        Your image stays on this device.{" "}
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="text-ink-2 underline-offset-2 hover:underline">
          {busy ? "Adding…" : "Replace image"}
        </button>
      </p>
    )}
    </div>
  );
}

function Tile({ label, selected, onClick, src }: { label: string; selected: boolean; onClick: () => void; src?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="group flex w-full flex-col items-stretch gap-1.5 text-left">
      <span className="relative block aspect-[3/2] rounded-[10px]">
        <span className="absolute inset-0 overflow-hidden rounded-[10px] bg-fill">
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
          )}
        </span>
        {selected && (
          <motion.span
            layoutId="glass-bg-selected"
            transition={springs.snappy}
            className="absolute -inset-[3px] rounded-[13px] shadow-[0_0_0_2px_var(--ink)]"
          />
        )}
      </span>
      <span className={cn("px-0.5 text-xs", selected ? "font-medium text-ink" : "text-ink-2")}>{label}</span>
    </button>
  );
}

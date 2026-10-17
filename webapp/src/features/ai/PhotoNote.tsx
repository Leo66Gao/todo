"use client";

// Photos of a textbook page, a whiteboard or handwritten notes, written up as
// a new note: headings, lists and formulas as real formulas. The note is shown
// as it's written and only made when you choose to keep it.

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { AiError, chatStream } from "@/lib/ai";
import { contentFromDelta } from "@/lib/delta";
import { markdownToDelta } from "@/lib/markdownPaste";
import { uuid, type StudyNote } from "@/lib/model";
import { cleanText, photoNoteMessages } from "@/lib/notePrompts";
import { photoDataUrl } from "@/lib/photoData";
import { useNavigate } from "@/shell/nav";
import { addNote, useWorkspace } from "@/store/workspace";
import { Button, Spinner } from "@/ui/controls";
import { Modal } from "@/ui/overlay";
import { Markdown, useKatex } from "./AiViews";
import { usePhotoNote } from "./openers";

/** "# Title" on the first line becomes the note's title. */
export function splitTitle(markdown: string): { title: string; body: string } {
  const m = markdown.match(/^\s*#\s+(.+)\n?/);
  return m ? { title: m[1].replace(/[*_`]/g, "").trim(), body: markdown.slice(m[0].length).trim() } : { title: "", body: markdown.trim() };
}

export function PhotoNoteDialog() {
  const files = usePhotoNote((s) => s.files);
  return (
    <Modal open={files != null} onOpenChange={(o) => !o && usePhotoNote.setState({ files: null })} width={640} label="Note from photos" initialFocus={(e) => e.preventDefault()}>
      {files && <PhotoNote files={files} />}
    </Modal>
  );
}

function PhotoNote({ files }: { files: File[] }) {
  const navigate = useNavigate();
  const { subjectId, folderId } = usePhotoNote.getState();
  const subject = useWorkspace((s) => s.projects.find((p) => p.id === subjectId));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>("Reading the photos");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const katex = useKatex(true);
  /** The photos as sent (scaled down), also shown as thumbnails. */
  const [previews, setPreviews] = useState<string[]>([]);

  const run = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setText("");
    setBusy("Reading the photos");
    try {
      const images = await Promise.all(files.map(photoDataUrl)).catch((e: Error) => {
        throw new AiError(e.message);
      });
      setPreviews(images);
      const result = await chatStream(photoNoteMessages(images, { subject: subject?.title }), {
        signal: controller.signal,
        mode: "fast",
        onText: (t) => {
          setBusy("Writing");
          setText(cleanText(t));
        },
      });
      setText(cleanText(result));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof AiError ? e.message : "Something went wrong. Try again.");
    } finally {
      if (abort.current === controller) setBusy(null);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void run(), 0);
    return () => {
      clearTimeout(timer);
      abort.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scroller.current;
    if (el && busy) el.scrollTop = el.scrollHeight;
  }, [text, busy]);

  const close = () => usePhotoNote.setState({ files: null });
  const create = () => {
    const { title, body } = splitTitle(text);
    const now = new Date();
    const note: StudyNote = {
      id: uuid(),
      title: title || "Note from photo",
      content: contentFromDelta(markdownToDelta(body)),
      subjectId,
      folderId,
      attachments: [],
      createdAt: now,
      updatedAt: now,
    };
    addNote(note);
    close();
    navigate({ view: "note", id: note.id });
  };

  const { title, body } = splitTitle(text);
  return (
    <div className="flex min-h-0 flex-col px-5 pt-4 pb-5 max-sm:px-4">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
        <Sparkles className="size-3.5" />
        {files.length === 1 ? "Note from a photo" : `Note from ${files.length} photos`}
        {busy && text && <Spinner className="size-3" />}
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {previews.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={url} alt={`Photo ${i + 1}`} className="h-16 w-auto shrink-0 rounded-[8px] border border-line object-cover" />
        ))}
      </div>
      {busy && !text && (
        <div className="flex items-center gap-3 py-10 text-sm text-ink-3">
          <Spinner />
          {busy}…
        </div>
      )}
      {error && <p className="py-6 text-sm text-danger">{error}</p>}
      {text && (
        <div ref={scroller} className="scroll-area mt-3 max-h-[56dvh] text-[15px] leading-relaxed">
          {title && <h2 className="mb-2 text-lg font-semibold tracking-[-0.01em]">{title}</h2>}
          <Markdown katex={katex} text={body} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={close}>
          {text ? "Discard" : "Close"}
        </Button>
        {!busy && (error || text) && (
          <Button icon={<RotateCcw className="size-3.5" />} onClick={() => void run()}>
            {error ? "Retry" : "Write it again"}
          </Button>
        )}
        {!busy && text && (
          <Button variant="primary" onClick={create}>
            Create note
          </Button>
        )}
      </div>
    </div>
  );
}

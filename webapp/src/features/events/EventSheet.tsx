"use client";

import { useState } from "react";
import { create } from "zustand";
import { format } from "date-fns";
import { ExternalLink, MapPin, Trash2 } from "lucide-react";
import { deleteEvent, updateEvent, useGoogleEvents, type EventPatch, type GEvent } from "@/lib/googleEvents";
import { formatClock, relativeDay, sameDay } from "@/lib/time";
import { clockOf, withClock } from "@/lib/timeParse";
import { DateField, TimeField } from "@/features/tasks/fields";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/controls";
import { confirmDialog, Modal } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { captureWorkspaceSession, useWorkspace } from "@/store/workspace";

const useOpenEvent = create<{ key: string | null }>(() => ({ key: null }));
export const openEvent = (event: GEvent) => useOpenEvent.setState({ key: event.key });
const closeEvent = () => useOpenEvent.setState({ key: null });
useWorkspace.subscribe((state, previous) => { if (state.user?.uid !== previous.user?.uid) closeEvent(); });

/** "09.00–10.30", "All day", or a span across days. */
export function eventTimeLabel(event: GEvent) {
  if (event.allDay) {
    const last = new Date(event.end.getTime() - 86_400_000);
    return sameDay(event.start, last) ? "All day" : `${format(event.start, "d MMM")} – ${format(last, "d MMM")}`;
  }
  if (!sameDay(event.start, event.end) && event.end.getTime() - event.start.getTime() > 86_400_000 / 2) {
    return `${format(event.start, "d MMM")} ${formatClock(event.start)} – ${format(event.end, "d MMM")} ${formatClock(event.end)}`;
  }
  return `${formatClock(event.start)}–${formatClock(event.end)}`;
}

/** Details of a Google Calendar event, editable when the calendar allows it. */
export function EventSheet() {
  const key = useOpenEvent((s) => s.key);
  const event = useGoogleEvents((s) => {
    if (!key) return null;
    for (const list of Object.values(s.months)) {
      const found = list.find((e) => e.key === key);
      if (found) return found;
    }
    return null;
  });
  const calendar = useGoogleEvents((s) => (event ? s.calendars.find((c) => c.id === event.calendarId) : undefined));
  const [shown, setShown] = useState<GEvent | null>(event);
  if (event && event !== shown) setShown(event);
  const e = event ?? shown;

  const save = async (patch: EventPatch) => {
    if (!e) return;
    const currentSession = captureWorkspaceSession();
    try {
      await updateEvent(e, patch);
    } catch (error) {
      if (!currentSession()) return;
      toast(`Couldn’t update the event: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <Modal open={key != null && event != null} onOpenChange={(o) => !o && closeEvent()} width={460} label="Event" initialFocus={(ev) => ev.preventDefault()}>
      {e && (
        <div className="scroll-area px-5 pt-4 pb-5">
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <span className="size-2 rounded-full" style={{ background: e.color }} />
            {calendar?.name ?? "Google Calendar"}
            {!e.writable && <span className="text-ink-4">· View only</span>}
          </div>
          {/* Keyed by title, so an edit from elsewhere resets the field. */}
          <TitleInput key={`${e.key}:${e.title}`} event={e} onSave={(title) => void save({ title })} />
          <div className="mt-3 space-y-1">
            <Row label={e.allDay ? "Date" : "Starts"}>
              {e.writable ? (
                <div className="flex gap-1.5">
                  <DateField
                    plain
                    className="flex-1"
                    value={e.start}
                    onChange={(d) => {
                      const shift = d.getTime() - new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate()).getTime();
                      void save({ start: new Date(e.start.getTime() + shift), end: new Date(e.end.getTime() + shift) });
                    }}
                  />
                  {!e.allDay && (
                    <TimeField
                      plain
                      clearable={false}
                      className="w-[92px]"
                      value={clockOf(e.start)}
                      onChange={(t) => {
                        if (!t) return;
                        const start = withClock(e.start, t);
                        void save({ start, end: new Date(e.end.getTime() + (start.getTime() - e.start.getTime())) });
                      }}
                    />
                  )}
                </div>
              ) : (
                <span className="px-2 text-sm">{relativeDay(e.start)} · {eventTimeLabel(e)}</span>
              )}
            </Row>
            {!e.allDay && e.writable && (
              <Row label="Ends">
                <TimeField
                  plain
                  clearable={false}
                  className="w-full"
                  value={clockOf(e.end)}
                  onChange={(t) => {
                    if (!t) return;
                    let end = withClock(e.start, t);
                    if (end.getTime() <= e.start.getTime()) end = new Date(end.getTime() + 86_400_000);
                    void save({ end });
                  }}
                />
              </Row>
            )}
            {e.location && (
              <Row label="Where">
                <span className="flex items-center gap-1.5 px-2 text-sm">
                  <MapPin className="size-3.5 shrink-0 text-ink-3" />
                  <span className="truncate">{e.location}</span>
                </span>
              </Row>
            )}
          </div>
          {e.description && <Description text={e.description} />}
          <div className="mt-5 flex items-center gap-2">
            {e.link && (
              <Button size="sm" icon={<ExternalLink className="size-3.5" />} onClick={() => window.open(e.link!, "_blank", "noopener")}>
                Open in Google Calendar
              </Button>
            )}
            {e.writable && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-danger hover:bg-danger-soft hover:text-danger"
                icon={<Trash2 className="size-3.5" />}
                onClick={async () => {
                  const currentSession = captureWorkspaceSession();
                  const ok = await confirmDialog({
                    title: "Delete this event?",
                    message: e.recurring ? "Only this occurrence is deleted from Google Calendar." : "It’s deleted from Google Calendar.",
                    confirmLabel: "Delete",
                    destructive: true,
                  });
                  if (!ok || !currentSession()) return;
                  closeEvent();
                  try {
                    await deleteEvent(e);
                    if (currentSession()) toast("Event deleted");
                  } catch (error) {
                    if (!currentSession()) return;
                    toast(`Couldn’t delete the event: ${error instanceof Error ? error.message : String(error)}`);
                  }
                }}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function TitleInput({ event, onSave }: { event: GEvent; onSave: (title: string) => void }) {
  const [value, setValue] = useState(event.title);
  if (!event.writable) return <h2 className="mt-1.5 text-lg font-semibold">{event.title}</h2>;
  const commit = () => {
    const next = value.trim();
    if (next && next !== event.title) onSave(next);
    else setValue(event.title);
  };
  return (
    <input
      value={value}
      onChange={(ev) => setValue(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => ev.key === "Enter" && (ev.currentTarget as HTMLInputElement).blur()}
      aria-label="Event title"
      className="mt-1 -mx-1 w-[calc(100%+8px)] rounded-[8px] px-1 py-0.5 text-lg font-semibold outline-none transition-colors hover:bg-fill focus:bg-fill"
    />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center">
      <span className="text-xs text-ink-3">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Event notes as plain text, with links clickable. */
function Description({ text }: { text: string }) {
  // Google stores descriptions as light HTML; show it as text.
  const plain = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
  const parts = plain.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className={cn("mt-4 rounded-[10px] bg-fill/60 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink-2", "break-words")}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/** An event in a list of tasks: its calendar's colour, time and title. */
export function EventRow({ event, compact }: { event: GEvent; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => openEvent(event)}
      className={cn(
        "group flex w-full items-center gap-3 rounded-[9px] px-2.5 text-left transition-colors hover:bg-fill/70 active:bg-fill",
        compact ? "h-8" : "min-h-10 py-1.5",
      )}
    >
      <span className="h-[18px] w-[3px] shrink-0 rounded-full" style={{ background: event.color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{event.title}</span>
        {!compact && event.location && <span className="block truncate text-2xs text-ink-3">{event.location}</span>}
      </span>
      <span className="shrink-0 text-xs text-ink-3 tnum">{eventTimeLabel(event)}</span>
    </button>
  );
}

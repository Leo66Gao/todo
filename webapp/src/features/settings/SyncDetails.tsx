"use client";

import { useMemo, useState } from "react";
import { getBool } from "@/lib/prefs";
import { retryCloudSync, useWorkspace } from "@/store/workspace";
import { Button } from "@/ui/controls";
import { toast } from "@/ui/toast";

const when = (at: number | null) => at == null ? "Not yet" : new Date(at).toLocaleString();
const settingName = (key: string) => key.startsWith("settings:versions:") ? "Note history" : key === "settings:sources" ? "Source library" : key === "settings:order" ? "Task order" : key === "settings:tags" ? "Tags" : "Workspace preferences";

export function SyncDetails() {
  const [busy, setBusy] = useState(false);
  const details = useWorkspace((s) => s.syncDetails);
  const user = useWorkspace((s) => s.user);
  const tasks = useWorkspace((s) => s.tasks);
  const notes = useWorkspace((s) => s.notes);
  const projects = useWorkspace((s) => s.projects);
  const folders = useWorkspace((s) => s.folders);
  const connected = useWorkspace((s) => s.calendarConnected);
  const calendarError = useWorkspace((s) => s.syncError);
  const calendarPending = useWorkspace((s) => s.calendarPending);
  const calendarWanted = user != null && getBool(`calendar.enabled.${user.uid}`) === true;
  const conflicts = tasks.filter((t) => t.isConflictCopy).length + notes.filter((n) => n.title.includes("(conflict copy)") || n.title.startsWith("Sync conflict:")).length;
  const names = useMemo(() => new Map<string, string>([
    ...tasks.map((t) => [`task:${t.id}`, t.title] as const),
    ...notes.map((n) => [`note:${n.id}`, n.title] as const),
    ...projects.map((p) => [`project:${p.id}`, p.title] as const),
    ...folders.map((f) => [`folder:${f.id}`, f.name] as const),
  ]), [tasks, notes, projects, folders]);
  const title = (key: string) => names.get(key) ?? (key.startsWith("settings:") ? settingName(key) : `Deleted ${key.split(":")[0]}`);
  const retry = async () => {
    setBusy(true);
    try { await retryCloudSync(); } catch (error) { toast(error instanceof Error ? error.message : "Sync could not be retried."); }
    finally { setBusy(false); }
  };
  return (
    <div className="border-t border-line px-4 py-3 text-xs">
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2">
        <dt className="text-ink-3">Pending workspace uploads</dt><dd>{details.pending.length}</dd>
        <dt className="text-ink-3">Last cloud upload</dt><dd>{when(details.lastUploadedAt)}</dd>
        <dt className="text-ink-3">Last confirmed cloud snapshot</dt><dd>{when(details.lastDownloadedAt)}</dd>
        <dt className="text-ink-3">Conflict copies to review</dt><dd>{conflicts}</dd>
        <dt className="text-ink-3">Google Calendar</dt><dd>{connected ? "Connected" : calendarWanted ? "Reconnect in Calendar settings" : "Not connected"}</dd>
        <dt className="text-ink-3">Pending Calendar operations</dt><dd>{calendarPending}</dd>
        {details.retryAt != null && <><dt className="text-ink-3">Automatic retry</dt><dd>{when(details.retryAt)}</dd></>}
      </dl>
      {(details.error || calendarError) && <p className="mt-3 break-words text-danger" role="status">{details.error ?? calendarError}</p>}
      {!!details.pending.length && <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto" aria-label="Pending uploads">
        {details.pending.map((entry) => <li key={entry.key} className="flex gap-2"><span className="text-ink-3">{entry.deleting ? "Delete" : "Save"}</span><span className="truncate" title={entry.key}>{title(entry.key)}</span></li>)}
      </ul>}
      {user && <Button size="sm" variant="ghost" className="mt-3" disabled={busy} onClick={() => void retry()}>{busy ? "Retrying…" : "Retry sync now"}</Button>}
      <p className="mt-2 text-ink-3">Cloud sync and Google Calendar use separate connections. Conflict copies keep competing edits available for review.</p>
    </div>
  );
}

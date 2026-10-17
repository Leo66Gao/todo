"use client";

import { useRef, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { FileText, ListTodo, RotateCcw, Trash2 } from "lucide-react";
import { makeBackup, mergeBackup, parseBackup } from "@/lib/backup";
import { useNavigate } from "@/shell/nav";
import { emptyTrash, purgeFromTrash, restoreFromTrash, TRASH_DAYS, useTrash, type TrashEntry } from "@/store/trash";
import { applyRestoredRecords, captureWorkspaceSession, flushWorkspaceSave, useWorkspace, workspaceRecords } from "@/store/workspace";
import { Button } from "@/ui/controls";
import { confirmDialog } from "@/ui/overlay";
import { toast } from "@/ui/toast";

/** Back up the whole workspace to a file, or bring a backup back. */
export function BackupItems({ Item }: { Item: (props: { title: string; detail?: string; children?: React.ReactNode }) => React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const exportBackup = async () => {
    setBusy(true);
    try {
      await flushWorkspaceSave().catch(() => {});
      const file = makeBackup(workspaceRecords());
      const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
      const { saveFile } = await import("@/lib/noteFiles");
      await saveFile(`Todo backup ${file.exportedAt.slice(0, 10)}.json`, blob);
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") toast(`Couldn’t save the backup: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (picked: File) => {
    const currentSession = captureWorkspaceSession();
    try {
      const backup = parseBackup(await picked.text());
      const ok = await confirmDialog({
        title: "Restore this backup?",
        message: `From ${new Date(backup.exportedAt).toLocaleString()}. Items that still exist go back to how they were then; deleted ones come back. Anything made since stays.`,
        confirmLabel: "Restore",
      });
      if (!ok || !currentSession()) return;
      setBusy(true);
      const { records, updated, added } = mergeBackup(workspaceRecords(), backup.records);
      const stored = await applyRestoredRecords(records);
      if (!currentSession()) return;
      if (!stored) {
        // It's on screen, but not stored yet (saving retries on its own too).
        toast("Restored, but it couldn’t be saved on this device yet. Keep the app open.", {
          label: "Retry",
          run: () => void flushWorkspaceSave().then(() => toast("Restore saved"), (e) => toast(e instanceof Error ? e.message : "Still couldn’t save.")),
        });
        return;
      }
      toast(added || updated ? `Restored: ${added} brought back, ${updated} set back` : "Everything already matched the backup");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn’t restore the backup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Item title="Back up workspace" detail="Saves every task, subject, note, source and setting, with note history, to a file.">
        <Button size="sm" disabled={busy} onClick={() => void exportBackup()}>
          Save backup
        </Button>
      </Item>
      <Item title="Restore from backup" detail="Brings back what a backup holds, without duplicating what’s already here.">
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
          Restore…
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void restore(file);
          }}
        />
      </Item>
    </>
  );
}

/** Recently deleted tasks and notes, for 30 days. */
export function TrashList() {
  const entries = useTrash();
  const navigate = useNavigate();
  const user = useWorkspace((s) => s.user);
  if (entries.length === 0) {
    return <p className="px-4 py-3.5 text-xs text-ink-3">Nothing here. Deleted tasks and notes stay for {TRASH_DAYS} days{user ? " on all your devices" : ""}.</p>;
  }
  const restore = (entry: TrashEntry) => {
    const id = restoreFromTrash(entry.kind, entry.id);
    if (!id) return;
    toast(`Restored “${entry.title || "Untitled"}”`, entry.kind === "note" ? { label: "Open", run: () => navigate({ view: "note", id }) } : undefined);
  };
  const empty = async () => {
    const ok = await confirmDialog({
      title: "Empty Recently deleted?",
      message: `${entries.length} ${entries.length === 1 ? "item is" : "items are"} deleted for good. This can’t be undone.`,
      confirmLabel: "Empty",
      destructive: true,
    });
    if (ok) emptyTrash();
  };
  return (
    <>
      <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
        {entries.map((entry) => (
          <li key={`${entry.kind}:${entry.id}`} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            {entry.kind === "note" ? <FileText className="size-4 shrink-0 text-ink-3" /> : <ListTodo className="size-4 shrink-0 text-ink-3" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{entry.title || "Untitled"}</div>
              <div className="text-xs text-ink-3">
                {entry.kind === "note" ? "Note" : "Task"} · deleted {formatDistanceToNowStrict(entry.deletedAt, { addSuffix: true })}
              </div>
            </div>
            <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => restore(entry)}>
              Restore
            </Button>
            <button
              type="button"
              aria-label={`Delete “${entry.title || "Untitled"}” for good`}
              onClick={() => purgeFromTrash(entry.kind, entry.id)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end px-4 py-2.5">
        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => void empty()}>
          Empty Recently deleted
        </Button>
      </div>
    </>
  );
}

"use client";

// The last step of connecting Claude (or another MCP client) to Todo through
// the Todo MCP server (mcp/ in this repo). The server sends the user here
// after they approved the client there; here, signed in, they confirm, and
// this page hands the server their sign-in through a one-time code, then
// returns them to it to finish. The sign-in goes only to the server set in
// NEXT_PUBLIC_MCP_ORIGIN, never to an address taken from the URL.

import { useState } from "react";
import { firebase } from "@/lib/firebase";
import { PageHeader } from "@/shell/Shell";
import { signInWithGoogle, useWorkspace } from "@/store/workspace";
import { Button, Spinner } from "@/ui/controls";

const MCP_ORIGIN = process.env.NEXT_PUBLIC_MCP_ORIGIN ?? "";

export function ConnectView() {
  const user = useWorkspace((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("state");

  const connect = async () => {
    const current = firebase()?.auth.currentUser;
    if (!current || !state) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${MCP_ORIGIN}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!res.ok || !body.code) throw new Error(body.error ?? "The connector didn't answer.");
      const back = new URL("/callback", MCP_ORIGIN);
      back.searchParams.set("state", state);
      back.searchParams.set("code", body.code);
      window.location.assign(back.toString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  let body;
  if (!MCP_ORIGIN) body = <p className="text-sm text-ink-2">This copy of Todo has no connector set up.</p>;
  else if (!state) body = <p className="text-sm text-ink-2">Start connecting from Claude: add the Todo connector there, and it brings you here.</p>;
  else if (!user)
    body = (
      <>
        <p className="text-sm text-ink-2">Sign in with the Google account your tasks are on, then connect.</p>
        <Button variant="primary" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </Button>
      </>
    );
  else
    body = (
      <>
        <p className="text-sm text-ink-2">
          Claude will be able to see your tasks, assignments and subjects, move tasks to other days and times, change them and add new ones. It can&apos;t delete anything.
        </p>
        <p className="text-sm text-ink-3">Signed in as {user.email ?? user.displayName}. You can disconnect it any time from Claude&apos;s connector settings.</p>
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void connect()} icon={busy ? <Spinner className="size-3.5" /> : undefined}>
            Connect
          </Button>
          <Button disabled={busy} onClick={() => window.history.back()}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </>
    );

  return (
    <>
      <PageHeader title="Connect Claude" />
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-6 pt-2">{body}</div>
    </>
  );
}

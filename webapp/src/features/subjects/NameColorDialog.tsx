"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { create } from "zustand";
import { argbToCss, hexToArgb } from "@/lib/dart";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/controls";
import { Modal } from "@/ui/overlay";

export const PALETTE = [
  "#E5484D",
  "#F76B15",
  "#E2A336",
  "#46A758",
  "#12A594",
  "#0090FF",
  "#3E63DD",
  "#6E56CF",
  "#D6409F",
  "#8D6E63",
  "#8B8D98",
].map(hexToArgb);

interface Request {
  title: string;
  confirmLabel: string;
  name: string;
  color: number;
  placeholder: string;
  resolve: (value: { name: string; color: number } | null) => void;
}

const useRequest = create<{ request: Request | null; open: boolean }>(() => ({ request: null, open: false }));

export function editNameColor(options: Omit<Request, "resolve">) {
  return new Promise<{ name: string; color: number } | null>((resolve) =>
    useRequest.setState({ request: { ...options, resolve }, open: true }),
  );
}

export function NameColorHost() {
  const { request, open } = useRequest();
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          request?.resolve(null);
          useRequest.setState({ open: false });
        }
      }}
      width={400}
      label={request?.title ?? "Edit"}
    >
      {request && <Form key={request.title + request.name} request={request} />}
    </Modal>
  );
}

function Form({ request }: { request: Request }) {
  const [name, setName] = useState(request.name);
  const [color, setColor] = useState(request.color);
  const finish = (value: { name: string; color: number } | null) => {
    request.resolve(value);
    useRequest.setState({ open: false });
  };
  return (
    <form
      className="p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) finish({ name: name.trim(), color });
      }}
    >
      <h2 className="text-base font-semibold">{request.title}</h2>
      <div className="mt-4 flex items-center gap-3">
        <span className="size-3 shrink-0 rounded-full" style={{ background: argbToCss(color) }} />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={request.placeholder}
          className="h-9 flex-1 rounded-ctl border border-line-strong bg-card px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft"
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 pl-6">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label="Colour"
            onClick={() => setColor(c)}
            className={cn(
              "flex size-6 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 active:scale-95",
              c === color && "ring-2 ring-ink ring-offset-2 ring-offset-raised",
            )}
            style={{ background: argbToCss(c) }}
          >
            {c === color && <Check className="size-3.5 text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => finish(null)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          {request.confirmLabel}
        </Button>
      </div>
    </form>
  );
}

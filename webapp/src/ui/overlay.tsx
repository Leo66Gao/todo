"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { ContextMenu as RCM, Dialog, DropdownMenu as RDM, Popover as RPopover, Tooltip as RTooltip } from "radix-ui";
import { Check, ChevronRight } from "lucide-react";
import { create } from "zustand";
import { cn } from "./cn";
import { Button, Kbd } from "./controls";
import { springs } from "./motion";
import { PHONE, useMedia } from "./useMedia";

// ---------------------------------------------------------------------------
// Modal

export function Modal({
  open,
  onOpenChange,
  children,
  width = 540,
  label,
  className,
  initialFocus,
  returnFocus = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  width?: number;
  label: string;
  className?: string;
  /** Return false to keep Radix from focusing the first control. */
  initialFocus?: (event: Event) => void;
  /** Whether closing puts focus back where it was (off when the caller moves it). */
  returnFocus?: boolean;
}) {
  const phone = useMedia(PHONE);
  const sheetDrag = useDragControls();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={{ duration: 0.18 }}
              />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center px-4 pt-[min(12vh,120px)] pb-6 max-sm:items-end max-sm:px-0 max-sm:pb-0">
              <Dialog.Content
                forceMount
                asChild
                aria-describedby={undefined}
                onOpenAutoFocus={initialFocus}
                onCloseAutoFocus={returnFocus ? undefined : (e) => e.preventDefault()}
              >
                <motion.div
                  className={cn(
                    "glass-overlay pointer-events-auto relative flex max-h-[min(86vh,760px)] w-full flex-col overflow-hidden rounded-modal bg-raised shadow-modal outline-none",
                    "max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]",
                    className,
                  )}
                  style={{ maxWidth: width }}
                  {...(phone
                    ? {
                        // A bottom sheet: slides up, and drags down to close.
                        initial: { y: "100%" },
                        animate: { y: 0 },
                        exit: { y: "100%", transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } },
                        transition: springs.panel,
                        drag: "y" as const,
                        dragListener: false,
                        dragControls: sheetDrag,
                        dragConstraints: { top: 0, bottom: 0 },
                        dragElastic: { top: 0, bottom: 0.8 },
                        onDragEnd: (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
                          if (info.offset.y > 110 || info.velocity.y > 600) onOpenChange(false);
                        },
                      }
                    : {
                        initial: { opacity: 0, scale: 0.965, y: 10 },
                        animate: { opacity: 1, scale: 1, y: 0 },
                        exit: { opacity: 0, scale: 0.98, y: 4, transition: { duration: 0.13, ease: [0.4, 0, 1, 1] } },
                        transition: springs.modal,
                      })}
                >
                  <Dialog.Title className="sr-only">{label}</Dialog.Title>
                  {phone && (
                    <div
                      aria-hidden
                      onPointerDown={(e) => sheetDrag.start(e)}
                      className="flex h-5 shrink-0 cursor-grab touch-none items-end justify-center"
                    >
                      <span className="h-[5px] w-9 rounded-full bg-line-strong" />
                    </div>
                  )}
                  {children}
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Popover

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = "start",
  side = "bottom",
  className,
  sideOffset = 6,
  modal = false,
}: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  sideOffset?: number;
  modal?: boolean;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (value: boolean) => {
    onOpenChange?.(value);
    if (open === undefined) setInnerOpen(value);
  };
  return (
    <RPopover.Root open={isOpen} onOpenChange={setOpen} modal={modal}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={12}
          className={cn("pop glass-overlay relative z-50 rounded-pop bg-raised shadow-pop outline-none", className)}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

// ---------------------------------------------------------------------------
// Tooltip

export function Tooltip({
  label,
  shortcut,
  children,
  side = "bottom",
}: {
  label: ReactNode;
  shortcut?: string[];
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="tip glass-ink relative z-[70] flex items-center gap-2 rounded-[7px] bg-ink px-2 py-1 text-2xs font-medium text-on-ink shadow-pop"
        >
          {label}
          {shortcut && (
            <span className="flex gap-0.5 text-on-ink/60">
              {shortcut.map((k) => (
                <span key={k}>{k}</span>
              ))}
            </span>
          )}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const TooltipProvider = RTooltip.Provider;

// ---------------------------------------------------------------------------
// Menus (dropdown and right-click share one item model)

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      onSelect?: () => void;
      destructive?: boolean;
      disabled?: boolean;
      checked?: boolean;
      swatch?: string;
      items?: MenuItem[];
    }
  | { separator: true }
  | { heading: string };

const itemClass = cn(
  "relative flex h-[28px] cursor-default select-none items-center gap-2 rounded-[6px] px-2 text-sm text-ink outline-none",
  "data-[highlighted]:bg-fill data-[state=open]:bg-fill data-[disabled]:opacity-40",
);
const menuSurface = "pop glass-overlay relative z-[60] min-w-[180px] rounded-pop bg-raised p-1 shadow-pop";

type Parts = typeof RDM | typeof RCM;

function renderItems(P: Parts, items: MenuItem[]): ReactNode {
  return items.map((item, i) => {
    if ("separator" in item) return <P.Separator key={i} className="mx-2 my-1 h-px bg-line" />;
    if ("heading" in item)
      return (
        <P.Label key={i} className="px-2 pt-1.5 pb-1 text-2xs font-medium text-ink-3">
          {item.heading}
        </P.Label>
      );
    const content = (
      <>
        <span className="flex w-4 shrink-0 justify-center text-ink-3 [&>svg]:size-[15px]">
          {item.swatch ? (
            <span className="size-2.5 rounded-full" style={{ background: item.swatch }} />
          ) : (
            item.icon
          )}
        </span>
        <span className={cn("flex-1 truncate", item.destructive && "text-danger")}>{item.label}</span>
        {item.checked && <Check className="size-3.5 text-ink-2" />}
        {item.shortcut && <span className="text-2xs text-ink-3">{item.shortcut}</span>}
      </>
    );
    if (item.items) {
      return (
        <P.Sub key={i}>
          <P.SubTrigger className={itemClass} disabled={item.disabled}>
            {content}
            <ChevronRight className="size-3.5 text-ink-3" />
          </P.SubTrigger>
          <P.Portal>
            <P.SubContent className={cn(menuSurface, "max-h-[320px] overflow-y-auto")} sideOffset={4} alignOffset={-4}>
              {renderItems(P, item.items)}
            </P.SubContent>
          </P.Portal>
        </P.Sub>
      );
    }
    return (
      <P.Item key={i} className={itemClass} disabled={item.disabled} onSelect={item.onSelect}>
        {content}
      </P.Item>
    );
  });
}

export function Menu({
  trigger,
  items,
  align = "start",
  side = "bottom",
  onOpenChange,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <RDM.Root modal={false} onOpenChange={onOpenChange}>
      <RDM.Trigger asChild>{trigger}</RDM.Trigger>
      <RDM.Portal>
        <RDM.Content align={align} side={side} sideOffset={5} collisionPadding={12} className={menuSurface}>
          {renderItems(RDM, items)}
        </RDM.Content>
      </RDM.Portal>
    </RDM.Root>
  );
}

export function ContextMenu({
  items,
  children,
  disabled,
}: {
  items: MenuItem[] | (() => MenuItem[]);
  children: ReactNode;
  disabled?: boolean;
}) {
  const [resolved, setResolved] = useState<MenuItem[]>([]);
  return (
    <RCM.Root
      modal={false}
      onOpenChange={(open) => open && setResolved(typeof items === "function" ? items() : items)}
    >
      <RCM.Trigger asChild disabled={disabled}>
        {children}
      </RCM.Trigger>
      <RCM.Portal>
        <RCM.Content className={menuSurface} collisionPadding={12}>
          {renderItems(RCM, resolved)}
        </RCM.Content>
      </RCM.Portal>
    </RCM.Root>
  );
}

// ---------------------------------------------------------------------------
// Imperative confirm / prompt

type Ask =
  | {
      kind: "confirm";
      title: string;
      message?: ReactNode;
      confirmLabel: string;
      cancelLabel?: string;
      destructive?: boolean;
      resolve: (value: boolean) => void;
    }
  | {
      kind: "prompt";
      title: string;
      message?: ReactNode;
      placeholder?: string;
      initial?: string;
      confirmLabel: string;
      validate?: (value: string) => boolean;
      resolve: (value: string | null) => void;
    };

const useAsk = create<{ current: Ask | null }>(() => ({ current: null }));

export function confirmDialog(options: {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => useAsk.setState({ current: { kind: "confirm", ...options, resolve } }));
}

export function promptDialog(options: {
  title: string;
  message?: ReactNode;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  validate?: (value: string) => boolean;
}): Promise<string | null> {
  return new Promise((resolve) => useAsk.setState({ current: { kind: "prompt", ...options, resolve } }));
}

export function AskHost() {
  const current = useAsk((s) => s.current);
  const [text, setText] = useState("");
  // Keep the last request on screen while the dialog animates out.
  const [shown, setShown] = useState<Ask | null>(null);
  if (current && current !== shown) {
    setShown(current);
    setText(current.kind === "prompt" ? (current.initial ?? "") : "");
  }
  const open = current != null;

  const finish = (ok: boolean) => {
    const ask = useAsk.getState().current;
    if (!ask) return;
    useAsk.setState({ current: null });
    if (ask.kind === "confirm") ask.resolve(ok);
    else ask.resolve(ok ? text.trim() : null);
  };

  const ask = current ?? shown;
  const valid =
    ask?.kind !== "prompt" || (text.trim().length > 0 && (ask.validate?.(text.trim()) ?? true));

  return (
    <Modal open={open} onOpenChange={(o) => !o && finish(false)} width={400} label={ask?.title ?? "Dialog"}>
      {ask && (
        <form
          className="p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) finish(true);
          }}
        >
          <h2 className="text-base font-semibold">{ask.title}</h2>
          {ask.message && <div className="mt-1.5 text-sm text-ink-2">{ask.message}</div>}
          {ask.kind === "prompt" && (
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={ask.placeholder}
              className="mt-3.5 h-9 w-full rounded-ctl border border-line-strong bg-canvas px-3 text-sm outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-3 focus:ring-accent-soft"
            />
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => finish(false)}>
              {(ask.kind === "confirm" && ask.cancelLabel) || "Cancel"}
            </Button>
            <Button
              type="submit"
              variant={ask.kind === "confirm" && ask.destructive ? "danger" : "primary"}
              disabled={!valid}
              autoFocus={ask.kind === "confirm"}
            >
              {ask.confirmLabel}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export { Kbd };

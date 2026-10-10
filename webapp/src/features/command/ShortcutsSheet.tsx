"use client";

import { ui, useUI } from "@/shell/ui";
import { Kbd } from "@/ui/controls";
import { Modal } from "@/ui/overlay";

const GROUPS: { title: string; items: [string, string[]][] }[] = [
  {
    title: "Anywhere",
    items: [
      ["Search and commands", ["⌘", "K"]],
      ["New task", ["N"]],
      ["Show or hide the sidebar", ["⌘", "\\"]],
      ["Jump to today", ["T"]],
      ["Today, Week, Calendar…", ["1", "–", "6"]],
      ["Keyboard shortcuts", ["?"]],
    ],
  },
  {
    title: "Lists",
    items: [
      ["Move selection", ["↑", "↓"]],
      ["Previous or next day", ["←", "→"]],
      ["Complete selected task", ["Space"]],
      ["Focus on selected task", ["F"]],
      ["Open selected task", ["↩"]],
      ["Edit selected task", ["⌘", "↩"]],
      ["Duplicate selected task", ["⌘", "D"]],
      ["Delete selected task", ["⌫"]],
      ["Close details", ["esc"]],
    ],
  },
  {
    title: "Task form and notes",
    items: [
      ["Save the task", ["⌘", "↩"]],
      ["Set details from the title", ["essay due fri 3pm 2h"]],
      ["Bold, italic, underline", ["⌘", "B / I / U"]],
      ["Add a link", ["⌘", "K"]],
      ["Open a link in notes", ["⌘", "click"]],
    ],
  },
];

export function ShortcutsSheet() {
  const open = useUI((s) => s.shortcutsOpen);
  return (
    <Modal open={open} onOpenChange={(o) => ui.set({ shortcutsOpen: o })} width={520} label="Keyboard shortcuts">
      <div className="scroll-area p-5">
        <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
        {GROUPS.map((g) => (
          <section key={g.title} className="mt-5">
            <h3 className="mb-1.5 text-xs font-semibold text-ink-2">{g.title}</h3>
            {g.items.map(([label, keys]) => (
              <div key={label} className="flex h-8 items-center justify-between border-b border-line text-sm last:border-b-0">
                <span className="text-ink-2">{label}</span>
                <span className="flex gap-1">
                  {keys.map((k) => (k === "–" ? <span key={k} className="text-xs text-ink-3">–</span> : <Kbd key={k}>{k}</Kbd>))}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

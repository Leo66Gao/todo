"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "./restrict";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { argbToCss } from "@/lib/dart";
import { setThemeMode, useAppearance } from "@/lib/appearance";
import { firebaseConfigured, googleWebClientId } from "@/lib/firebase";
import { DEFAULT_FIELD_ORDER, FIELD_VISIBILITY_KEY, uuid, type FieldId, type TaskLabel } from "@/lib/model";
import { PageHeader } from "@/shell/Shell";
import { ui } from "@/shell/ui";
import { editNameColor, PALETTE } from "@/features/subjects/NameColorDialog";
import {
  clearWorkspace,
  UploadPendingError,
  connectCalendar,
  disconnectCalendar,
  importLocalData,
  signInWithGoogle,
  signOut,
  updateSettings,
  useWorkspace,
} from "@/store/workspace";
import { cn } from "@/ui/cn";
import { Button, Segmented, Slider, Spinner, Switch } from "@/ui/controls";
import { confirmDialog, promptDialog } from "@/ui/overlay";
import { toast } from "@/ui/toast";
import { isNative } from "@/lib/native";
import { LEAD_OPTIONS, requestReminderPermission, setReminderPrefs, useReminderPrefs, type ReminderPrefs } from "@/lib/reminders";
import { springs } from "@/ui/motion";
import { BackgroundPicker } from "@/glass/GlassSettings";
import { RADIUS_RANGE, setGlassPrefs, useGlassPrefs } from "@/glass/prefs";

const FIELD_NAMES: Record<FieldId, string> = {
  type: "Task type",
  date: "Date",
  time: "Time",
  notes: "Notes",
  duration: "Time needed",
  difficulty: "Difficulty",
  priority: "Priority",
  subject: "Subject",
  labels: "Label",
};

export function SettingsView() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="scroll-area flex-1 pb-24">
        <div className="mx-auto w-full max-w-[680px] space-y-9 px-6 pt-2 max-sm:px-4">
          <AccountSection />
          <AppearanceSection />
          <TaskFormSection />
          <LabelsSection />
          <CalendarSection />
          <RemindersSection />
          <Group title="Keyboard">
            <Item title="Keyboard shortcuts" detail="Press ? anywhere to see them.">
              <Button size="sm" onClick={() => ui.set({ shortcutsOpen: true })}>
                Show shortcuts
              </Button>
            </Item>
          </Group>
          <DataSection />
        </div>
      </div>
    </>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
      <div className="mt-3 divide-y divide-line rounded-[calc(var(--radius-ctl)_+_4px)] border border-line">{children}</div>
    </section>
  );
}

function Item({ title, detail, children, className }: { title: ReactNode; detail?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[52px] items-center gap-4 px-4 py-2.5", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm">{title}</div>
        {detail && <div className="mt-0.5 text-xs text-ink-3">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

function AccountSection() {
  const user = useWorkspace((s) => s.user);
  const busy = useWorkspace((s) => s.authBusy);
  const status = useWorkspace((s) => s.cloudStatus);
  const error = useWorkspace((s) => s.cloudError);
  const importAvailable = useWorkspace((s) => s.importAvailable);
  return (
    <Group title="Account" description="Your tasks, subjects, notes and task-form settings sync with the Todo phone app.">
      {!firebaseConfigured ? (
        <Item title="Sync isn’t set up in this build" detail="Add the Firebase web configuration to webapp/.env.local. Everything is saved on this device meanwhile." />
      ) : user ? (
        <>
          <Item
            title={user.displayName ?? user.email}
            detail={
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: status === "Synced" ? "var(--p-low)" : "var(--p-medium)" }} />
                {status}
                {user.displayName && user.email && <span className="text-ink-4">{user.email}</span>}
              </span>
            }
          >
            <Button size="sm" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </Button>
          </Item>
          {importAvailable && (
            <Item title="Import data from this device" detail="Adds anything you created here before signing in. Nothing already synced is replaced.">
              <Button size="sm" onClick={() => void importLocalData()}>
                Import
              </Button>
            </Item>
          )}
        </>
      ) : (
        <Item title="Not signed in" detail="Sign in with the same Google account on every device to keep them in sync.">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void signInWithGoogle()}>
            {busy ? <Spinner className="size-3.5 border-on-ink/40 border-t-on-ink" /> : null}
            Sign in with Google
          </Button>
        </Item>
      )}
      {error && <div className="px-4 py-2.5 text-xs text-danger">{error}</div>}
    </Group>
  );
}

function AppearanceSection() {
  const mode = useAppearance((s) => s.themeMode);
  const glass = useGlassPrefs((s) => s.enabled);
  const blur = useGlassPrefs((s) => s.blur);
  const frost = useGlassPrefs((s) => s.frost);
  const radius = useGlassPrefs((s) => s.radius);
  const lightText = useGlassPrefs((s) => s.lightText);
  const pointerLight = useGlassPrefs((s) => s.pointerLight);
  return (
    <Group title="Appearance" description="Saved on this device only.">
      <Item title="Theme" detail={glass ? "Glass panels over a background of your choice." : "The standard, quiet look."}>
        <Segmented
          size="sm"
          value={glass ? "glass" : "standard"}
          onChange={(v) => setGlassPrefs({ enabled: v === "glass" })}
          options={[
            { value: "standard", label: "Standard" },
            { value: "glass", label: "Liquid Glass" },
          ]}
        />
      </Item>
      <Item title="Mode" detail="Match the system, or choose light or dark.">
        <Segmented
          size="sm"
          value={mode}
          onChange={setThemeMode}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Item>
      <AnimatePresence initial={false}>
        {glass && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.layout}
            className="divide-y divide-line overflow-hidden"
          >
            <div>
              <Item title="Background" className="min-h-0 pb-1.5" />
              <BackgroundPicker />
            </div>
            <Item title="Blur" detail="How much the glass softens what is behind it.">
              <RangeSlider value={blur} onChange={(v) => setGlassPrefs({ blur: v })} label="Blur" from="Sharp" to="Soft" />
            </Item>
            <Item title="Frost" detail="A frosted texture, like sandblasted glass.">
              <RangeSlider value={frost} onChange={(v) => setGlassPrefs({ frost: v })} label="Frost" from="Clear" to="Frosted" />
            </Item>
            <Item title="Corners" detail="Roundness of panels, controls and menus.">
              <RangeSlider
                value={radius}
                min={RADIUS_RANGE[0]}
                max={RADIUS_RANGE[1]}
                step={1}
                onChange={(v) => setGlassPrefs({ radius: v })}
                label="Corner radius"
                from="Tight"
                to="Round"
              />
            </Item>
            <Item title="Text in light mode" detail="Light text reads better over darker backgrounds.">
              <Segmented
                size="sm"
                value={lightText ? "light" : "dark"}
                onChange={(v) => setGlassPrefs({ lightText: v === "light" })}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
              />
            </Item>
            <Item title="Light follows the pointer" detail="Highlights turn towards the mouse." className="hover-only">
              <Switch checked={pointerLight} onChange={(v) => setGlassPrefs({ pointerLight: v })} label="Light follows the pointer" />
            </Item>
          </motion.div>
        )}
      </AnimatePresence>
    </Group>
  );
}

function RangeSlider({
  value,
  onChange,
  label,
  from,
  to,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  from: string;
  to: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex w-56 items-center gap-2.5 text-2xs text-ink-3 max-sm:w-44">
      <span className="w-9 shrink-0 text-right">{from}</span>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} label={label} />
      <span className="w-9 shrink-0">{to}</span>
    </div>
  );
}

function TaskFormSection() {
  const settings = useWorkspace((s) => s.settings);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = settings.fieldOrder.indexOf(e.active.id as FieldId);
    const to = settings.fieldOrder.indexOf(e.over.id as FieldId);
    updateSettings({ ...settings, fieldOrder: arrayMove(settings.fieldOrder, from, to) });
  };
  const isDefault =
    settings.fieldOrder.join() === DEFAULT_FIELD_ORDER.join() &&
    DEFAULT_FIELD_ORDER.every((id) => settings[FIELD_VISIBILITY_KEY[id]] === true);
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Task form</h2>
          <p className="mt-0.5 text-xs text-ink-3">Choose which fields new tasks show, and drag to reorder them.</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={isDefault}
          onClick={() =>
            updateSettings({
              ...settings,
              fieldOrder: [...DEFAULT_FIELD_ORDER],
              showTaskType: true,
              showDate: true,
              showTime: true,
              showNotes: true,
              showDuration: true,
              showDifficulty: true,
              showPriority: true,
              showSubject: true,
              showLabels: true,
            })
          }
        >
          Reset
        </Button>
      </div>
      <div className="mt-3 rounded-[calc(var(--radius-ctl)_+_4px)] border border-line p-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <SortableContext items={settings.fieldOrder} strategy={verticalListSortingStrategy}>
            {settings.fieldOrder.map((id) => (
              <FieldRow
                key={id}
                id={id}
                visible={settings[FIELD_VISIBILITY_KEY[id]] === true}
                onToggle={(v) => updateSettings({ ...settings, [FIELD_VISIBILITY_KEY[id]]: v })}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </section>
  );
}

function FieldRow({ id, visible, onToggle }: { id: FieldId; visible: boolean; onToggle: (v: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "relative flex h-11 items-center gap-2 rounded-[9px] bg-canvas px-2",
        isDragging && "z-10 shadow-lift",
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${FIELD_NAMES[id]}`}
        {...attributes}
        {...listeners}
        className="flex size-7 cursor-grab items-center justify-center rounded-[6px] text-ink-4 hover:bg-fill hover:text-ink-3 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className={cn("flex-1 text-sm", !visible && "text-ink-3")}>{FIELD_NAMES[id]}</span>
      <Switch checked={visible} onChange={onToggle} label={`Show ${FIELD_NAMES[id]}`} />
    </div>
  );
}

function LabelsSection() {
  const settings = useWorkspace((s) => s.settings);
  const edit = async (label?: TaskLabel) => {
    const result = await editNameColor({
      title: label ? "Edit label" : "New label",
      confirmLabel: label ? "Save" : "Create label",
      name: label?.name ?? "",
      placeholder: "Label name",
      color: label?.colorValue ?? PALETTE[settings.labels.length % PALETTE.length],
    });
    if (!result) return;
    const lower = result.name.toLowerCase();
    if (lower === "general") {
      toast("“General” is reserved for tasks without a label.");
      return;
    }
    if (settings.labels.some((l) => l.id !== label?.id && l.name.toLowerCase() === lower)) {
      toast("A label with that name already exists.");
      return;
    }
    const current = useWorkspace.getState().settings;
    const updated: TaskLabel = { id: label?.id ?? uuid(), name: result.name, colorValue: result.color };
    const labels = label ? current.labels.map((l) => (l.id === label.id ? updated : l)) : [...current.labels, updated];
    // Tasks refer to labels by name; keep them attached through a rename.
    if (label && label.name !== updated.name) {
      useWorkspace.setState({
        tasks: useWorkspace
          .getState()
          .tasks.map((t) => (t.category === label.name ? { ...t, category: updated.name } : t)),
      });
    }
    updateSettings({ ...current, labels });
  };
  const remove = async (label: TaskLabel) => {
    const ok = await confirmDialog({
      title: `Delete “${label.name}”?`,
      message: "Tasks with this label keep their other details.",
      confirmLabel: "Delete label",
      destructive: true,
    });
    if (!ok) return;
    const current = useWorkspace.getState().settings;
    updateSettings({ ...current, labels: current.labels.filter((l) => l.id !== label.id) });
  };
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Labels</h2>
          <p className="mt-0.5 text-xs text-ink-3">Colour-coded labels for grouping tasks.</p>
        </div>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => void edit()}>
          New label
        </Button>
      </div>
      <div className="mt-3 divide-y divide-line rounded-[calc(var(--radius-ctl)_+_4px)] border border-line">
        {settings.labels.length === 0 && <p className="px-4 py-3.5 text-sm text-ink-3">No labels yet.</p>}
        {settings.labels.map((label) => (
          <div key={label.id} className="group flex h-11 items-center gap-3 px-4">
            <span className="size-2.5 rounded-full" style={{ background: argbToCss(label.colorValue) }} />
            <span className="flex-1 text-sm">{label.name}</span>
            <button
              type="button"
              aria-label={`Edit ${label.name}`}
              onClick={() => void edit(label)}
              className="flex size-7 items-center justify-center rounded-[6px] text-ink-3 hover-reveal opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fill hover:text-ink focus-visible:opacity-100"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${label.name}`}
              onClick={() => void remove(label)}
              className="flex size-7 items-center justify-center rounded-[6px] text-ink-3 hover-reveal opacity-0 transition-opacity group-hover:opacity-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CalendarSection() {
  const user = useWorkspace((s) => s.user);
  const connected = useWorkspace((s) => s.calendarConnected);
  const error = useWorkspace((s) => s.syncError);
  if (!firebaseConfigured) return null;
  return (
    <Group title="Google Calendar" description="Open tasks appear as events in your primary calendar; completed ones are removed.">
      <Item
        title={connected ? "Connected" : "Not connected"}
        detail={!user ? "Sign in first to connect your calendar." : connected ? user.email : "You’ll be sent to Google to allow access, then brought back here."}
      >
        {connected ? (
          <Button size="sm" onClick={() => disconnectCalendar()}>
            Disconnect
          </Button>
        ) : (
          <Button size="sm" disabled={!user || !googleWebClientId} onClick={() => void connectCalendar()}>
            Connect
          </Button>
        )}
      </Item>
      {error && <div className="px-4 py-2.5 text-xs text-danger">{error}</div>}
    </Group>
  );
}

function RemindersSection() {
  const timed = useReminderPrefs((s) => s.timed);
  const lead = useReminderPrefs((s) => s.lead);
  const summary = useReminderPrefs((s) => s.summary);
  const summaryAt = useReminderPrefs((s) => s.summaryAt);
  const native = isNative();
  const enable = async (patch: Partial<ReminderPrefs>) => {
    setReminderPrefs(patch);
    if ((patch.timed || patch.summary) && !(await requestReminderPermission())) {
      toast("Allow notifications for Todo in Android settings to get reminders.");
    }
  };
  const time = `${String(Math.floor(summaryAt / 60)).padStart(2, "0")}:${String(summaryAt % 60).padStart(2, "0")}`;
  if (!native) {
    return (
      <Group title="Reminders">
        <Item title="Reminders arrive on your phone" detail="Turn them on in the Todo Android app. They work offline, even with the app closed." />
      </Group>
    );
  }
  return (
    <Group title="Reminders" description="On this phone. They work offline, even with the app closed.">
      <Item title="Before timed tasks" detail="A notification before each task with a start time.">
        <Switch checked={timed} label="Before timed tasks" onChange={(v) => void enable({ timed: v })} />
      </Item>
      {timed && (
        <Item title="How early">
          <Segmented
            size="sm"
            value={String(lead)}
            onChange={(v) => setReminderPrefs({ lead: Number(v) })}
            options={LEAD_OPTIONS.map((m) => ({ value: String(m), label: m === 0 ? "At start" : m === 60 ? "1 h" : `${m}m` }))}
          />
        </Item>
      )}
      <Item title="Morning summary" detail="What’s on today, once a day.">
        {summary && (
          <input
            type="time"
            value={time}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (Number.isFinite(h) && Number.isFinite(m)) setReminderPrefs({ summaryAt: h * 60 + m });
            }}
            className="h-[26px] rounded-[calc(var(--radius-ctl)_-_1px)] bg-fill px-2 text-xs tabular-nums outline-none"
            aria-label="Summary time"
          />
        )}
        <Switch checked={summary} label="Morning summary" onChange={(v) => void enable({ summary: v })} />
      </Item>
    </Group>
  );
}

function DataSection() {
  const [busy, setBusy] = useState(false);
  const user = useWorkspace((s) => s.user);
  const run = async () => {
    const first = await confirmDialog({
      title: "Delete all workspace data?",
      message: user
        ? "Every task, subject, note and setting will be deleted from all your signed-in devices."
        : "Every task, subject, note and setting on this device will be deleted.",
      confirmLabel: "Continue",
      destructive: true,
    });
    if (!first) return;
    const typed = await promptDialog({
      title: "Type DELETE to continue",
      placeholder: "DELETE",
      confirmLabel: "Next",
      validate: (v) => v === "DELETE",
    });
    if (typed !== "DELETE") return;
    const a = 3 + Math.floor(Math.random() * 7);
    const b = 4 + Math.floor(Math.random() * 8);
    const answer = await promptDialog({
      title: "Final check",
      message: `What is ${a} + ${b}?`,
      placeholder: "Answer",
      confirmLabel: "Delete everything",
      validate: (v) => Number(v) === a + b,
    });
    if (answer == null || Number(answer) !== a + b) return;
    setBusy(true);
    try {
      await clearWorkspace();
      toast("Workspace deleted");
    } catch (error) {
      toast(
        error instanceof UploadPendingError
          ? "Deleted on this device. Your other devices follow once it uploads."
          : `Couldn’t delete: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title="Data">
      <Item title="Delete workspace data" detail="Removes everything. This can’t be undone.">
        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" disabled={busy} onClick={() => void run()}>
          Delete…
        </Button>
      </Item>
    </Group>
  );
}

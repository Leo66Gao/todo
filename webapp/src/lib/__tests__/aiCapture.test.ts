import { afterEach, expect, it, vi } from "vitest";
import { mergeAiTask, parseAiTask, smartAdd, tasksFromPhoto } from "../aiCapture";
import { newTask, useWorkspace } from "@/store/workspace";
import { useAiKey } from "../ai";

const ai = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock("../ai", async (original) => ({ ...await original<typeof import("../ai")>(), chatJson: ai.answer }));
vi.mock("@/ui/toast", () => ({ toast: vi.fn() }));
vi.mock("../photoData", () => ({ photoDataUrl: async () => "data:image/jpeg;base64,AAAA" }));

afterEach(() => { useWorkspace.setState({ user: null, tasks: [], projects: [] }); ai.answer.mockReset(); });

it("preserves each manually edited field while filling untouched fields", () => {
  const original = newTask({ title: "Essay Friday", date: new Date(2026, 8, 30), durationMinutes: 30, remainingMinutes: 30 });
  const edited = { ...original, date: new Date(2026, 10, 4), durationMinutes: 90, remainingMinutes: 80, difficulty: 4, priority: "high" as const };
  const next = mergeAiTask(original, edited, { title: "Essay", date: "2026-10-02", minutes: 60, difficulty: 2, priority: "low" });
  expect(next).toMatchObject({ title: "Essay", date: edited.date, durationMinutes: 90, remainingMinutes: 80, difficulty: 4, priority: "high" });
});

it("bounds and validates generated tasks before applying them", () => {
  expect(() => parseAiTask(null)).toThrow("invalid task");
  const parsed = parseAiTask({ title: 42, minutes: "20", subtasks: [null, { title: 42 }, { title: "Real subtask" }] });
  expect(parsed.title).toBeUndefined();
  expect(parsed.minutes).toBeUndefined();
  expect(parsed.subtasks).toEqual([{ title: "Real subtask", date: null }]);
  const task = newTask({ title: "Test", date: new Date(2026, 8, 30) });
  expect(mergeAiTask(task, task, { date: "2026-02-31", time: "29:99" }).date).toEqual(task.date);
});

it.each(["switch", "delete"])("cancels photo results when the account or placeholder changes: %s", async (action) => {
  useAiKey.setState({ key: "fake" });
  let resolve!: (value: unknown) => void;
  ai.answer.mockImplementation(() => new Promise((r) => { resolve = r; }));
  useWorkspace.setState({ user: { uid: "A", email: null, displayName: null, photoURL: null } });
  tasksFromPhoto({} as File, {});
  await vi.waitFor(() => expect(ai.answer).toHaveBeenCalled());
  if (action === "switch") useWorkspace.setState({ user: { uid: "B", email: null, displayName: null, photoURL: null }, tasks: [] });
  else useWorkspace.setState({ tasks: [] });
  resolve({ tasks: [{ title: "First" }, { title: "Private second task" }] });
  await new Promise((r) => setTimeout(r, 0));
  expect(useWorkspace.getState().tasks).toEqual([]);
  expect(ai.answer.mock.calls[0][1].aborted).toBe(true);
});

it("sends the photo itself to the AI", async () => {
  useAiKey.setState({ key: "fake" });
  ai.answer.mockResolvedValue({ tasks: [{ title: "Essay", type: "assignment" }] });
  tasksFromPhoto({} as File, {});
  await vi.waitFor(() => expect(useWorkspace.getState().tasks[0]?.title).toBe("Essay"));
  const [, user] = ai.answer.mock.calls[0][0];
  expect(user.content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
});

it("keeps a manual title and duration changed during smart add", async () => {
  useAiKey.setState({ key: "fake" });
  let resolve!: (value: unknown) => void;
  ai.answer.mockImplementation(() => new Promise((r) => { resolve = r; }));
  smartAdd("Essay Friday", {});
  const task = useWorkspace.getState().tasks[0];
  useWorkspace.setState({ tasks: [{ ...task, title: "My title", durationMinutes: 120 }] });
  resolve({ title: "AI title", minutes: 30 });
  await new Promise((r) => setTimeout(r, 0));
  expect(useWorkspace.getState().tasks[0]).toMatchObject({ title: "My title", durationMinutes: 120 });
});

import { afterEach, expect, it, vi } from "vitest";
import { milestoneId, milestonesOf, newTask, patchTask, useWorkspace } from "@/store/workspace";

vi.mock("@/ui/toast", () => ({ toast: vi.fn() }));

afterEach(() => useWorkspace.setState({ user: null, tasks: [], side: {} }));

it("gives a planned step its estimate, and keeps the time left after focusing", () => {
  const essay = newTask({
    title: "Essay",
    date: new Date(2026, 9, 30),
    subtasks: [{ id: "s1", title: "Outline", isDone: false, date: new Date(2026, 9, 20), priority: null, difficulty: null, extra: { minutes: 90 } }],
  });
  useWorkspace.setState({ tasks: [essay] });
  const [step] = milestonesOf(useWorkspace.getState().tasks);
  expect(step).toMatchObject({ durationMinutes: 90, remainingMinutes: 0 });
  // 40 minutes of focus on it.
  patchTask(milestoneId(essay.id, "s1"), { remainingMinutes: 50 });
  expect(milestonesOf(useWorkspace.getState().tasks)[0]).toMatchObject({ durationMinutes: 90, remainingMinutes: 50 });
  expect(useWorkspace.getState().tasks[0].subtasks[0].extra).toEqual({ minutes: 90, remainingMinutes: 50 });
});

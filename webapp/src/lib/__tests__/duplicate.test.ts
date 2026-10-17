import { afterEach, expect, it, vi } from "vitest";
import { duplicateTask } from "@/features/tasks/actions";
import { newTask, useWorkspace } from "@/store/workspace";

vi.mock("@/ui/toast", () => ({ toast: vi.fn() }));

afterEach(() => useWorkspace.setState({ user: null, tasks: [], side: {} }));

it("moves a duplicated assignment's milestones with it", () => {
  const essay = newTask({
    title: "Essay",
    type: "assignment",
    date: new Date(2026, 9, 20),
    subtasks: [
      { id: "a", title: "Outline", isDone: true, date: new Date(2026, 9, 10), priority: null, difficulty: null },
      { id: "b", title: "Sources", isDone: false, date: null, priority: null, difficulty: null },
    ],
  });
  useWorkspace.setState({ tasks: [essay] });
  duplicateTask(essay, new Date(2026, 10, 20));
  const copy = useWorkspace.getState().tasks.find((t) => t.id !== essay.id)!;
  expect(copy.subtasks.map((s) => s.date?.toDateString() ?? null)).toEqual([new Date(2026, 10, 10).toDateString(), null]);
  expect(copy.subtasks.every((s) => !s.isDone)).toBe(true);
});

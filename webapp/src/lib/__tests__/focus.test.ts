import { describe, expect, it } from "vitest";
import { pomodoroBlocks } from "../focus";

const minutes = (blocks: ReturnType<typeof pomodoroBlocks>) => blocks.map((b) => `${b.kind[0]}${b.ms / 60_000}`);

describe("pomodoroBlocks", () => {
  it("splits a task's time into 40-minute rounds with 5-minute breaks between", () => {
    expect(minutes(pomodoroBlocks(100))).toEqual(["f40", "b5", "f40", "b5", "f20"]);
  });
  it("keeps a short task to one round and no break", () => {
    expect(minutes(pomodoroBlocks(30))).toEqual(["f30"]);
    expect(minutes(pomodoroBlocks(40))).toEqual(["f40"]);
  });
});

it("hands the phone's timer every round, and takes back what it did", async () => {
  const { fromNative, pomodoroBlocks, toNative } = await import("../focus");
  const blocks = pomodoroBlocks(90);
  const session = {
    taskId: "t",
    title: "Essay",
    length: blocks[0].ms + 5 * 60_000,
    endsAt: 1_000_000,
    left: null,
    kind: "focus" as const,
    plan: { blocks, index: 0 },
  };
  const native = toNative(session);
  // "+5 min" on this round goes with it.
  expect(native.blocks[0].ms).toBe(45 * 60_000);
  expect(native).toMatchObject({ title: "Essay", index: 0, endsAt: 1_000_000, paused: false });
  // Paused from the notification on the break.
  const back = fromNative({ ...native, index: 1, endsAt: 0, left: 120_000, paused: true }, session);
  expect(back).toMatchObject({ taskId: "t", kind: "break", endsAt: null, left: 120_000, length: 5 * 60_000 });
  expect(back.plan?.index).toBe(1);
  // A single session has no plan.
  const single = toNative({ ...session, plan: null, length: 25 * 60_000 });
  expect(single.blocks).toEqual([{ kind: "focus", ms: 25 * 60_000 }]);
  expect(fromNative(single, null).plan).toBeNull();
});

it("counts focus time but not breaks", async () => {
  const { focusedMs, pomodoroBlocks } = await import("../focus");
  const blocks = pomodoroBlocks(100); // f40 b5 f40 b5 f20
  const now = 1_000_000;
  const min = 60_000;
  // Ten minutes into the second focus round.
  const second = { taskId: "t", title: "Essay", length: 40 * min, endsAt: now + 30 * min, left: null, kind: "focus" as const, plan: { blocks, index: 2 } };
  expect(focusedMs(second, now)).toBe(50 * min);
  // Two minutes into the first break.
  const onBreak = { ...second, kind: "break" as const, length: 5 * min, endsAt: now + 3 * min, plan: { blocks, index: 1 } };
  expect(focusedMs(onBreak, now)).toBe(40 * min);
  // Paused with 5 of 25 minutes left, no plan.
  expect(focusedMs({ taskId: null, title: "", length: 25 * min, endsAt: null, left: 5 * min, kind: "focus" }, now)).toBe(20 * min);
});

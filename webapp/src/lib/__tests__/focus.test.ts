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

import { expect, it } from "vitest";
import { VERSION_GAP, withVersion, type Version } from "../versions";

const note = (content: string) => ({ title: "Essay", content: JSON.stringify([{ insert: `${content}\n` }]) });

it("keeps at most one version every ten minutes, and never a repeat", () => {
  let history: Version[] = [];
  history = withVersion(history, note("draft one"), 0)!;
  expect(history).toHaveLength(1);
  expect(withVersion(history, note("draft two"), VERSION_GAP - 1)).toBeNull();
  expect(withVersion(history, note("draft one"), VERSION_GAP * 2)).toBeNull();
  history = withVersion(history, note("draft two"), VERSION_GAP)!;
  expect(history.map((v) => v.at)).toEqual([VERSION_GAP, 0]);
  // Restoring forces a version of what's being replaced.
  expect(withVersion(history, note("draft three"), VERSION_GAP + 1, true)).toHaveLength(3);
  expect(withVersion([], { title: "", content: "" }, 0)).toBeNull();
});

it("drops the oldest versions to stay small enough to sync", () => {
  let history: Version[] = [];
  const big = "x".repeat(100_000);
  for (let i = 0; i < 10; i++) history = withVersion(history, note(`${i}${big}`), i * VERSION_GAP)!;
  expect(history.length).toBeLessThan(10);
  expect(JSON.stringify({ versions: history }).length).toBeLessThanOrEqual(600_000);
  expect(history[0].content).toContain("9x");
});

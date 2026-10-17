import { describe, expect, it } from "vitest";
import { mergeById, mergeRecord } from "@/lib/recordMerge";

const ids = (s: string) => s;
const j = JSON.stringify;

describe("mergeById", () => {
  it("keeps additions from both sides, each after its neighbour", () => {
    expect(mergeById(["a", "x", "b"], ["a", "b"], ["a", "b", "y"], ids)).toEqual(["a", "x", "b", "y"]);
  });

  it("keeps removals from both sides", () => {
    expect(mergeById(["a", "c"], ["a", "b", "c"], ["a", "b"], ids)).toEqual(["a"]);
  });

  it("keeps this device's order for items both have", () => {
    expect(mergeById(["c", "a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"], ids)).toEqual(["c", "d", "a", "b"]);
  });

  it("without a base, takes everything from both", () => {
    expect(mergeById(["a", "x"], null, ["y", "a"], ids)).toEqual(["y", "a", "x"]);
  });
});

describe("mergeRecord", () => {
  it("merges tags", () => {
    expect(JSON.parse(mergeRecord("settings:tags", j(["exam", "lab"]), j(["exam"]), j(["exam", "reading"]))!)).toEqual(["exam", "reading", "lab"]);
  });

  it("merges the source library by id; this device's edit wins", () => {
    const local = { style: "apa", sources: [{ id: "1", title: "Mine" }, { id: "2", title: "New here" }] };
    const base = { style: "mla", sources: [{ id: "1", title: "Old" }] };
    const remote = { style: "mla", sources: [{ id: "3", title: "New there" }, { id: "1", title: "Theirs" }] };
    expect(JSON.parse(mergeRecord("settings:sources", j(local), j(base), j(remote))!)).toEqual({
      style: "apa",
      sources: [{ id: "3", title: "New there" }, { id: "1", title: "Mine" }, { id: "2", title: "New here" }],
    });
  });

  it("keeps the other device's edit to a source this device didn't change", () => {
    const base = { style: "mla", sources: [{ id: "A", title: "Typo" }] };
    const local = { style: "mla", sources: [{ id: "A", title: "Typo" }, { id: "B", title: "New here" }] };
    const remote = { style: "mla", sources: [{ id: "A", title: "Fixed" }] };
    expect(JSON.parse(mergeRecord("settings:sources", j(local), j(base), j(remote))!).sources).toEqual([
      { id: "A", title: "Fixed" },
      { id: "B", title: "New here" },
    ]);
  });

  it("merges note history newest first, each version once", () => {
    const v = (at: number) => ({ at, title: "T", content: String(at) });
    const merged = JSON.parse(mergeRecord("settings:versions:n", j({ versions: [v(3), v(1)] }), null, j({ versions: [v(2), v(1)] }))!);
    expect(merged.versions.map((x: { at: number }) => x.at)).toEqual([3, 2, 1]);
  });

  it("leaves workspace preferences and unreadable values to the conflict copy", () => {
    expect(mergeRecord("settings:workspace", j({ a: 1 }), null, j({ a: 2 }))).toBeNull();
    expect(mergeRecord("settings:order", "not json", null, j(["a"]))).toBeNull();
    expect(mergeRecord("settings:order", j({ a: 1 }), null, j(["a"]))).toBeNull();
  });
});

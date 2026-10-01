import { expect, it } from "vitest";
import { countWords } from "../words";

it("counts words as essay limits do", () => {
  expect(countWords("")).toBe(0);
  expect(countWords("  The quick brown fox.  ")).toBe(4);
  expect(countWords("It's a well-known fact — 42 of them.")).toBe(7);
  expect(countWords("Line one\nLine two\n")).toBe(4);
  expect(countWords("Größe und Übermaß")).toBe(3);
  expect(countWords("… — – !")).toBe(0);
});

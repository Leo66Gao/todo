import { expect, it } from "vitest";
import { nextQuotaReset, syncFailure } from "../syncPolicy";
import { payloadFits, recoveryRecords } from "../recordRecovery";

it("waits for the Pacific quota reset through daylight saving transitions", () => {
  expect(new Date(nextQuotaReset(Date.parse("2026-03-08T12:00:00Z"))).toISOString()).toBe("2026-03-09T07:01:00.000Z");
  expect(new Date(nextQuotaReset(Date.parse("2026-11-01T12:00:00Z"))).toISOString()).toBe("2026-11-02T08:01:00.000Z");
  const now = Date.parse("2026-09-30T12:00:00Z");
  expect(syncFailure(Object.assign(new Error("Free daily read units quota exceeded"), { code: "resource-exhausted" }), 0, now).retryAt).toBe(nextQuotaReset(now));
  expect(syncFailure(new Error("temporary connection error"), 0, now).retryAt).toBe(now + 15_000);
  expect(syncFailure(new Error("temporary connection error"), 8, now).retryAt).toBe(now + 300_000);
});

it("preserves escape-heavy conflicts in bounded parts without truncation", () => {
  const payload = JSON.stringify({ versions: ["\\\"".repeat(180_000)] });
  const copies = recoveryRecords("settings:versions:n", payload, "operation");
  expect(copies.every(([, value]) => payloadFits(value))).toBe(true);
  expect(copies.map(([, value]) => JSON.parse(value).content).join("")).toBe(payload);
});

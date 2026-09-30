/** Firebase quotas reset at midnight Pacific time, including daylight saving. */
export function nextQuotaReset(now = Date.now()): number {
  const zone = "America/Los_Angeles";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let midnight = Date.UTC(get("year"), get("month") - 1, get("day") + 1, 8);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(midnight));
  if (hour === 1) midnight -= 3600_000;
  return midnight + 60_000;
}

export function syncFailure(error: unknown, attempt: number, now = Date.now()) {
  const raw = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error ? String(error.code).replace(/^firestore\//, "") : "unknown";
  if (code === "resource-exhausted" || /quota.*exceeded|resource.exhausted/i.test(raw)) {
    const daily = /daily|per.day|free.*read.*units/i.test(raw);
    return {
      retryAt: daily ? nextQuotaReset(now) : now + 30 * 60_000,
      reason: "quota" as const,
      message: daily ? "Firestore’s daily quota is exhausted. Changes remain on this device and will upload after the quota resets." : "Firestore is limiting requests. Changes remain on this device; sync is paused before retrying.",
    };
  }
  if (code === "permission-denied" || code === "unauthenticated") {
    return { retryAt: now + 5 * 60_000, reason: "auth" as const, message: "Cloud access was refused. Your device copy is safe; check your signed-in account." };
  }
  return { retryAt: now + Math.min(300_000, 15_000 * 2 ** Math.min(attempt, 5)), reason: "connection" as const, message: raw };
}

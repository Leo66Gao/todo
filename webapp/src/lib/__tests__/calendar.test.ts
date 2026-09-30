import { afterEach, expect, it, vi } from "vitest";

it("loads every calendar-list page", async () => {
  const { GoogleCalendar } = await import("../calendar");
  const client = new GoogleCalendar();
  client.connectWithAccessToken("owner@example.com", "fake", "owner");
  const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "one" }], nextPageToken: "next-page" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "two" }] })));
  vi.stubGlobal("fetch", request);
  expect((await client.listCalendars()).map((c) => c.id)).toEqual(["one", "two"]);
  expect(new URL(request.mock.calls[1][0]).searchParams.get("pageToken")).toBe("next-page");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("rejects another account's cached token without opening Google account UI", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID", "test-client");
  const requestAccessToken = vi.fn();
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
  vi.stubGlobal("window", {
    localStorage: storage,
    google: {
      accounts: {
        oauth2: {
          initTokenClient: () => ({ requestAccessToken }),
        },
      },
    },
  });
  const fetchMock = vi.fn(async (input: string) => {
    const token = new URL(input).searchParams.get("access_token");
    return new Response(JSON.stringify({ email: token === "cached-token" ? "other@example.com" : "owner@example.com" }), {
      status: 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const prefs = await import("../prefs");
  const { GoogleCalendar } = await import("../calendar");
  prefs.setString("calendar.webSession.user-1", JSON.stringify({
    token: "cached-token",
    email: "owner@example.com",
    expiry: new Date(Date.now() + 3600_000).toISOString(),
  }));

  const calendar = new GoogleCalendar();
  expect(await calendar.authorize({ interactive: false, email: "owner@example.com", uid: "user-1" }))
    .toBeNull();
  expect(calendar.isConnected).toBe(false);
  expect(prefs.getString("calendar.webSession.user-1")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(requestAccessToken).not.toHaveBeenCalled();
});

it("pauses Calendar after token expiry without opening Google account UI", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID", "test-client");
  const requestAccessToken = vi.fn();
  const items = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value); },
      removeItem: (key: string) => { items.delete(key); },
    },
    google: { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken }) } } },
  });
  const { GoogleCalendar } = await import("../calendar");
  const calendar = new GoogleCalendar();
  calendar.connectWithAccessToken("owner@example.com", "old-token", "user-1");
  vi.advanceTimersByTime(54 * 60_000);

  expect(calendar.isConnected).toBe(false);
  await expect(calendar.listCalendars()).rejects.toMatchObject({ status: 401 });
  expect(requestAccessToken).not.toHaveBeenCalled();
});

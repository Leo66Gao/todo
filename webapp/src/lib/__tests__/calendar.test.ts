import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("rejects a cached Calendar token for another Google account", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID", "test-client");
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
          initTokenClient: (config: { callback: (response: { access_token: string; expires_in: number }) => void }) => ({
            requestAccessToken: () => config.callback({ access_token: "replacement-token", expires_in: 3600 }),
          }),
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
    .toBe("owner@example.com");
  expect(calendar.isConnected).toBe(true);
  expect(JSON.parse(prefs.getString("calendar.webSession.user-1")!).token).toBe("replacement-token");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

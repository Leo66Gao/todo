import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("keeps web appearance on this device when synced workspace settings change", async () => {
  const items = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value); },
    },
  });

  const { restoreAppearance, setThemeMode, useAppearance } = await import("../appearance");
  const { useWorkspace } = await import("@/store/workspace");
  const { defaultSettings } = await import("../model");

  restoreAppearance();
  setThemeMode("dark");
  expect(items.get("todo.web.theme")).toBe('"dark"');
  expect(useWorkspace.getState().settings.themeMode).toBe("system");

  useWorkspace.setState({ settings: { ...defaultSettings(), themeMode: "light" } });
  expect(useAppearance.getState().themeMode).toBe("dark");
  restoreAppearance();
  expect(useAppearance.getState().themeMode).toBe("dark");
});

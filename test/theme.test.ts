import { describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "../src/lib/settings";
import { applyTheme, resolveTheme } from "../src/lib/theme";

describe("theme", () => {
  it("resolves an explicit choice and falls back to the system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("defaults to the system theme and persists an explicit choice", () => {
    expect(loadSettings().theme).toBe("system");

    saveSettings({ ...loadSettings(), theme: "light" });

    expect(loadSettings().theme).toBe("light");
  });

  it("ignores an unknown stored theme", () => {
    localStorage.setItem("github-ui.theme", "sepia");

    expect(loadSettings().theme).toBe("system");
  });

  it("applies the resolved theme to the document", () => {
    applyTheme("light");

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

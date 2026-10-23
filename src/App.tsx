import { useEffect, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { TokenSetup } from "./components/TokenSetup";
import { clearToken, loadSettings, saveSettings, type Settings } from "./lib/settings";
import { applyTheme, resolveTheme, systemPrefersDark } from "./lib/theme";

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [prefersDark, setPrefersDark] = useState(() => systemPrefersDark());
  const theme = resolveTheme(settings.theme, prefersDark);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (): void => setPrefersDark(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const save = (next: Settings): void => {
    setSettings(next);
    saveSettings(next);
  };

  const toggleTheme = (): void => {
    save({ ...settings, theme: theme === "dark" ? "light" : "dark" });
  };

  if (!settings.token) {
    return <TokenSetup theme={theme} onToggleTheme={toggleTheme} onSave={(token) => save({ ...settings, token })} />;
  }

  return (
    <Dashboard
      settings={settings}
      onChange={save}
      theme={theme}
      onToggleTheme={toggleTheme}
      onSignOut={() => {
        clearToken();
        save({ ...settings, token: "" });
      }}
    />
  );
}

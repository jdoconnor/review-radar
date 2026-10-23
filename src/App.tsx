import { useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { TokenSetup } from "./components/TokenSetup";
import { clearToken, loadSettings, saveSettings, type Settings } from "./lib/settings";

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  const save = (next: Settings): void => {
    setSettings(next);
    saveSettings(next);
  };

  if (!settings.token) {
    return <TokenSetup onSave={(token) => save({ ...settings, token })} />;
  }

  return (
    <Dashboard
      initial={settings}
      onSignOut={() => {
        clearToken();
        save({ ...settings, token: "" });
      }}
    />
  );
}

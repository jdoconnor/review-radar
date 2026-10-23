import type { ThemePreference } from "./theme";

export interface Settings {
  token: string;
  refreshSeconds: number;
  defaultTab: "review" | "mine";
  theme: ThemePreference;
}

const TOKEN_KEY = "review-radar.token";
const REFRESH_KEY = "review-radar.refresh-seconds";
const TAB_KEY = "review-radar.default-tab";
const THEME_KEY = "review-radar.theme";
const LAST_SEEN_KEY = "review-radar.last-seen";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota or a locked-down browser: the in-memory state still works.
  }
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadSettings(): Settings {
  const refresh = Number(read(REFRESH_KEY));
  const tab = read(TAB_KEY);
  const theme = read(THEME_KEY);
  return {
    token: read(TOKEN_KEY) ?? "",
    refreshSeconds: Number.isFinite(refresh) && refresh >= 15 ? refresh : 60,
    defaultTab: tab === "mine" ? "mine" : "review",
    theme: theme === "light" || theme === "dark" ? theme : "system",
  };
}

export function saveSettings(settings: Settings): void {
  if (settings.token) write(TOKEN_KEY, settings.token);
  else remove(TOKEN_KEY);
  write(REFRESH_KEY, String(settings.refreshSeconds));
  write(TAB_KEY, settings.defaultTab);
  write(THEME_KEY, settings.theme);
}

export function clearToken(): void {
  remove(TOKEN_KEY);
}

type LastSeenMap = Record<string, number>;

function readLastSeen(): LastSeenMap {
  const raw = read(LAST_SEEN_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const result: LastSeenMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function lastSeenFor(key: string): number | null {
  return readLastSeen()[key] ?? null;
}

export function markSeen(key: string, at = Date.now()): void {
  const map = readLastSeen();
  map[key] = at;
  write(LAST_SEEN_KEY, JSON.stringify(map));
}

export function markManySeen(keys: string[], at = Date.now()): void {
  const map = readLastSeen();
  for (const key of keys) map[key] = at;
  write(LAST_SEEN_KEY, JSON.stringify(map));
}

export function clearLastSeen(): void {
  remove(LAST_SEEN_KEY);
}

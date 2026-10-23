import { useCallback, useEffect, useMemo, useState } from "react";
import { useCachedQuery } from "../hooks/useCachedQuery";
import { clearCache, pruneCache } from "../lib/cache";
import { pullRequests, queryFor, variablesFor } from "../lib/queries";
import { markSeen, clearLastSeen, lastSeenFor } from "../lib/settings";
import { toSummary } from "../lib/normalize";
import type { SearchPayload } from "../lib/types";
import type { Settings } from "../lib/settings";
import type { ResolvedTheme, ThemePreference } from "../lib/theme";
import { PullRequestList } from "./PullRequestList";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onSignOut: () => void;
}

export function Dashboard({ settings, onChange, theme, onToggleTheme, onSignOut }: Props) {
  const [tab, setTab] = useState<Settings["defaultTab"]>(settings.defaultTab);
  const [seenVersion, setSeenVersion] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const viewer = (() => {
    try {
      return sessionStorage.getItem("github-ui.viewer");
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    void pruneCache();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const reviewQuery = useCachedQuery<SearchPayload>({
    enabled: true,
    token: settings.token,
    query: queryFor("review"),
    variables: variablesFor("review"),
    refreshSeconds: settings.refreshSeconds,
  });

  const mineQuery = useCachedQuery<SearchPayload>({
    enabled: true,
    token: settings.token,
    query: queryFor("mine"),
    variables: variablesFor("mine"),
    refreshSeconds: settings.refreshSeconds,
  });

  const reviewItems = useMemo(() => {
    void seenVersion;
    if (!reviewQuery.data) return [];
    return pullRequests(reviewQuery.data).map((pr) =>
      toSummary(pr, { lastSeenAt: null, reviewRequestedFromMe: true }),
    );
  }, [reviewQuery.data, seenVersion]);

  const mineItems = useMemo(() => {
    void seenVersion;
    if (!mineQuery.data) return [];
    return pullRequests(mineQuery.data).map((pr) => {
      const key = `${pr.repository.nameWithOwner}#${pr.number}`;
      return toSummary(pr, { lastSeenAt: lastSeenFor(key), reviewRequestedFromMe: false });
    });
  }, [mineQuery.data, seenVersion]);

  const onMarkSeen = useCallback((key: string) => {
    markSeen(key);
    setSeenVersion((value) => value + 1);
  }, []);

  const refreshAll = useCallback(() => {
    reviewQuery.refresh();
    mineQuery.refresh();
  }, [reviewQuery, mineQuery]);

  const active = tab === "review" ? reviewQuery : mineQuery;
  const rateLimit = active.rateLimit;
  const resetAt = rateLimit?.resetAt ? new Date(rateLimit.resetAt) : null;

  // A token change is a user change. Never let the next person on this browser
  // inherit the previous person's cached pull requests or last-seen marks.
  const resetLocalData = useCallback(async (): Promise<void> => {
    await clearCache();
    clearLastSeen();
    setSeenVersion((value) => value + 1);
  }, []);

  const saveToken = async (token: string): Promise<void> => {
    await resetLocalData();
    onChange({ ...settings, token });
    setShowSettings(false);
  };

  const signOut = (): void => {
    void resetLocalData().finally(onSignOut);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◉
          </span>
          <div>
            <strong>Review Radar</strong>
            <span className="brand-sub">{viewer ? `@${viewer}` : "github-ui"}</span>
          </div>
        </div>

        <nav className="tabs" aria-label="Views">
          <button
            type="button"
            className={`tab ${tab === "review" ? "active" : ""}`}
            aria-current={tab === "review" ? "page" : undefined}
            onClick={() => setTab("review")}
            data-testid="tab-review"
          >
            Needs my review
            {reviewItems.length > 0 ? <span className="count">{reviewItems.length}</span> : null}
          </button>
          <button
            type="button"
            className={`tab ${tab === "mine" ? "active" : ""}`}
            aria-current={tab === "mine" ? "page" : undefined}
            onClick={() => setTab("mine")}
            data-testid="tab-mine"
          >
            My pull requests
            {mineItems.length > 0 ? <span className="count">{mineItems.length}</span> : null}
          </button>
        </nav>

        <div className="topbar-actions">
          {!online ? (
            <span className="pill offline" data-testid="offline">
              Offline
            </span>
          ) : null}
          {active.fromCache ? (
            <span className="pill cached" data-testid="cache-indicator" title="Rendered from the local cache">
              Cached
            </span>
          ) : null}
          {rateLimit ? (
            <span
              className={`ratelimit ${rateLimit.remaining < 100 ? "low" : ""}`}
              title={resetAt ? `Resets ${resetAt.toLocaleTimeString()}` : "GitHub GraphQL rate limit"}
              data-testid="rate-limit-indicator"
            >
              {rateLimit.remaining.toLocaleString()}/{rateLimit.limit.toLocaleString()}
            </span>
          ) : null}
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button type="button" className="button tiny" onClick={refreshAll} data-testid="refresh-all">
            Refresh
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Settings"
            onClick={() => setShowSettings(true)}
            data-testid="open-settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="content">
        {tab === "review" ? (
          <PullRequestList
            kind="review"
            items={reviewItems}
            loading={reviewQuery.loading}
            refreshing={reviewQuery.refreshing}
            error={reviewQuery.error}
            warning={reviewQuery.warning}
            stale={reviewQuery.stale}
            fromCache={reviewQuery.fromCache}
            lastUpdated={reviewQuery.lastUpdated}
            onMarkSeen={onMarkSeen}
            onRefresh={reviewQuery.refresh}
          />
        ) : (
          <PullRequestList
            kind="mine"
            items={mineItems}
            loading={mineQuery.loading}
            refreshing={mineQuery.refreshing}
            error={mineQuery.error}
            warning={mineQuery.warning}
            stale={mineQuery.stale}
            fromCache={mineQuery.fromCache}
            lastUpdated={mineQuery.lastUpdated}
            onMarkSeen={onMarkSeen}
            onRefresh={mineQuery.refresh}
          />
        )}
      </main>

      {showSettings ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowSettings(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id="settings-title">Settings</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close settings"
                onClick={() => setShowSettings(false)}
              >
                ×
              </button>
            </div>
            <SettingsForm
              settings={settings}
              onSaveToken={(token) => void saveToken(token)}
              onRefreshChange={(refreshSeconds) => onChange({ ...settings, refreshSeconds })}
              onThemeChange={(nextTheme) => onChange({ ...settings, theme: nextTheme })}
              onClearCache={() => void resetLocalData()}
              onSignOut={signOut}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SettingsForm({
  settings,
  onSaveToken,
  onRefreshChange,
  onThemeChange,
  onClearCache,
  onSignOut,
}: {
  settings: Settings;
  onSaveToken: (token: string) => void;
  onRefreshChange: (seconds: number) => void;
  onThemeChange: (theme: ThemePreference) => void;
  onClearCache: () => void;
  onSignOut: () => void;
}) {
  const [token, setToken] = useState("");
  return (
    <div className="settings-form">
      <label htmlFor="new-token">Replace token</label>
      <div className="inline">
        <input
          id="new-token"
          type="password"
          placeholder="github_pat_…"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
        />
        <button type="button" className="button primary" disabled={!token.trim()} onClick={() => onSaveToken(token.trim())}>
          Save
        </button>
      </div>

      <label htmlFor="refresh-seconds">Auto-refresh</label>
      <select
        id="refresh-seconds"
        value={settings.refreshSeconds}
        onChange={(event) => onRefreshChange(Number(event.target.value))}
      >
        <option value={30}>every 30 seconds</option>
        <option value={60}>every minute</option>
        <option value={120}>every 2 minutes</option>
        <option value={300}>every 5 minutes</option>
        <option value={900}>every 15 minutes</option>
      </select>

      <label htmlFor="theme">Theme</label>
      <select
        id="theme"
        value={settings.theme}
        onChange={(event) => onThemeChange(event.target.value as ThemePreference)}
        data-testid="theme-select"
      >
        <option value="system">Match system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>

      <div className="settings-actions">
        <button type="button" className="button tiny" onClick={onClearCache} data-testid="clear-cache">
          Clear local cache
        </button>
        <button type="button" className="button tiny danger" onClick={onSignOut} data-testid="sign-out">
          Sign out
        </button>
      </div>
      <p className="hint">The token stays in this browser. Clearing the cache removes responses, not the token.</p>
    </div>
  );
}

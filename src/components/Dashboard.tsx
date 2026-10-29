import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCachedQuery } from "../hooks/useCachedQuery";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cacheStats, clearCache, pruneCacheIfDue, type CacheStats } from "../lib/cache";
import { pullRequests, queryFor, variablesFor } from "../lib/queries";
import { markSeen, clearLastSeen, lastSeenFor, baselineFor, ensureBaseline } from "../lib/settings";
import {
  countMergeReadiness,
  pullRequestKey,
  stackParents,
  toSummary,
  clockTime,
} from "../lib/normalize";
import type { SearchPayload } from "../lib/types";
import type { Settings } from "../lib/settings";
import type { ResolvedTheme, ThemePreference } from "../lib/theme";
import { loadFilterDefaults, saveFilterDefaults } from "../lib/filterDefaults";
import { DEFAULT_SORT, EMPTY_FILTERS, isSortOrder, ListToolbar } from "./ListToolbar";
import type { Filters, SortOrder } from "./ListToolbar";
import { PullRequestList } from "./PullRequestList";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onSignOut: () => void;
}

/** Keep text and repo filters from splitting on the hash's "/" and ":" separators. */
function encodeHashPart(value: string): string {
  return encodeURIComponent(value);
}

function decodeHashPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A hand-edited or legacy hash can hold a stray "%"; show it verbatim.
    return value;
  }
}

export function Dashboard({ settings, onChange, theme, onToggleTheme, onSignOut }: Props) {
  const [tab, setTab] = useState<Settings["defaultTab"]>(settings.defaultTab);
  const [seenVersion, setSeenVersion] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<CacheStats | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [documentHidden, setDocumentHidden] = useState(typeof document === "undefined" ? true : document.hidden);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortOrder>(DEFAULT_SORT[settings.defaultTab]);
  const [hydrated, setHydrated] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const wide = useMediaQuery("(min-width: 68.75em)");

  // URL state persistence: read from location.hash on mount, write on tab/sort/filter changes.
  // This lets users share a URL and have the same view, and refresh preserves state.
  // Filter defaults are loaded from IndexedDB, then URL overrides are applied.
  // Effects are guarded with typeof window to avoid issues in test environments
  // (jsdom) where window.location may not behave like a browser.
  //
  // Nothing may be written until this read finishes. The first render still
  // holds the defaults, so an eager write would replace the saved hash with
  // "oldest" (the review queue default) before it could be read back.
  useEffect(() => {
    if (typeof window === "undefined") {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const defaults = await loadFilterDefaults();
      if (cancelled) return;
      const base = defaults ?? EMPTY_FILTERS;
      // Accept both "#/t:mine/..." (current) and "#t:mine/..." (written by
      // earlier versions, which forgot the slash and so could never read it).
      const raw = window.location.hash.replace(/^#\/?/, "");
      if (!raw) {
        setFilters(base);
        setTab(settings.defaultTab);
        setSort(DEFAULT_SORT[settings.defaultTab]);
        setHydrated(true);
        return;
      }
      const parts = raw.split("/");
      // Expected format: t:mine/q:review/s:attention/r:owner%2Frepo/f:failing,new
      const lookup: Record<string, string> = {};
      parts.forEach((part) => {
        const idx = part.indexOf(":");
        if (idx > 0) lookup[part.slice(0, idx)] = part.slice(idx + 1);
      });
      const mergedFilters: Filters = { ...base };
      const nextTab = lookup.t === "mine" ? "mine" : lookup.t ? "review" : settings.defaultTab;
      setTab(nextTab);
      if (lookup.s && isSortOrder(lookup.s)) {
        setSort(lookup.s);
      } else {
        // Old links stored s:default; fall back to the queue's real default.
        setSort(DEFAULT_SORT[nextTab]);
      }
      if (lookup.q !== undefined) mergedFilters.text = decodeHashPart(lookup.q);
      if (lookup.r !== undefined) mergedFilters.repo = decodeHashPart(lookup.r);
      if (lookup.f) {
        const flags = lookup.f.split(",");
        mergedFilters.onlyFailing = flags.includes("failing");
        mergedFilters.onlyChanges = flags.includes("changes");
        mergedFilters.onlyNew = flags.includes("new");
        mergedFilters.onlyDirect = flags.includes("direct");
        mergedFilters.onlyTeam = flags.includes("team");
        mergedFilters.onlyReady = flags.includes("ready");
      }
      setFilters(mergedFilters);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.defaultTab]); // initial load only; hash changes are rare

  // Persist filter defaults to IndexedDB whenever they change, so they
  // survive page reloads without needing a shared URL. Wait for the stored
  // defaults to load first, otherwise the initial empty state overwrites them.
  useEffect(() => {
    if (!hydrated) return;
    void saveFilterDefaults(filters);
  }, [hydrated, filters]);

  // Write URL hash when tab or sort changes, or when a quick filter chip is toggled.
  // We memoize the hash string so the effect doesn't fire on every re-render.
  const hashParts = useMemo(() => {
    const parts: string[] = [];
    parts.push(`t:${tab}`);
    parts.push(`q:${encodeHashPart(filters.text)}`);
    parts.push(`s:${sort}`);
    if (filters.repo) parts.push(`r:${encodeHashPart(filters.repo)}`);
    const flags: string[] = [];
    if (filters.onlyFailing) flags.push("failing");
    if (filters.onlyChanges) flags.push("changes");
    if (filters.onlyNew) flags.push("new");
    if (filters.onlyDirect) flags.push("direct");
    if (filters.onlyTeam) flags.push("team");
    if (filters.onlyReady) flags.push("ready");
    if (flags.length > 0) parts.push(`f:${flags.join(",")}`);
    return `#/${parts.join("/")}`;
  }, [
    tab,
    sort,
    filters.text,
    filters.repo,
    filters.onlyFailing,
    filters.onlyChanges,
    filters.onlyNew,
    filters.onlyDirect,
    filters.onlyTeam,
    filters.onlyReady,
  ]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.location.hash = hashParts;
  }, [hashParts, hydrated]); // only when the computed hash string changes

  const sessionViewer = (() => {
    try {
      return sessionStorage.getItem("review-radar.viewer");
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    const update = (): void => setDocumentHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    setDocumentHidden(document.hidden);
  }, [document.hidden]);

  const reviewQuery = useCachedQuery<SearchPayload>({
    enabled: true,
    token: settings.token,
    query: queryFor("review"),
    variables: variablesFor("review"),
    refreshSeconds: settings.refreshSeconds,
    active: tab === "review",
  });

  const mineQuery = useCachedQuery<SearchPayload>({
    enabled: true,
    token: settings.token,
    query: queryFor("mine"),
    variables: variablesFor("mine"),
    refreshSeconds: settings.refreshSeconds,
    active: tab === "mine",
  });

  const viewerLogin =
    reviewQuery.data?.viewer?.login ?? mineQuery.data?.viewer?.login ?? sessionViewer;

  const reviewItems = useMemo(() => {
    void seenVersion;
    if (!reviewQuery.data) return [];
    const nodes = pullRequests(reviewQuery.data);
    const parents = stackParents(nodes);
    return nodes.map((pr) =>
      toSummary(pr, {
        lastSeenAt: null,
        reviewRequestedFromMe: true,
        viewerLogin,
        stackedOn: parents.get(pullRequestKey(pr)) ?? null,
      }),
    );
  }, [reviewQuery.data, seenVersion, viewerLogin]);

  const mineItems = useMemo(() => {
    void seenVersion;
    if (!mineQuery.data) return [];
    const nodes = pullRequests(mineQuery.data);
    const parents = stackParents(nodes);
    // A pull request that has never been marked seen falls back to the first
    // time this browser started tracking activity. Without a fallback, a
    // missing mark reads as zero activity and the "N new" pill could never
    // turn on.
    const baseline = baselineFor();
    return nodes.map((pr) => {
      const key = pullRequestKey(pr);
      return toSummary(pr, {
        lastSeenAt: lastSeenFor(key) ?? baseline,
        reviewRequestedFromMe: false,
        viewerLogin,
        stackedOn: parents.get(key) ?? null,
      });
    });
  }, [mineQuery.data, seenVersion, viewerLogin]);

  const mineReadyCount = useMemo(() => countMergeReadiness(mineItems).ready, [mineItems]);

  // Start the activity clock the first time the dashboard has data. This is
  // deliberately not a per-PR mark: replacing the token clears last-seen marks,
  // and a new baseline is just a timestamp, never the previous user's PR keys.
  useEffect(() => {
    if (!mineQuery.data || baselineFor() !== null) return;
    ensureBaseline();
    setSeenVersion((value) => value + 1);
  }, [mineQuery.data]);

  const repos = useMemo(
    () =>
      [...new Set([...reviewItems, ...mineItems].map((item) => item.repo))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [reviewItems, mineItems],
  );

  const onMarkSeen = useCallback((key: string) => {
    markSeen(key);
    setSeenVersion((value) => value + 1);
  }, []);

  const refreshAll = useCallback(() => {
    reviewQuery.refresh();
    mineQuery.refresh();
  }, [reviewQuery, mineQuery]);

  const activeQuery = tab === "review" ? reviewQuery : mineQuery;
  const inactiveQuery = tab === "review" ? mineQuery : reviewQuery;
  const rateLimit = activeQuery.rateLimit;
  const resetAt = rateLimit?.resetAt ? new Date(rateLimit.resetAt) : null;
  const activeLastUpdated = activeQuery.lastUpdated;
  const activeFromCache = activeQuery.fromCache;

  // A token change is a user change. Never let the next person on this browser
  // inherit the previous person's cached pull requests or last-seen marks.
  const resetLocalData = useCallback(async (): Promise<void> => {
    await clearCache();
    clearLastSeen();
    setSeenVersion((value) => value + 1);
    setCacheInfo(await cacheStats());
  }, []);

  // Clearing the cache is not signing out: the token and the last-seen marks
  // stay until the user asks for that separately.
  const clearLocalCache = useCallback(async (): Promise<void> => {
    await clearCache();
    setCacheInfo(await cacheStats());
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    void cacheStats().then(setCacheInfo);
  }, [showSettings]);

  const saveToken = async (token: string): Promise<void> => {
    await resetLocalData();
    onChange({ ...settings, token });
    setShowSettings(false);
  };

  const signOut = (): void => {
    void resetLocalData().finally(onSignOut);
  };

  const reviewList = (
    <PullRequestList
      kind="review"
      heading={wide ? "Needs my review" : undefined}
      active={wide ? tab === "review" : true}
      items={reviewItems}
      loading={reviewQuery.loading}
      filters={filters}
      sort={sort}
      searchRef={searchRef}
      viewerLogin={viewerLogin}
      error={reviewQuery.error}
      warning={reviewQuery.warning}
      stale={reviewQuery.stale}
      fromCache={reviewQuery.fromCache}
      lastUpdated={reviewQuery.lastUpdated}
      onActivate={() => setTab("review")}
      onMarkSeen={onMarkSeen}
      onRefresh={reviewQuery.refresh}
    />
  );

  const mineList = (
    <PullRequestList
      kind="mine"
      heading={wide ? "My pull requests" : undefined}
      active={wide ? tab === "mine" : true}
      items={mineItems}
      loading={mineQuery.loading}
      filters={filters}
      sort={sort}
      searchRef={searchRef}
      viewerLogin={viewerLogin}
      error={mineQuery.error}
      warning={mineQuery.warning}
      stale={mineQuery.stale}
      fromCache={mineQuery.fromCache}
      lastUpdated={mineQuery.lastUpdated}
      onActivate={() => setTab("mine")}
      onMarkSeen={onMarkSeen}
      onRefresh={mineQuery.refresh}
    />
  );

  // Compute the "updated <local time>" label for the active view.
  const updatedLabel = useMemo(() => {
    if (!activeLastUpdated) return null;
    const time = clockTime(activeLastUpdated);
    return time ? `updated ${time}` : null;
  }, [activeLastUpdated]);
  const updatedTitle = useMemo(
    () =>
      activeLastUpdated
        ? `Data last updated ${new Date(activeLastUpdated).toLocaleString()}`
        : "Data last updated",
    [activeLastUpdated],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◉
          </span>
          <div>
            <strong>Review Radar</strong>
            <span className="brand-sub">{viewerLogin ? `@${viewerLogin}` : "review-radar"}</span>
          </div>
        </div>

        {!wide ? (
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
              {mineReadyCount > 0 ? (
                <span
                  className="count ready"
                  data-testid="mine-ready-count"
                  title={`${mineReadyCount} ready to merge`}
                >
                  {mineReadyCount} ready
                </span>
              ) : null}
            </button>
          </nav>
        ) : null}

        <div className="topbar-actions">
          {!online ? (
            <span className="pill offline" data-testid="offline">
              Offline
            </span>
          ) : null}
          {activeFromCache ? (
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
          {/* Show the local clock time of the active view's last refresh */}
          {updatedLabel && (
            <span
              className="pill"
              data-testid="updated-indicator"
              title={updatedTitle}
            >
              {updatedLabel}
            </span>
          )}
          {/* Show pill while document hidden */}
          {documentHidden && (
            <span className="pill hidden" data-testid="hidden-pill" title="Document hidden">
              Hidden
            </span>
          )}
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
        <ListToolbar
          filters={filters}
          onFiltersChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          repos={repos}
          view={wide ? "both" : tab}
          refreshing={reviewQuery.refreshing || mineQuery.refreshing}
          onRefresh={refreshAll}
          searchRef={searchRef}
        />
        {wide ? (
          <div className="workspace">
            {reviewList}
            {mineList}
          </div>
        ) : tab === "review" ? (
          reviewList
        ) : (
          mineList
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
              cacheInfo={cacheInfo}
              onSaveToken={(token) => void saveToken(token)}
              onRefreshChange={(refreshSeconds) => onChange({ ...settings, refreshSeconds })}
              onThemeChange={(nextTheme) => onChange({ ...settings, theme: nextTheme })}
              onClearCache={() => void clearLocalCache()}
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
  cacheInfo,
  onSaveToken,
  onRefreshChange,
  onThemeChange,
  onClearCache,
  onSignOut,
}: {
  settings: Settings;
  cacheInfo: CacheStats | null;
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

      <p className="hint" data-testid="cache-stats">
        {cacheInfo
          ? `${cacheInfo.entries.toLocaleString()} cached ${cacheInfo.entries === 1 ? "response" : "responses"}`
          : "Checking cached responses…"}
      </p>
      {cacheInfo?.quotaExceeded ? (
        <p className="warning-text" role="status" data-testid="quota-warning">
          This browser is out of storage. Responses are kept in memory for this session; clear the
          local cache to make room.
        </p>
      ) : null}

      <div className="settings-actions">
        <button type="button" className="button tiny" onClick={onClearCache} data-testid="clear-cache">
          Clear local cache
        </button>
        <button type="button" className="button tiny danger" onClick={onSignOut} data-testid="sign-out">
          Sign out
        </button>
      </div>
      <p className="hint" data-testid="token-storage-note">
        The token is stored in this browser, never sent to us, and cleared when you sign out.
        Clearing the cache removes responses, not the token.
      </p>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { GithubError, fetchGraphQL } from "../lib/github";
import { readCache } from "../lib/cache";
import { cacheKey } from "../lib/cache";
import type { RateLimit } from "../lib/types";

export interface CachedQueryState<T> {
  data: T | null;
  error: GithubError | null;
  warning: string | null;
  loading: boolean;
  refreshing: boolean;
  fromCache: boolean;
  stale: boolean;
  lastUpdated: number | null;
  rateLimit: RateLimit | null;
  refresh: () => void;
}

interface Options {
  enabled: boolean;
  token: string;
  query: string;
  variables: Record<string, unknown>;
  refreshSeconds: number;
  active?: boolean;
}

const MIN_REFRESH_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Cache-first query with stale-while-revalidate.
 *
 * 1. Resolve the cached response synchronously enough to paint the last screen.
 * 2. Revalidate in the background.
 * 3. Keep serving the cache when the network or GitHub fails.
 * 4. Back off on errors, and stop polling entirely while rate-limited.
 */
export function useCachedQuery<T>(options: Options): CachedQueryState<T> {
  const { enabled, token, query, variables, refreshSeconds, active } = options;
  const key = cacheKey(query, variables);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<GithubError | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [stale, setStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimit | null>(null);

  const generation = useRef(0);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const hasData = useRef(false);

  useEffect(() => {
    hasData.current = data !== null;
  }, [data]);

  const run = useCallback(
    async (force: boolean) => {
      if (!enabled || !token) return;
      const current = generation.current + 1;
      generation.current = current;
      const controller = new AbortController();
      if (!force && !hasData.current) setLoading(true);
      setRefreshing(true);
      try {
        const result = await fetchGraphQL<T>(token, query, variables, {
          signal: controller.signal,
          force,
        });
        if (!mounted.current || generation.current !== current) return;
        setData(result.data);
        setRateLimit(result.rateLimit);
        setWarning(result.warning);
        setFromCache(result.fromCache);
        setStale(result.stale);
        setLastUpdated(result.fetchedAt);
        setError(
          result.stale
            ? new GithubError("network", "Could not reach GitHub. Showing the last cached response.")
            : null,
        );
        failures.current = result.stale ? failures.current + 1 : 0;
      } catch (caught) {
        if (!mounted.current || generation.current !== current) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        const failure =
          caught instanceof GithubError
            ? caught
            : new GithubError("network", caught instanceof Error ? caught.message : String(caught));
        setError(failure);
        setWarning(null);
        failures.current += 1;
      } finally {
        if (mounted.current && generation.current === current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled, token, query, variables, key],
  );

  useEffect(() => {
    mounted.current = true;
    if (!enabled || !token) {
      setLoading(false);
      return () => {
        mounted.current = false;
      };
    }

    let cancelled = false;
    void readCache<{ data: T; warning?: string | null }>(key).then((cached) => {
      if (cancelled || !cached) return;
      setData(cached.value.data);
      setWarning(cached.value.warning ?? null);
      setFromCache(true);
      setLastUpdated(cached.fetchedAt);
      setLoading(false);
    });

    void run(false);

    return () => {
      cancelled = true;
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // Re-run only when the identity of the query changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, key, active]);

  useEffect(() => {
    if (!enabled || !token || !active) return;
    const schedule = (): void => {
      if (timer.current) clearTimeout(timer.current);
      if (typeof document !== "undefined" && document.hidden) return;
      const base = Math.max(MIN_REFRESH_MS, refreshSeconds * 1000);
      const backoff = failures.current > 0 ? Math.min(base * 2 ** failures.current, MAX_BACKOFF_MS) : base;
      const limited =
        rateLimit && rateLimit.remaining === 0 && rateLimit.resetAt
          ? Math.max(15_000, Date.parse(rateLimit.resetAt) - Date.now() + 5_000)
          : 0;
      const delay = limited > 0 ? limited : backoff;
      timer.current = setTimeout(() => {
        void run(false).finally(schedule);
      }, delay);
    };

    schedule();

    const onVisibility = (): void => {
      if (!document.hidden) void run(false).finally(schedule);
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
    // Rate limit changes should reschedule the next poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token, key, refreshSeconds, rateLimit?.remaining, rateLimit?.resetAt, active]);

  const refresh = useCallback(() => {
    failures.current = 0;
    void run(true);
  }, [run]);

  return { data, error, warning, loading, refreshing, fromCache, stale, lastUpdated, rateLimit, refresh };
}

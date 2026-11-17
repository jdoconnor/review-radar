import { useMemo } from "react";
import { useCachedQuery } from "./useCachedQuery";
import {
  MERGE_STATUS_QUERY,
  mergeStatusBatches,
  mergeStatuses,
} from "../lib/queries";
import type { MergeStateStatus, MergeStatusPayload } from "../lib/types";

/**
 * At most six batches of 50: with lazy loading a view can hold more than the
 * old 50/100 rows, and the merge-status ids come from every loaded page, so
 * the ceiling has to grow with the pages. Six batches cover 300 pull requests
 * (twelve pages of 25). A fixed number of hook slots keeps the hook count
 * stable while the id list changes size; a pull request past the ceiling
 * simply reads as not-behind, as before.
 */
const MAX_BATCHES = 6;

interface Options {
  enabled: boolean;
  token: string;
  ids: readonly string[];
  refreshSeconds: number;
}

/**
 * Merge-state verdicts for the pull requests a list already loaded.
 *
 * The list queries no longer ask for `mergeStateStatus` — GitHub computes it
 * per pull request, and folding it into the old 2×50 "my pull requests"
 * request pushed that request past GitHub's ~10s GraphQL timeout (502). Each batch is
 * its own cached query through the same cache-first client as the lists, so it
 * gets the retry and the cache fallback for free.
 *
 * Independently failable by design: a batch that fails (including a 502)
 * leaves the other batches — and the list — untouched, and a pull request
 * without a verdict simply reads as not-behind. There is no error surface
 * here; the list renders either way.
 */
export function useMergeStatuses(options: Options): Map<string, MergeStateStatus> {
  const { enabled, token, ids, refreshSeconds } = options;
  const batches = useMemo(() => mergeStatusBatches(ids).slice(0, MAX_BATCHES), [ids]);

  const batch0 = useCachedQuery<MergeStatusPayload>({
    enabled: enabled && batches.length > 0,
    token,
    query: MERGE_STATUS_QUERY,
    variables: { ids: batches[0] ?? [] },
    refreshSeconds,
    active: enabled,
  });
  const batch1 = useCachedQuery<MergeStatusPayload>({
    enabled: enabled && batches.length > 1,
    token,
    query: MERGE_STATUS_QUERY,
    variables: { ids: batches[1] ?? [] },
    refreshSeconds,
    active: enabled,
  });
  const batch2 = useCachedQuery<MergeStatusPayload>({
    enabled: enabled && batches.length > 2,
    token,
    query: MERGE_STATUS_QUERY,
    variables: { ids: batches[2] ?? [] },
    refreshSeconds,
    active: enabled,
  });
  const batch3 = useCachedQuery<MergeStatusPayload>({
    enabled: enabled && batches.length > 3,
    token,
    query: MERGE_STATUS_QUERY,
    variables: { ids: batches[3] ?? [] },
    refreshSeconds,
    active: enabled,
  });
  const batch4 = useCachedQuery<MergeStatusPayload>({
    enabled: enabled && batches.length > 4,
    token,
    query: MERGE_STATUS_QUERY,
    variables: { ids: batches[4] ?? [] },
    refreshSeconds,
    active: enabled,
  });
  const batch5 = useCachedQuery<MergeStatusPayload>({
    enabled: enabled && batches.length > 5,
    token,
    query: MERGE_STATUS_QUERY,
    variables: { ids: batches[5] ?? [] },
    refreshSeconds,
    active: enabled,
  });

  return useMemo(() => {
    const merged = new Map<string, MergeStateStatus>();
    for (const data of [batch0.data, batch1.data, batch2.data, batch3.data, batch4.data, batch5.data]) {
      for (const [id, status] of mergeStatuses(data)) merged.set(id, status);
    }
    return merged;
  }, [batch0.data, batch1.data, batch2.data, batch3.data, batch4.data, batch5.data]);
}

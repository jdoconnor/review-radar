import type { Filters } from "../components/ListToolbar";
import { readCache, writeCache } from "./cache";

const FILTER_DEFAULTS_KEY = "filter-defaults";

export async function loadFilterDefaults(): Promise<Filters | null> {
  const entry = await readCache<Filters>(FILTER_DEFAULTS_KEY);
  return entry ? entry.value : null;
}

export async function saveFilterDefaults(filters: Filters): Promise<void> {
  await writeCache<Filters>({
    key: FILTER_DEFAULTS_KEY,
    value: filters,
    etag: null,
    fetchedAt: Date.now(),
    lastUsedAt: Date.now(),
  });
}

/**
 * Durable response cache.
 *
 * IndexedDB is the primary store. Browsers that deny it (Safari private mode,
 * happy-dom in tests) fall back to an in-memory map, and the app keeps working
 * for the lifetime of the tab. The cache is deliberately dumb: keyed blobs with
 * an ETag, fetch time and last-used time. Policy lives in the caller.
 *
 * Three browser realities shape this module:
 *
 * 1. A second tab must not keep serving a response the first tab replaced, so
 *    successful writes and clears are announced on a BroadcastChannel and
 *    other tabs drop their in-memory copy (they re-read IndexedDB on next use).
 * 2. Quota can run out mid-session. A failed write prunes the oldest 20% of
 *    entries, retries once, and then keeps the value in memory and raises a
 *    flag the UI can explain.
 * 3. Pruning is expensive on a cold start, so it runs on startup at most once
 *    every six hours across sessions.
 */

export interface CacheEntry<T> {
  key: string;
  value: T;
  etag: string | null;
  fetchedAt: number;
  lastUsedAt: number;
}

export interface CacheStats {
  entries: number;
  quotaExceeded: boolean;
}

const DB_NAME = "github-ui";
const STORE = "responses";
const DB_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const CHANNEL_NAME = "github-ui.cache";
const PRUNE_STAMP_KEY = "github-ui.cache-pruned-at";
const PRUNE_INTERVAL_MS = 1000 * 60 * 60 * 6;
const QUOTA_PRUNE_FRACTION = 0.2;

const memory = new Map<string, CacheEntry<unknown>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let quotaExceeded = false;
let channel: BroadcastChannel | null = null;
let channelUnavailable = false;

type CacheMessage = { type: "write"; key: string } | { type: "clear" };

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let settled = false;
    const settle = (db: IDBDatabase | null): void => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => settle(request.result);
      request.onerror = () => settle(null);
      request.onblocked = () => settle(null);
    } catch {
      settle(null);
    }
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const request = operation(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          tx.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/**
 * Cross-tab invalidation. The channel is created on first cache use so a tab
 * that only ever reads still hears about writes and clears from other tabs.
 */
function cacheChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (channelUnavailable || typeof BroadcastChannel === "undefined") return null;
  try {
    const created = new BroadcastChannel(CHANNEL_NAME);
    created.onmessage = (event: MessageEvent<unknown>) => applyRemoteChange(event.data);
    channel = created;
    return channel;
  } catch {
    channelUnavailable = true;
    return null;
  }
}

function broadcast(message: CacheMessage): void {
  try {
    cacheChannel()?.postMessage(message);
  } catch {
    // A closed or blocked channel must never break a cache operation.
  }
}

function applyRemoteChange(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const message = data as { type?: unknown; key?: unknown };
  if (message.type === "clear") {
    memory.clear();
    return;
  }
  if (message.type === "write" && typeof message.key === "string") {
    // Drop this tab's copy; the next read re-reads IndexedDB and picks up the
    // version the writing tab stored.
    memory.delete(message.key);
  }
}

export function cacheKey(query: string, variables: unknown): string {
  const text = `${query}\u0000${stableStringify(variables)}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `v1:${(hash >>> 0).toString(36)}:${text.length.toString(36)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  cacheChannel();
  const inMemory = memory.get(key) as CacheEntry<T> | undefined;
  if (inMemory) return { ...inMemory, lastUsedAt: Date.now() };

  const stored = await withStore<CacheEntry<T>>("readonly", (store) => store.get(key) as IDBRequest<CacheEntry<T>>);
  if (!stored) return null;
  memory.set(key, stored);
  return { ...stored, lastUsedAt: Date.now() };
}

async function putEntry(entry: CacheEntry<unknown>): Promise<"ok" | "error" | "unavailable"> {
  const db = await openDatabase();
  if (!db) return "unavailable";
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve("ok");
      tx.onerror = () => resolve("error");
      tx.onabort = () => resolve("error");
    } catch {
      resolve("error");
    }
  });
}

export async function writeCache<T>(entry: CacheEntry<T>): Promise<void> {
  cacheChannel();
  const value = { ...entry, lastUsedAt: Date.now() };
  memory.set(entry.key, value);

  let result = await putEntry(value);
  if (result === "error") {
    // Quota (or a similar storage failure): make room, then try once more.
    await pruneOldest();
    result = await putEntry(value);
    if (result === "error") quotaExceeded = true;
  }
  if (result !== "error") broadcast({ type: "write", key: entry.key });
}

export async function deleteCache(key: string): Promise<void> {
  memory.delete(key);
  await withStore("readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
  broadcast({ type: "write", key });
}

export async function clearCache(): Promise<void> {
  cacheChannel();
  memory.clear();
  quotaExceeded = false;
  await withStore("readwrite", (store) => store.clear() as IDBRequest<undefined>);
  broadcast({ type: "clear" });
}

function oldestEntries<T>(entries: Array<CacheEntry<T>>, fraction: number): Array<CacheEntry<T>> {
  const sorted = [...entries].sort((left, right) => left.lastUsedAt - right.lastUsedAt);
  const count = Math.max(1, Math.ceil(sorted.length * fraction));
  return sorted.slice(0, count);
}

function pruneMemoryOldest(fraction: number): number {
  const victims = oldestEntries([...memory.values()], fraction);
  for (const victim of victims) memory.delete(victim.key);
  return victims.length;
}

function readAllEntries(db: IDBDatabase): Promise<Array<CacheEntry<unknown>>> {
  return new Promise((resolve) => {
    const entries: Array<CacheEntry<unknown>> = [];
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        entries.push(cursor.value as CacheEntry<unknown>);
        cursor.continue();
      };
      tx.oncomplete = () => resolve(entries);
      tx.onerror = () => resolve(entries);
      tx.onabort = () => resolve(entries);
    } catch {
      resolve(entries);
    }
  });
}

function deleteEntries(db: IDBDatabase, keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Drop the oldest 20% of stored responses. Used when a write fails for lack of
 * space; the caller retries the write afterwards.
 */
async function pruneOldest(fraction = QUOTA_PRUNE_FRACTION): Promise<number> {
  const db = await openDatabase();
  if (!db) return pruneMemoryOldest(fraction);

  const entries = await readAllEntries(db);
  if (entries.length === 0) return pruneMemoryOldest(fraction);

  const victims = oldestEntries(entries, fraction);
  await deleteEntries(db, victims.map((victim) => victim.key));
  for (const victim of victims) memory.delete(victim.key);
  return victims.length;
}

export async function pruneCache(maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [key, entry] of memory) {
    if (entry.lastUsedAt < cutoff) {
      memory.delete(key);
      removed += 1;
    }
  }
  const db = await openDatabase();
  if (!db) return removed;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as CacheEntry<unknown>;
        if (entry.lastUsedAt < cutoff) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve(removed);
      tx.onerror = () => resolve(removed);
    } catch {
      resolve(removed);
    }
  });
}

function readPruneStamp(): number | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PRUNE_STAMP_KEY);
    if (!raw) return null;
    const stamp = Number(raw);
    return Number.isFinite(stamp) && stamp > 0 ? stamp : null;
  } catch {
    return null;
  }
}

function writePruneStamp(at: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PRUNE_STAMP_KEY, String(at));
  } catch {
    // A locked-down browser just means we prune more often than six hours.
  }
}

/**
 * Startup pruning, at most once every six hours across sessions. Returns the
 * number of entries removed, or `0` when it was not time to prune yet.
 */
export async function pruneCacheIfDue(now = Date.now()): Promise<number> {
  const last = readPruneStamp();
  if (last !== null && now - last < PRUNE_INTERVAL_MS) return 0;
  const removed = await pruneCache();
  writePruneStamp(now);
  return removed;
}

export async function cacheStats(): Promise<CacheStats> {
  const db = await openDatabase();
  if (!db) return { entries: memory.size, quotaExceeded };
  const entries = await new Promise<number>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(memory.size);
      tx.onerror = () => resolve(memory.size);
    } catch {
      resolve(memory.size);
    }
  });
  return { entries, quotaExceeded };
}

export async function cacheSize(): Promise<number> {
  return (await cacheStats()).entries;
}

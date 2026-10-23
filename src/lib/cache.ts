/**
 * Durable response cache.
 *
 * IndexedDB is the primary store. Browsers that deny it (Safari private mode,
 * happy-dom in tests) fall back to an in-memory map, and the app keeps working
 * for the lifetime of the tab. The cache is deliberately dumb: keyed blobs with
 * an ETag, fetch time and last-used time. Policy lives in the caller.
 */

export interface CacheEntry<T> {
  key: string;
  value: T;
  etag: string | null;
  fetchedAt: number;
  lastUsedAt: number;
}

const DB_NAME = "github-ui";
const STORE = "responses";
const DB_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

const memory = new Map<string, CacheEntry<unknown>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

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
  const inMemory = memory.get(key) as CacheEntry<T> | undefined;
  if (inMemory) return { ...inMemory, lastUsedAt: Date.now() };

  const stored = await withStore<CacheEntry<T>>("readonly", (store) => store.get(key) as IDBRequest<CacheEntry<T>>);
  if (!stored) return null;
  memory.set(key, stored);
  return { ...stored, lastUsedAt: Date.now() };
}

export async function writeCache<T>(entry: CacheEntry<T>): Promise<void> {
  const value = { ...entry, lastUsedAt: Date.now() };
  memory.set(entry.key, value);
  await withStore("readwrite", (store) => store.put(value) as IDBRequest<IDBValidKey>);
}

export async function deleteCache(key: string): Promise<void> {
  memory.delete(key);
  await withStore("readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
}

export async function clearCache(): Promise<void> {
  memory.clear();
  await withStore("readwrite", (store) => store.clear() as IDBRequest<undefined>);
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

export async function cacheSize(): Promise<number> {
  const db = await openDatabase();
  if (!db) return memory.size;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(memory.size);
    } catch {
      resolve(memory.size);
    }
  });
}

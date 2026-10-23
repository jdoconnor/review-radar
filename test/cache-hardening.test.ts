import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeIndexedDb } from "./fake-idb";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * `src/lib/cache.ts` keeps module-level state (the open database, the quota
 * flag, the broadcast channel), so every test imports a fresh copy.
 */
async function freshCache(): Promise<typeof import("../src/lib/cache")> {
  vi.resetModules();
  return import("../src/lib/cache");
}

type FakeBroadcastChannel = {
  name: string;
  onmessage: ((event: { data: unknown }) => void) | null;
  posted: unknown[];
  postMessage(data: unknown): void;
  close(): void;
  receive(data: unknown): void;
};

function installBroadcastChannel(): { instances: FakeBroadcastChannel[] } {
  const instances: FakeBroadcastChannel[] = [];
  class Channel implements FakeBroadcastChannel {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    posted: unknown[] = [];
    constructor(public readonly name: string) {
      instances.push(this);
    }
    postMessage(data: unknown): void {
      this.posted.push(data);
    }
    close(): void {
      // no-op
    }
    /** Pretend the message arrived from another tab. */
    receive(data: unknown): void {
      this.onmessage?.({ data });
    }
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  return { instances };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pruning", () => {
  it("removes responses older than the max age and keeps fresh ones", async () => {
    const fake = installFakeIndexedDb();
    const now = Date.now();
    fake.store.set("stale", { key: "stale", value: 1, lastUsedAt: now - 15 * DAY });
    fake.store.set("fresh", { key: "fresh", value: 2, lastUsedAt: now - 2 * DAY });
    vi.stubGlobal("indexedDB", fake.factory);

    const cache = await freshCache();
    expect(await cache.pruneCache()).toBe(1);

    expect(fake.store.has("stale")).toBe(false);
    expect(fake.store.has("fresh")).toBe(true);
  });

  it("prunes on startup at most once every six hours", async () => {
    const fake = installFakeIndexedDb();
    const now = Date.now();
    vi.stubGlobal("indexedDB", fake.factory);

    fake.store.set("stale", { key: "stale", value: 1, lastUsedAt: now - 15 * DAY });
    const cache = await freshCache();
    expect(await cache.pruneCacheIfDue(now)).toBe(1);
    expect(localStorage.getItem("review-radar.cache-pruned-at")).toBe(String(now));

    fake.store.set("stale-again", { key: "stale-again", value: 2, lastUsedAt: now - 15 * DAY });
    expect(await cache.pruneCacheIfDue(now + 5 * HOUR)).toBe(0);
    expect(fake.store.has("stale-again")).toBe(true);

    expect(await cache.pruneCacheIfDue(now + 6 * HOUR + 1)).toBe(1);
    expect(fake.store.has("stale-again")).toBe(false);
  });

  it("works without IndexedDB by pruning memory", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const cache = await freshCache();

    await cache.writeCache({ key: "only", value: 1, etag: null, fetchedAt: 1, lastUsedAt: 1 });
    // A zero max age makes the just-written entry stale.
    expect(await cache.pruneCache(-1)).toBe(1);
    expect(await cache.readCache("only")).toBeNull();
  });
});

describe("quota", () => {
  it("prunes the oldest 20%, retries once, and falls back to memory", async () => {
    const fake = installFakeIndexedDb();
    const now = Date.now();
    for (let index = 0; index < 5; index += 1) {
      fake.store.set(`entry-${index}`, {
        key: `entry-${index}`,
        value: index,
        lastUsedAt: now - (5 - index) * 1000,
      });
    }
    fake.failPuts(true);
    vi.stubGlobal("indexedDB", fake.factory);

    const cache = await freshCache();
    await cache.writeCache({ key: "new", value: "kept in memory", etag: null, fetchedAt: now, lastUsedAt: now });

    // One entry (20% of five) was pruned to make room, and the retry still
    // failed, so the new value only lives in memory.
    expect(fake.store.size).toBe(4);
    expect(fake.store.has("entry-0")).toBe(false);
    expect(fake.store.has("new")).toBe(false);
    expect((await cache.readCache<string>("new"))?.value).toBe("kept in memory");

    const stats = await cache.cacheStats();
    expect(stats).toEqual({ entries: 4, quotaExceeded: true });
  });

  it("succeeds on the retry after pruning", async () => {
    const fake = installFakeIndexedDb();
    const now = Date.now();
    for (let index = 0; index < 5; index += 1) {
      fake.store.set(`entry-${index}`, { key: `entry-${index}`, value: index, lastUsedAt: now - index * 1000 });
    }
    fake.failNextPuts(1);
    vi.stubGlobal("indexedDB", fake.factory);

    const cache = await freshCache();
    await cache.writeCache({ key: "new", value: "stored", etag: null, fetchedAt: now, lastUsedAt: now });

    expect(fake.store.has("new")).toBe(true);
    expect(fake.store.size).toBe(5);
    expect((await cache.cacheStats()).quotaExceeded).toBe(false);
  });

  it("clears the quota flag when the user clears the cache", async () => {
    const fake = installFakeIndexedDb();
    fake.store.set("entry", { key: "entry", value: 1, lastUsedAt: Date.now() });
    fake.failPuts(true);
    vi.stubGlobal("indexedDB", fake.factory);

    const cache = await freshCache();
    await cache.writeCache({ key: "new", value: 1, etag: null, fetchedAt: 1, lastUsedAt: 1 });
    expect((await cache.cacheStats()).quotaExceeded).toBe(true);

    await cache.clearCache();
    expect(fake.store.size).toBe(0);
    expect(await cache.cacheStats()).toEqual({ entries: 0, quotaExceeded: false });
  });
});

describe("cross-tab invalidation", () => {
  it("announces writes and clears on the review-radar.cache channel", async () => {
    const fake = installFakeIndexedDb();
    vi.stubGlobal("indexedDB", fake.factory);
    const { instances } = installBroadcastChannel();

    const cache = await freshCache();
    await cache.writeCache({ key: "one", value: 1, etag: null, fetchedAt: 1, lastUsedAt: 1 });

    const channel = instances[0];
    expect(channel).toBeDefined();
    expect(channel?.name).toBe("review-radar.cache");
    expect(channel?.posted).toEqual([{ type: "write", key: "one" }]);

    await cache.clearCache();
    expect(channel?.posted).toContainEqual({ type: "clear" });
  });

  it("drops the in-memory copy and re-reads after another tab writes", async () => {
    const fake = installFakeIndexedDb();
    fake.store.set("shared", { key: "shared", value: "from-db", lastUsedAt: 1 });
    vi.stubGlobal("indexedDB", fake.factory);
    const { instances } = installBroadcastChannel();

    const cache = await freshCache();
    expect((await cache.readCache<string>("shared"))?.value).toBe("from-db");

    // Another tab stored a newer response and announced it.
    fake.store.set("shared", { key: "shared", value: "from-other-tab", lastUsedAt: 2 });
    instances[0]?.receive({ type: "write", key: "shared" });

    expect((await cache.readCache<string>("shared"))?.value).toBe("from-other-tab");
  });

  it("empties the in-memory copy when another tab clears", async () => {
    const fake = installFakeIndexedDb();
    fake.store.set("shared", { key: "shared", value: "cached", lastUsedAt: 1 });
    vi.stubGlobal("indexedDB", fake.factory);
    const { instances } = installBroadcastChannel();

    const cache = await freshCache();
    expect(await cache.readCache("shared")).not.toBeNull();

    fake.store.clear();
    instances[0]?.receive({ type: "clear" });

    expect(await cache.readCache("shared")).toBeNull();
  });

  it("still works in browsers without BroadcastChannel", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("indexedDB", undefined);

    const cache = await freshCache();
    await cache.writeCache({ key: "one", value: 1, etag: null, fetchedAt: 1, lastUsedAt: 1 });
    expect(await cache.readCache("one")).not.toBeNull();
    await cache.clearCache();
    expect(await cache.readCache("one")).toBeNull();
    expect(await cache.cacheStats()).toEqual({ entries: 0, quotaExceeded: false });
  });
});

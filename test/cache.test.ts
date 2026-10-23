import { beforeEach, describe, expect, it } from "vitest";
import { cacheKey, clearCache, readCache, writeCache } from "../src/lib/cache";

beforeEach(async () => {
  await clearCache();
});

describe("cacheKey", () => {
  it("is stable across object key order", () => {
    const left = cacheKey("query", { a: 1, b: [2, 3] });
    const right = cacheKey("query", { b: [2, 3], a: 1 });
    expect(left).toBe(right);
  });

  it("changes when the query or variables change", () => {
    expect(cacheKey("one", {})).not.toBe(cacheKey("two", {}));
    expect(cacheKey("one", { a: 1 })).not.toBe(cacheKey("one", { a: 2 }));
  });
});

describe("cache", () => {
  it("round-trips a value and etag", async () => {
    const key = cacheKey("query", { a: 1 });
    await writeCache({
      key,
      value: { hello: "world" },
      etag: '"abc"',
      fetchedAt: 123,
      lastUsedAt: 123,
    });
    const entry = await readCache<{ hello: string }>(key);
    expect(entry?.value).toEqual({ hello: "world" });
    expect(entry?.etag).toBe('"abc"');
    expect(entry?.fetchedAt).toBe(123);
  });

  it("returns null for a miss and after clearing", async () => {
    expect(await readCache("missing")).toBeNull();
    const key = cacheKey("query", {});
    await writeCache({ key, value: 1, etag: null, fetchedAt: 1, lastUsedAt: 1 });
    expect(await readCache(key)).not.toBeNull();
    await clearCache();
    expect(await readCache(key)).toBeNull();
  });
});

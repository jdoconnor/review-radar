import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, cacheKey, writeCache } from "../src/lib/cache";
import { fetchGraphQL, GithubError } from "../src/lib/github";

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function rejected(promise: Promise<unknown>): Promise<GithubError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GithubError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

beforeEach(async () => {
  await clearCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGraphQL error taxonomy", () => {
  it("keeps a real rate limit separate from a permission failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          { message: "API rate limit exceeded" },
          403,
          {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1700000000",
          },
        ),
      ),
    );

    const error = await rejected(fetchGraphQL("token", "query", {}));
    expect(error.kind).toBe("rate-limit");
    expect(error.resetAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("labels a 403 permission failure as forbidden, not rate-limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          { message: "Resource not accessible by personal access token" },
          403,
          { "x-ratelimit-remaining": "4999" },
        ),
      ),
    );

    const error = await rejected(fetchGraphQL("token", "query", {}));
    expect(error.kind).toBe("forbidden");
    expect(error.message).toContain("Contents, Checks and Commit statuses");
  });

  it("keeps partial data when only the CI field is forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          data: { search: { nodes: [] } },
          errors: [
            { type: "FORBIDDEN", message: "Resource not accessible by personal access token" },
            { type: "FORBIDDEN", message: "Resource not accessible by personal access token" },
            { type: "FORBIDDEN", message: "Resource not accessible by personal access token" },
          ],
        }),
      ),
    );

    const result = await fetchGraphQL<{ search: { nodes: unknown[] } }>("token", "query", {});
    expect(result.data.search.nodes).toEqual([]);
    expect(result.warning).toContain("Some CI data could not be loaded");
    expect(result.warning?.match(/Resource not accessible/g)).toBeNull();
    expect(result.warning).toContain("Contents, Checks and Commit statuses");
  });

  it("names the exact permissions when check contexts are forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          data: { search: { nodes: [] } },
          errors: [
            {
              type: "FORBIDDEN",
              message: "Resource not accessible by personal access token",
              path: ["search", "nodes", 0, "commits", "nodes", 0, "commit", "statusCheckRollup", "contexts", "nodes", 0],
            },
          ],
        }),
      ),
    );

    const result = await fetchGraphQL<{ search: { nodes: unknown[] } }>("token", "query", {});
    expect(result.warning).toContain("Checks (read-only) and Commit statuses (read-only)");
    expect(result.warning).not.toContain("Contents (read-only)");
    expect(result.warning).toContain("Then refresh.");
  });

  it("names Contents when the commit behind the rollup is forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          data: { search: { nodes: [] } },
          errors: [
            {
              type: "FORBIDDEN",
              message: "Resource not accessible by personal access token",
              path: ["search", "nodes", 0, "commits", "nodes", 0],
            },
          ],
        }),
      ),
    );

    const result = await fetchGraphQL<{ search: { nodes: unknown[] } }>("token", "query", {});
    expect(result.warning).toContain("Contents (read-only)");
    expect(result.warning).not.toContain("Checks (read-only)");
  });

  it("combines every missing CI permission into one instruction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          data: { search: { nodes: [] } },
          errors: [
            {
              type: "FORBIDDEN",
              message: "Resource not accessible by personal access token",
              path: ["search", "nodes", 0, "commits", "nodes", 0],
            },
            {
              type: "FORBIDDEN",
              message: "Resource not accessible by personal access token",
              path: ["search", "nodes", 0, "commits", "nodes", 0, "commit", "statusCheckRollup", "contexts", "nodes", 0],
            },
          ],
        }),
      ),
    );

    const result = await fetchGraphQL<{ search: { nodes: unknown[] } }>("token", "query", {});
    expect(result.warning).toContain("Contents (read-only), Checks (read-only) and Commit statuses (read-only)");
  });

  it("still fails when a forbidden response has no data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }],
        }),
      ),
    );

    const error = await rejected(fetchGraphQL("token", "query", {}));
    expect(error.kind).toBe("forbidden");
  });

  it("deduplicates repeated generic GraphQL errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          data: { search: { nodes: [] } },
          errors: [
            { message: "Something broke" },
            { message: "Something broke" },
            { message: "Something else" },
          ],
        }),
      ),
    );

    const error = await rejected(fetchGraphQL("token", "query", {}));
    expect(error.kind).toBe("graphql");
    expect(error.message).toBe("Something broke; Something else");
  });

  it("returns data when the response has no errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          data: { search: { nodes: [] }, rateLimit: { limit: 5000, remaining: 4999, resetAt: "", cost: 1 } },
        }),
      ),
    );

    const result = await fetchGraphQL<{ search: { nodes: unknown[] } }>("token", "query", {});
    expect(result.data.search.nodes).toEqual([]);
    expect(result.fromCache).toBe(false);
  });

  it("treats a 401 as an auth problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ message: "Bad credentials" }, 401)));

    const error = await rejected(fetchGraphQL("token", "query", {}));
    expect(error.kind).toBe("auth");
  });

  it("refetches a cached warning written before the current warning version", async () => {
    const query = "query CachedWarning { search { nodes { id } } }";
    const variables = {};
    await writeCache({
      key: cacheKey(query, variables),
      value: {
        data: { search: { nodes: [] } },
        rateLimit: null,
        warning: "Old warning text",
      },
      etag: '"old-etag"',
      fetchedAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers["If-None-Match"]).toBeUndefined();
      return response({ data: { search: { nodes: [] } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGraphQL<{ search: { nodes: unknown[] } }>("token", query, variables);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.fromCache).toBe(false);
    expect(result.warning).toBeNull();
  });

  it("replaces an outdated cached warning with the explicit fallback when offline", async () => {
    const query = "query CachedWarningOffline { search { nodes { id } } }";
    const variables = {};
    await writeCache({
      key: cacheKey(query, variables),
      value: {
        data: { search: { nodes: [] } },
        rateLimit: null,
        warning: "Old warning text",
      },
      etag: '"old-etag"',
      fetchedAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const result = await fetchGraphQL<{ search: { nodes: unknown[] } }>("token", query, variables);
    expect(result.stale).toBe(true);
    expect(result.warning).not.toContain("Old warning text");
    expect(result.warning).toContain("Contents, Checks and Commit statuses (all read-only)");
  });
});

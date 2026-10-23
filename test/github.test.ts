import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "../src/lib/cache";
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
});

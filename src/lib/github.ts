import { cacheKey, readCache, writeCache } from "./cache";
import type { RateLimit } from "./types";

export type GithubErrorKind = "auth" | "forbidden" | "rate-limit" | "network" | "graphql" | "http";

export class GithubError extends Error {
  readonly kind: GithubErrorKind;
  readonly status: number;
  readonly resetAt: string | null;

  constructor(kind: GithubErrorKind, message: string, status = 0, resetAt: string | null = null) {
    super(message);
    this.name = "GithubError";
    this.kind = kind;
    this.status = status;
    this.resetAt = resetAt;
  }
}

export interface GraphQLPayload<T> {
  data: T;
  rateLimit: RateLimit | null;
  warning?: string | null;
}

export interface GraphQLResult<T> {
  data: T;
  rateLimit: RateLimit | null;
  warning: string | null;
  fromCache: boolean;
  stale: boolean;
  fetchedAt: number;
  etag: string | null;
}

export interface FetchOptions {
  signal?: AbortSignal;
  force?: boolean;
}

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

function parseRateLimit(value: unknown): RateLimit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.limit !== "number" || typeof record.remaining !== "number") return null;
  return {
    limit: record.limit,
    remaining: record.remaining,
    resetAt: String(record.resetAt ?? ""),
    cost: typeof record.cost === "number" ? record.cost : 0,
  };
}

function rateLimitFromHeaders(headers: Headers): RateLimit | null {
  const limit = Number(headers.get("x-ratelimit-limit"));
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) return null;
  const resetSeconds = Number(headers.get("x-ratelimit-reset"));
  return {
    limit,
    remaining,
    resetAt: Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1000).toISOString() : "",
    cost: 1,
  };
}

interface GraphQLErrorShape {
  message?: string;
  type?: string;
}

function uniqueMessages(errors: GraphQLErrorShape[]): string {
  return Array.from(
    new Set(
      errors
        .map((error) => String(error.message ?? "").trim())
        .filter(Boolean),
    ),
  ).join("; ");
}

function isForbiddenError(error: GraphQLErrorShape): boolean {
  const message = String(error.message ?? "");
  return (
    error.type === "FORBIDDEN" ||
    /not accessible by personal access token/i.test(message) ||
    /insufficient scopes/i.test(message) ||
    /resource not accessible/i.test(message)
  );
}

function isRateLimitError(error: GraphQLErrorShape): boolean {
  return /rate limit/i.test(String(error.message ?? ""));
}

const FORBIDDEN_HINT =
  "Check the token's repository access and permissions; the CI rollup needs Contents, Checks and Commit statuses read access.";

function messageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message) return record.message;
  if (Array.isArray(record.errors)) {
    const messages = uniqueMessages(record.errors as GraphQLErrorShape[]);
    if (messages) return messages;
  }
  return fallback;
}

/**
 * GraphQL request with a cache-first fallback. A network failure returns the
 * cached value with `stale: true` instead of destroying the last good screen.
 */
export async function fetchGraphQL<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  options: FetchOptions = {},
): Promise<GraphQLResult<T>> {
  const key = cacheKey(query, variables);
  const cached = await readCache<GraphQLPayload<T>>(key);

  const headers: Record<string, string> = {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (cached?.etag && !options.force) headers["If-None-Match"] = cached.etag;

  let response: Response;
  try {
    response = await fetch(GITHUB_GRAPHQL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (cached) {
      return {
        data: cached.value.data,
        rateLimit: cached.value.rateLimit,
        warning: cached.value.warning ?? null,
        fromCache: true,
        stale: true,
        fetchedAt: cached.fetchedAt,
        etag: cached.etag,
      };
    }
    throw new GithubError("network", "Could not reach GitHub. Check your connection and try again.");
  }

  if (response.status === 304 && cached) {
    return {
      data: cached.value.data,
      rateLimit: cached.value.rateLimit,
      warning: cached.value.warning ?? null,
      fromCache: true,
      stale: false,
      fetchedAt: cached.fetchedAt,
      etag: cached.etag,
    };
  }

  const headerRateLimit = rateLimitFromHeaders(response.headers);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const bodyRateLimit = parseRateLimit((body as { data?: { rateLimit?: unknown } } | null)?.data?.rateLimit);
  const rateLimit = bodyRateLimit ?? headerRateLimit;

  if (response.status === 401) {
    throw new GithubError("auth", "GitHub rejected the token. Check that it is valid and has repo access.", 401);
  }
  if (response.status === 403 || response.status === 429) {
    const message = messageFromBody(body, "GitHub returned 403 Forbidden.");
    const exhausted =
      rateLimit?.remaining === 0 ||
      response.headers.get("x-ratelimit-remaining") === "0" ||
      isRateLimitError({ message });
    if (response.status === 429 || exhausted) {
      throw new GithubError("rate-limit", message, response.status, rateLimit?.resetAt ?? null);
    }
    throw new GithubError("forbidden", `${message} ${FORBIDDEN_HINT}`, response.status);
  }
  if (!response.ok) {
    throw new GithubError("http", messageFromBody(body, `GitHub returned ${response.status}.`), response.status);
  }

  const parsed = body as { data?: T; errors?: GraphQLErrorShape[] } | null;
  const errors = parsed?.errors ?? [];
  const message = uniqueMessages(errors);
  if (!parsed?.data) {
    throw new GithubError(
      errors.some(isForbiddenError) ? "forbidden" : "graphql",
      message || "GitHub returned an empty response.",
      response.status,
    );
  }

  // GraphQL can return usable data alongside field-level errors. A fine-grained
  // token without Contents read is the common case: every PR is present, but
  // commits[0] is null and the CI rollup is unavailable. Keep the rows and warn
  // instead of discarding the whole view.
  const nonForbidden = errors.filter((error) => !isForbiddenError(error));
  if (nonForbidden.length > 0) {
    throw new GithubError("graphql", uniqueMessages(nonForbidden), response.status);
  }
  const warning =
    errors.length > 0 ? `Some CI data could not be loaded. ${FORBIDDEN_HINT}` : null;

  const payload: GraphQLPayload<T> = { data: parsed.data, rateLimit, warning };
  const etag = response.headers.get("etag");
  const fetchedAt = Date.now();
  await writeCache({ key, value: payload, etag, fetchedAt, lastUsedAt: fetchedAt });

  return { ...payload, warning, fromCache: false, stale: false, fetchedAt, etag };
}

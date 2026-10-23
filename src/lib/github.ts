import { cacheKey, readCache, writeCache } from "./cache";
import type { RateLimit } from "./types";

export type GithubErrorKind = "auth" | "rate-limit" | "network" | "graphql" | "http";

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
}

export interface GraphQLResult<T> {
  data: T;
  rateLimit: RateLimit | null;
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

function messageFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message) return record.message;
  if (Array.isArray(record.errors)) {
    const messages = record.errors
      .map((error) => (error && typeof error === "object" ? String((error as { message?: unknown }).message ?? "") : ""))
      .filter(Boolean);
    if (messages.length > 0) return messages.join("; ");
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
    const message = messageFromBody(body, "GitHub rate limit reached.");
    throw new GithubError("rate-limit", message, response.status, rateLimit?.resetAt ?? null);
  }
  if (!response.ok) {
    throw new GithubError("http", messageFromBody(body, `GitHub returned ${response.status}.`), response.status);
  }

  const parsed = body as { data?: T; errors?: Array<{ message?: string }> } | null;
  if (!parsed?.data) {
    const message = parsed?.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new GithubError("graphql", message || "GitHub returned an empty response.", response.status);
  }
  if (parsed.errors && parsed.errors.length > 0) {
    const message = parsed.errors.map((error) => error.message).filter(Boolean).join("; ");
    if (message) throw new GithubError("graphql", message, response.status);
  }

  const payload: GraphQLPayload<T> = { data: parsed.data, rateLimit };
  const etag = response.headers.get("etag");
  const fetchedAt = Date.now();
  await writeCache({ key, value: payload, etag, fetchedAt, lastUsedAt: fetchedAt });

  return { ...payload, fromCache: false, stale: false, fetchedAt, etag };
}

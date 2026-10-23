import { cacheKey, readCache, writeCache } from "./cache";
import type { RateLimit } from "./types";

export type GithubErrorKind = "auth" | "forbidden" | "rate-limit" | "network" | "graphql" | "http" | "url";

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

/**
 * Thrown before `fetch` when the configured API base is not the exact endpoint
 * the token is allowed to reach. A misconfiguration must never turn into a
 * request that carries the token somewhere unexpected.
 */
export class GithubUrlError extends GithubError {
  constructor(message: string) {
    super("url", message);
    this.name = "GithubUrlError";
  }
}

export interface GraphQLPayload<T> {
  data: T;
  rateLimit: RateLimit | null;
  warning?: string | null;
  warningVersion?: number;
}

// Bump when the wording or derivation of `warning` changes. Cached payloads
// from an older version still render, but skip the conditional request so the
// next successful fetch replaces the stale warning text.
const WARNING_VERSION = 2;

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
  /** GitHub API base. github.com by default; a GitHub Enterprise `/api` base otherwise. */
  apiBase?: string;
}

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

function parseApiBase(apiBase: string): URL {
  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    throw new GithubUrlError("The GitHub API base is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new GithubUrlError("The GitHub API base must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new GithubUrlError("The GitHub API base must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new GithubUrlError("The GitHub API base must not contain a query string or fragment.");
  }
  return url;
}

/**
 * The single place that decides which URL may receive the token. Returns
 * `https://api.github.com/graphql` for github.com and derives
 * `https://<host>/api/graphql` for a GitHub Enterprise API base.
 */
export function resolveGraphqlUrl(apiBase: string = GITHUB_API_BASE): string {
  const base = parseApiBase(apiBase.trim() === "" ? GITHUB_API_BASE : apiBase.trim());
  const path = base.pathname.replace(/\/+$/, "");

  if (base.hostname === "api.github.com") {
    if (path !== "") {
      throw new GithubUrlError(`github.com's API base is ${GITHUB_API_BASE}; do not add a path.`);
    }
    return GITHUB_GRAPHQL_URL;
  }

  if (path !== "" && path !== "/api") {
    throw new GithubUrlError("A GitHub Enterprise API base must look like https://ghe.example.com/api.");
  }
  return `${base.origin}/api/graphql`;
}

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
  path?: Array<string | number>;
}

type PermissionKey = "contents" | "checks" | "statuses" | "pullRequests" | "issues" | "members";

const PERMISSION_ORDER: PermissionKey[] = [
  "contents",
  "checks",
  "statuses",
  "pullRequests",
  "issues",
  "members",
];

const PERMISSION_INFO: Record<PermissionKey, { label: string; scope: "repository" | "organization" }> = {
  contents: { label: "Contents (read-only)", scope: "repository" },
  checks: { label: "Checks (read-only)", scope: "repository" },
  statuses: { label: "Commit statuses (read-only)", scope: "repository" },
  pullRequests: { label: "Pull requests (read-only)", scope: "repository" },
  issues: { label: "Issues (read-only)", scope: "repository" },
  members: { label: "Members (read-only, organization)", scope: "organization" },
};

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

function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function permissionsFor(errors: GraphQLErrorShape[]): PermissionKey[] {
  const found = new Set<PermissionKey>();
  for (const error of errors) {
    const path = error.path ?? [];
    if (path.includes("contexts")) {
      found.add("checks");
      found.add("statuses");
    } else if (path.includes("commits") || path.includes("statusCheckRollup")) {
      found.add("contents");
    } else if (path.includes("requestedReviewer")) {
      found.add("members");
    } else if (path.includes("labels") || path.includes("comments")) {
      found.add("issues");
    } else if (
      path.includes("reviewRequests") ||
      path.includes("reviews") ||
      path.includes("reviewDecision") ||
      path.includes("mergeable")
    ) {
      found.add("pullRequests");
    }
  }
  return PERMISSION_ORDER.filter((key) => found.has(key));
}

function permissionInstructions(permissions: PermissionKey[]): string {
  const labels = permissions.map((key) => PERMISSION_INFO[key]);
  const repository = labels.filter((permission) => permission.scope === "repository").map((permission) => permission.label);
  const organization = labels.filter((permission) => permission.scope === "organization").map((permission) => permission.label);
  const instructions: string[] = [];

  if (repository.length > 0) {
    instructions.push(
      `Add ${repository.length === 1 ? "this repository permission" : "these repository permissions"} to the fine-grained token: ${formatList(repository)}.`,
    );
  }
  if (organization.length > 0) {
    instructions.push(
      `Add ${organization.length === 1 ? "this organization permission" : "these organization permissions"} to the fine-grained token: ${formatList(organization)}.`,
    );
  }

  return instructions.join(" ");
}

const FALLBACK_HINT =
  "Check the token's repository access; the CI rollup needs Contents, Checks and Commit statuses (all read-only).";

function permissionHint(errors: GraphQLErrorShape[]): string {
  const permissions = permissionsFor(errors);
  if (permissions.length === 0) {
    return FALLBACK_HINT;
  }
  return `${permissionInstructions(permissions)} Then refresh.`;
}

function partialDataWarning(errors: GraphQLErrorShape[]): string {
  const permissions = permissionsFor(errors);
  const ciOnly =
    permissions.length === 0 ||
    permissions.every((key) => key === "contents" || key === "checks" || key === "statuses");
  return `${ciOnly ? "Some CI data could not be loaded." : "Some data could not be loaded."} ${permissionHint(errors)}`;
}

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

function errorsFromBody(body: unknown): GraphQLErrorShape[] {
  if (!body || typeof body !== "object") return [];
  const errors = (body as { errors?: unknown }).errors;
  return Array.isArray(errors) ? (errors as GraphQLErrorShape[]) : [];
}

function cachedWarning<T>(cached: { value: GraphQLPayload<T> } | null): string | null {
  if (!cached?.value.warning) return null;
  if (cached.value.warningVersion !== WARNING_VERSION) {
    return `Some CI data could not be loaded. ${FALLBACK_HINT}`;
  }
  return cached.value.warning;
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
  // Resolve the endpoint before touching the cache or the network: an unsafe
  // or malformed base must fail loudly and never send the token anywhere.
  const endpoint = resolveGraphqlUrl(options.apiBase);

  const key = cacheKey(query, variables);
  const cached = await readCache<GraphQLPayload<T>>(key);
  const warningOutdated =
    Boolean(cached?.value.warning) && cached?.value.warningVersion !== WARNING_VERSION;

  const headers: Record<string, string> = {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (cached?.etag && !options.force && !warningOutdated) headers["If-None-Match"] = cached.etag;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: options.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (cached) {
      return {
        data: cached.value.data,
        rateLimit: cached.value.rateLimit,
        warning: cachedWarning(cached),
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
      warning: cachedWarning(cached),
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
    const bodyErrors = errorsFromBody(body);
    const hint = permissionHint(bodyErrors);
    throw new GithubError("forbidden", `${message} ${hint}`, response.status);
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
  const warning = errors.length > 0 ? partialDataWarning(errors) : null;

  const payload: GraphQLPayload<T> = {
    data: parsed.data,
    rateLimit,
    warning,
    warningVersion: WARNING_VERSION,
  };
  const etag = response.headers.get("etag");
  const fetchedAt = Date.now();
  await writeCache({ key, value: payload, etag, fetchedAt, lastUsedAt: fetchedAt });

  return { ...payload, warning, fromCache: false, stale: false, fetchedAt, etag };
}

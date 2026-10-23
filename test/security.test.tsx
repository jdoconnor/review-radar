import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache, readCache, writeCache } from "../src/lib/cache";
import { GITHUB_GRAPHQL_URL, GithubUrlError, fetchGraphQL, resolveGraphqlUrl } from "../src/lib/github";
import { makePr, makeSearchPayload } from "./fixtures";

const TOKEN = "ghp_9f3c2b7a1d4e6f8a0b5c9d2e7f1a3b6c8d0e4f2a";
const REPLACEMENT = "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function searchResponse(nodes: unknown[]): Response {
  return jsonResponse({ data: makeSearchPayload(nodes as never) });
}

function viewerResponse(): Response {
  return jsonResponse({
    data: {
      viewer: { login: "jdoconnor" },
      rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-22T13:00:00Z", cost: 1 },
    },
  });
}

const consoleMessages: string[] = [];

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  consoleMessages.length = 0;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleMessages.push(args.map((arg) => String(arg)).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function firstFetchCall(mock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const calls = mock.mock.calls as unknown as Array<[string, RequestInit]>;
  const call = calls[0];
  if (!call) throw new Error("fetch was not called");
  return call;
}

function fetchCalls(mock: ReturnType<typeof vi.fn>): Array<[string, RequestInit]> {
  return mock.mock.calls as unknown as Array<[string, RequestInit]>;
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      variables?: { search?: string };
    };
    if (body.variables && "search" in body.variables) {
      return searchResponse([makePr()]);
    }
    return viewerResponse();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function expectTokenAbsentEverywhere(token: string): void {
  expect(localStorage.getItem("github-ui.token")).toBe(token);

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) ?? "";
    const value = localStorage.getItem(key) ?? "";
    if (key === "github-ui.token") continue;
    expect(value).not.toContain(token);
    expect(key).not.toContain(token);
  }
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index) ?? "";
    expect(key).not.toContain(token);
    expect(sessionStorage.getItem(key) ?? "").not.toContain(token);
  }

  expect(document.cookie).not.toContain(token);
  expect(window.location.href).not.toContain(token);
  expect(document.body.innerHTML).not.toContain(token);
  expect(document.title).not.toContain(token);
  for (const message of consoleMessages) expect(message).not.toContain(token);
}

describe("URL guard", () => {
  it("accepts github.com by default and for an explicit API base", () => {
    expect(resolveGraphqlUrl()).toBe(GITHUB_GRAPHQL_URL);
    expect(resolveGraphqlUrl("https://api.github.com")).toBe(GITHUB_GRAPHQL_URL);
    expect(resolveGraphqlUrl("https://api.github.com/")).toBe(GITHUB_GRAPHQL_URL);
    expect(resolveGraphqlUrl("  ")).toBe(GITHUB_GRAPHQL_URL);
  });

  it("derives /api/graphql for a GitHub Enterprise API base", () => {
    expect(resolveGraphqlUrl("https://ghe.example.com")).toBe("https://ghe.example.com/api/graphql");
    expect(resolveGraphqlUrl("https://ghe.example.com/api")).toBe("https://ghe.example.com/api/graphql");
    expect(resolveGraphqlUrl("https://ghe.example.com/api/")).toBe("https://ghe.example.com/api/graphql");
  });

  it.each([
    ["a plain-http base", "http://api.github.com"],
    ["an ftp base", "ftp://api.github.com"],
    ["embedded credentials", "https://user:secret@api.github.com"],
    ["a query string", "https://api.github.com?token=abc"],
    ["a fragment", "https://api.github.com#frag"],
    ["a path on github.com", "https://api.github.com/api"],
    ["an arbitrary path on Enterprise", "https://ghe.example.com/v1"],
    ["a non-URL", "not a url"],
  ])("rejects %s", (_label, base) => {
    expect(() => resolveGraphqlUrl(base)).toThrow(GithubUrlError);
    try {
      resolveGraphqlUrl(base);
    } catch (error) {
      expect(error).toBeInstanceOf(GithubUrlError);
      expect((error as GithubUrlError).kind).toBe("url");
    }
  });

  it("throws before fetch when the base is unsafe", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGraphQL(TOKEN, "query Viewer { viewer { login } }", {}, { apiBase: "http://api.github.com" }),
    ).rejects.toBeInstanceOf(GithubUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleMessages.join("\n")).not.toContain(TOKEN);
  });

  it("sends an Enterprise request to the derived endpoint only", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchGraphQL(TOKEN, "query Viewer { viewer { login } }", {}, {
      apiBase: "https://ghe.example.com/api",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = firstFetchCall(fetchMock);
    expect(url).toBe("https://ghe.example.com/api/graphql");
    expect((init.headers as Record<string, string>).Authorization).toBe(`bearer ${TOKEN}`);
    expect(String(init.body)).not.toContain(TOKEN);
  });
});

describe("token handling", () => {
  it("keeps the token in localStorage and nowhere else", async () => {
    const fetchMock = stubFetch();

    render(<App />);
    await userEvent.type(screen.getByLabelText("GitHub token"), TOKEN);
    await userEvent.click(screen.getByRole("button", { name: "Start reviewing" }));

    expect(await screen.findByTestId("review-queue")).toBeInTheDocument();
    expectTokenAbsentEverywhere(TOKEN);

    // Every request goes to the one allowed endpoint, with the token only in
    // the Authorization header and without cookies or a referrer.
    expect(fetchMock).toHaveBeenCalled();
    for (const [url, init] of fetchCalls(fetchMock)) {
      expect(url).toBe(GITHUB_GRAPHQL_URL);
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("omit");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(String(init.body)).not.toContain(TOKEN);
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`bearer ${TOKEN}`);
      for (const [name, value] of Object.entries(headers)) {
        if (name === "Authorization") continue;
        expect(String(value)).not.toContain(TOKEN);
      }
    }
  });

  it("shows settings copy that matches what the app can promise", async () => {
    stubFetch();
    localStorage.setItem("github-ui.token", TOKEN);

    render(<App />);
    await screen.findByTestId("review-queue");
    await userEvent.click(screen.getByTestId("open-settings"));

    const note = screen.getByTestId("token-storage-note");
    expect(note).toHaveTextContent("stored in this browser");
    expect(note).toHaveTextContent("never sent to us");
    expect(note).toHaveTextContent("cleared when you sign out");
  });

  it("signing out clears the token, cached responses and last-seen marks", async () => {
    stubFetch();
    localStorage.setItem("github-ui.token", TOKEN);
    localStorage.setItem(
      "github-ui.last-seen",
      JSON.stringify({ "jdoconnor/github-ui#42": Date.parse("2026-10-20T09:00:00Z") }),
    );
    await writeCache({
      key: "cached-review-queue",
      value: { data: { search: { nodes: [] } }, rateLimit: null },
      etag: '"etag"',
      fetchedAt: Date.now(),
      lastUsedAt: Date.now(),
    });
    expect(await readCache("cached-review-queue")).not.toBeNull();

    render(<App />);
    await screen.findByTestId("review-queue");
    await userEvent.click(screen.getByTestId("open-settings"));
    await userEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => expect(localStorage.getItem("github-ui.token")).toBeNull());
    expect(localStorage.getItem("github-ui.last-seen")).toBeNull();
    expect(await readCache("cached-review-queue")).toBeNull();
    expect(await screen.findByRole("heading", { name: /review desk/i })).toBeInTheDocument();
    expect(consoleMessages.join("\n")).not.toContain(TOKEN);
  });

  it("replacing the token clears cached responses and last-seen marks", async () => {
    stubFetch();
    localStorage.setItem("github-ui.token", TOKEN);
    localStorage.setItem("github-ui.last-seen", JSON.stringify({ "jdoconnor/github-ui#42": 1 }));
    await writeCache({
      key: "cached-review-queue",
      value: { data: { search: { nodes: [] } }, rateLimit: null },
      etag: null,
      fetchedAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    render(<App />);
    await screen.findByTestId("review-queue");
    await userEvent.click(screen.getByTestId("open-settings"));
    await userEvent.type(screen.getByLabelText("Replace token"), REPLACEMENT);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(localStorage.getItem("github-ui.token")).toBe(REPLACEMENT));
    expect(localStorage.getItem("github-ui.last-seen")).toBeNull();
    expect(await readCache("cached-review-queue")).toBeNull();
    for (let index = 0; index < sessionStorage.length; index += 1) {
      expect(sessionStorage.getItem(sessionStorage.key(index) ?? "") ?? "").not.toContain(TOKEN);
    }
    expect(consoleMessages.join("\n")).not.toContain(TOKEN);
  });
});

describe("static hosting policy", () => {
  it("publishes the security headers the architecture depends on", () => {
    const headers = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");
    const csp = headers
      .split("\n")
      .find((line) => line.trim().startsWith("Content-Security-Policy:"));

    expect(csp).toBeTruthy();
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://avatars.githubusercontent.com https://github.com",
      "connect-src 'self' https://api.github.com",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "upgrade-insecure-requests",
    ]) {
      expect(csp).toContain(directive);
    }

    expect(headers).toContain("Referrer-Policy: no-referrer");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("Permissions-Policy: camera=(), microphone=(), geolocation=()");
    expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
    expect(headers).toMatch(/GitHub Enterprise users must add their host to connect-src and img-src/i);
  });

  it("sets a no-referrer meta tag for hosts that ignore _headers", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"/i);
  });
});

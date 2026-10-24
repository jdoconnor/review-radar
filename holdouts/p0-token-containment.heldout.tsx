import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";

const TOKEN = "ghp_client_only_secret_value";

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", TOKEN);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the token in the browser and sends it only to GitHub", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          data: {
            search: { nodes: [] },
            rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-20T13:00:00Z", cost: 1 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );

  const logs: unknown[][] = [];
  vi.spyOn(console, "log").mockImplementation((...args) => logs.push(args));
  vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args));
  vi.spyOn(console, "error").mockImplementation((...args) => logs.push(args));

  render(<App />);
  await screen.findByText("No pull requests are waiting on you");

  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.url).toBe("https://api.github.com/graphql");
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(`bearer ${TOKEN}`);
  }

  expect(localStorage.getItem("review-radar.token")).toBe(TOKEN);
  expect(sessionStorage.getItem("review-radar.token")).toBeNull();
  expect(document.cookie).not.toContain(TOKEN);
  expect(window.location.href).not.toContain(TOKEN);
  expect(document.body.innerHTML).not.toContain(TOKEN);
  expect(JSON.stringify(logs)).not.toContain(TOKEN);
});

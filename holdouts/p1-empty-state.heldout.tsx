import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";

beforeEach(async () => {
  localStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", "test-token");
});

it("shows a deliberate empty state when nothing needs review", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            search: { nodes: [] },
            rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-20T13:00:00Z", cost: 1 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );

  render(<App />);

  expect(await screen.findByText("No pull requests are waiting on you")).toBeInTheDocument();
  expect(screen.queryAllByTestId("pr-row")).toHaveLength(0);
  expect(screen.queryByText("Loading pull requests…")).not.toBeInTheDocument();
});

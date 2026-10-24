import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";

beforeEach(async () => {
  localStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", "test-token");
});

it("shows the reset time and does not retry in a tight loop", async () => {
  const resetSeconds = Math.floor(Date.now() / 1000) + 3600;
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
      status: 403,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(resetSeconds),
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);

  const banner = await screen.findByTestId("rate-limit");
  expect(banner).toHaveTextContent("GitHub rate limit");
  expect(banner).toHaveTextContent("Resets at");
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
});

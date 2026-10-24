import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";

const pr = {
  id: "PR_cache",
  number: 11,
  title: "Cached across reloads",
  url: "https://github.com/jdoconnor/review-radar/pull/11",
  isDraft: false,
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-20T12:00:00Z",
  additions: 5,
  deletions: 1,
  changedFiles: 1,
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  repository: { nameWithOwner: "jdoconnor/review-radar" },
  author: { login: "alice", avatarUrl: "" },
  labels: { nodes: [] },
  reviewRequests: { totalCount: 1, nodes: [] },
  reviews: { nodes: [] },
  comments: { totalCount: 0, nodes: [] },
  commits: { nodes: [] },
};

beforeEach(async () => {
  localStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", "test-token");
});

it("keeps cached rows visible when the network is unavailable", async () => {
  let offline = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (offline) throw new TypeError("Failed to fetch");
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      const nodes = search.includes("review-requested:@me") ? [pr] : [];
      return new Response(
        JSON.stringify({
          data: {
            search: { nodes },
            rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-20T13:00:00Z", cost: 1 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );

  const first = render(<App />);
  expect(await screen.findByText("Cached across reloads")).toBeInTheDocument();
  first.unmount();

  offline = true;
  render(<App />);

  expect(await screen.findByText("Cached across reloads")).toBeInTheDocument();
  expect(await screen.findByTestId("cache-indicator")).toHaveTextContent("Cached");
  expect(await screen.findByTestId("error")).toHaveTextContent("Showing cached results");
  expect(screen.queryByText("No pull requests are waiting on you")).not.toBeInTheDocument();
});

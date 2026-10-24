import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { cacheSize, clearCache } from "../src/lib/cache";

const pr = {
  id: "PR_signout",
  number: 5,
  title: "Private pull request",
  url: "https://github.com/jdoconnor/review-radar/pull/5",
  isDraft: false,
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-20T12:00:00Z",
  additions: 1,
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
  sessionStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", "ghp_signout_secret");
  localStorage.setItem("review-radar.last-seen", JSON.stringify({ "jdoconnor/review-radar#5": 1 }));
});

it("clears the token, cached responses and last-seen marks on sign out", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
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

  render(<App />);
  expect(await screen.findByText("Private pull request")).toBeInTheDocument();

  await userEvent.click(screen.getByTestId("open-settings"));
  await userEvent.click(screen.getByTestId("sign-out"));

  expect(await screen.findByText("Your review desk, cached locally.")).toBeInTheDocument();
  expect(localStorage.getItem("review-radar.token")).toBeNull();
  expect(localStorage.getItem("review-radar.last-seen")).toBeNull();
  await waitFor(async () => expect(await cacheSize()).toBe(0));
});

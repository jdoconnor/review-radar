import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";

const reviewPr = {
  id: "PR_review",
  number: 7,
  title: "Add a repository filter",
  url: "https://github.com/jdoconnor/review-radar/pull/7",
  isDraft: false,
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-20T12:00:00Z",
  additions: 10,
  deletions: 2,
  changedFiles: 2,
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  repository: { nameWithOwner: "jdoconnor/review-radar" },
  author: { login: "alice", avatarUrl: "" },
  labels: { nodes: [] },
  reviewRequests: {
    totalCount: 1,
    nodes: [{ requestedReviewer: { __typename: "User", login: "jdoconnor" } }],
  },
  reviews: { nodes: [] },
  comments: { totalCount: 0, nodes: [] },
  commits: { nodes: [] },
};

beforeEach(async () => {
  localStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", "test-token");
});

it("renders the review queue with PRs that have an outstanding review request from me", async () => {
  const searches: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      searches.push(search);
      const nodes = search.includes("review-requested:@me") ? [reviewPr] : [];
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

  expect(await screen.findByText("Add a repository filter")).toBeInTheDocument();
  expect(screen.getByText("Needs review")).toBeInTheDocument();
  expect(screen.getByTestId("pr-repo")).toHaveTextContent("jdoconnor/review-radar");
  expect(screen.getByText("#7")).toBeInTheDocument();
  expect(
    searches.some((search) => search.includes("review-requested:@me") && search.includes("is:open")),
  ).toBe(true);
});

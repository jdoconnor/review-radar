import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";

const minePr = {
  id: "PR_mine",
  number: 42,
  title: "Ship the review dashboard",
  url: "https://github.com/jdoconnor/review-radar/pull/42",
  isDraft: false,
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-20T12:00:00Z",
  additions: 120,
  deletions: 30,
  changedFiles: 6,
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  repository: { nameWithOwner: "jdoconnor/review-radar" },
  author: { login: "jdoconnor", avatarUrl: "" },
  labels: { nodes: [] },
  reviewRequests: { totalCount: 0, nodes: [] },
  reviews: {
    nodes: [
      { id: "r1", state: "APPROVED", submittedAt: "2026-10-19T10:00:00Z", author: { login: "alice" } },
      { id: "r2", state: "APPROVED", submittedAt: "2026-10-19T11:00:00Z", author: { login: "bob" } },
    ],
  },
  comments: {
    totalCount: 1,
    nodes: [{ id: "c1", createdAt: "2026-10-20T10:00:00Z", author: { login: "carol" } }],
  },
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            state: "FAILURE",
            contexts: {
              totalCount: 2,
              nodes: [
                { __typename: "CheckRun", name: "test", conclusion: "FAILURE", status: "COMPLETED" },
                { __typename: "CheckRun", name: "lint", conclusion: "SUCCESS", status: "COMPLETED" },
              ],
            },
          },
        },
      },
    ],
  },
};

beforeEach(async () => {
  localStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", "test-token");
  localStorage.setItem("review-radar.last-seen", JSON.stringify({ "jdoconnor/review-radar#42": Date.parse("2026-10-20T09:00:00Z") }));
});

it("shows approval count, failing CI and new activity on my PRs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      const nodes = search.includes("author:@me") ? [minePr] : [];
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
  await userEvent.click(screen.getByTestId("tab-mine"));

  expect(await screen.findByText("Ship the review dashboard")).toBeInTheDocument();
  expect(screen.getByTestId("approval-pill")).toHaveTextContent("2 approvals");
  expect(screen.getByTestId("check-pill")).toHaveTextContent("1/2 failing");
  expect(screen.getByTestId("new-activity")).toHaveTextContent("1 new");
  expect(screen.getByTestId("mark-seen")).toBeInTheDocument();
});

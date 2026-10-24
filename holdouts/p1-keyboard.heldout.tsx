import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";

function makePr(number: number, title: string) {
  return {
    id: `PR_${number}`,
    number,
    title,
    url: `https://github.com/jdoconnor/review-radar/pull/${number}`,
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
}

beforeEach(async () => {
  localStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", "test-token");
});

it("moves the selection with j and k", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      const nodes = search.includes("review-requested:@me") ? [makePr(1, "First"), makePr(2, "Second")] : [];
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
  await screen.findByText("First");
  const rows = screen.getAllByTestId("pr-row");

  fireEvent.keyDown(window, { key: "j" });
  expect(rows[0]?.getAttribute("data-selected")).toBe("true");
  expect(rows[0]?.getAttribute("aria-selected")).toBe("true");

  fireEvent.keyDown(window, { key: "j" });
  expect(rows[1]?.getAttribute("data-selected")).toBe("true");

  fireEvent.keyDown(window, { key: "k" });
  expect(rows[0]?.getAttribute("data-selected")).toBe("true");

  const filter = screen.getByTestId("filter-text");
  filter.focus();
  fireEvent.keyDown(filter, { key: "j" });
  expect(rows[1]?.getAttribute("data-selected")).toBe("false");
});

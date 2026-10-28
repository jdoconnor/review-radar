import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { DEFAULT_SORT, isSortOrder } from "../src/components/ListToolbar";
import { makePr } from "./fixtures";

/**
 * The sort control used to offer "Default order", which hid a queue-dependent
 * rule (oldest first for review requests, needs attention for my pull requests)
 * behind a label that told the user nothing. These tests pin the visible orders
 * and the fallback for old links that still carry s:default.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function searchResponse(nodes: unknown[]): Response {
  return jsonResponse({
    data: {
      search: { nodes },
      viewer: { login: "jdoconnor" },
      rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-22T13:00:00Z", cost: 1 },
    },
  });
}

const REVIEW = makePr({ id: "review", number: 42, title: "Needs your review" });
const MINE = makePr({
  id: "mine",
  number: 43,
  title: "My open pull request",
  url: "https://github.com/jdoconnor/review-radar/pull/43",
});

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return search.includes("review-requested") ? searchResponse([REVIEW]) : searchResponse([MINE]);
    }),
  );
}

function sortSelect(): HTMLSelectElement {
  return screen.getByTestId("sort") as HTMLSelectElement;
}

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
  window.location.hash = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sort order", () => {
  it("opens the review queue on a named order instead of a default", async () => {
    stubFetch();
    render(<App />);

    await screen.findByText("Needs your review");
    expect(sortSelect().value).toBe("oldest");
    expect(within(sortSelect()).queryByRole("option", { name: "Default order" })).not.toBeInTheDocument();
    expect(within(sortSelect()).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Needs attention",
      "Oldest first",
      "Recently updated",
    ]);
  });

  it("keeps a chosen order when the user switches queues", async () => {
    stubFetch();
    render(<App />);

    await screen.findByText("Needs your review");
    await userEvent.selectOptions(sortSelect(), "newest");
    expect(sortSelect().value).toBe("newest");

    await userEvent.click(screen.getByTestId("tab-mine"));
    await screen.findByText("My open pull request");
    expect(sortSelect().value).toBe("newest");
  });

  it("no longer treats the old default value as a real order", () => {
    expect(isSortOrder("default")).toBe(false);
    expect(isSortOrder("oldest")).toBe(true);
    expect(DEFAULT_SORT).toEqual({ review: "oldest", mine: "attention" });
  });
});

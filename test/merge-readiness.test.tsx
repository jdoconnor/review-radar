import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import type { PullRequestNode } from "../src/lib/types";
import { makePr } from "./fixtures";

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

const GREEN_CHECKS: PullRequestNode["commits"] = {
  nodes: [
    {
      commit: {
        statusCheckRollup: {
          state: "SUCCESS",
          contexts: { totalCount: 0, nodes: [] },
        },
      },
    },
  ],
};

const READY = makePr({
  id: "mine-ready",
  number: 80,
  title: "Ready to ship",
  url: "https://github.com/jdoconnor/review-radar/pull/80",
  reviewDecision: "APPROVED",
  reviews: {
    nodes: [
      { id: "R_ready", state: "APPROVED", submittedAt: "2026-10-20T11:30:00Z", author: { login: "alice" } },
    ],
  },
  reviewRequests: { totalCount: 0, nodes: [] },
  commits: GREEN_CHECKS,
});

const WAITING = makePr({
  id: "mine-waiting",
  number: 81,
  title: "Waiting on CI and review",
  url: "https://github.com/jdoconnor/review-radar/pull/81",
});

const REVIEW = makePr({
  id: "review",
  number: 82,
  title: "Needs my review",
  url: "https://github.com/jdoconnor/review-radar/pull/82",
});

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return search.includes("review-requested")
        ? searchResponse([REVIEW])
        : searchResponse([READY, WAITING]);
    }),
  );
}

function rowFor(title: string): HTMLElement {
  const row = screen.getByText(title).closest('[data-testid="pr-row"]');
  if (!(row instanceof HTMLElement)) throw new Error(`No row rendered for ${title}`);
  return row;
}

async function openMine(): Promise<void> {
  await userEvent.click(screen.getByTestId("tab-mine"));
  await screen.findByText("Ready to ship");
  await screen.findByText("Waiting on CI and review");
}

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("merge readiness on my pull requests", () => {
  it("marks a mergeable, approved pull request as ready", async () => {
    render(<App />);
    await openMine();

    const row = rowFor("Ready to ship");
    expect(row).toHaveClass("readiness-ready");
    expect(row).toHaveAttribute("data-readiness", "ready");

    const pill = within(row).getByTestId("merge-readiness");
    expect(pill).toHaveTextContent("Ready to merge");
    expect(pill).toHaveAttribute("data-readiness", "ready");
    expect(pill).toHaveAttribute("data-blockers", "");
    expect(pill).toHaveClass("ready");
  });

  it("names what a waiting pull request is waiting on", async () => {
    render(<App />);
    await openMine();

    const row = rowFor("Waiting on CI and review");
    expect(row).toHaveClass("readiness-waiting");
    expect(row).toHaveAttribute("data-readiness", "waiting");

    const pill = within(row).getByTestId("merge-readiness");
    expect(pill).toHaveTextContent("Waiting: CI failing");
    expect(pill).toHaveAttribute("data-readiness", "waiting");
    expect(pill).toHaveAttribute("data-blockers", "ci-failing,review-required");
    expect(pill).toHaveAttribute("title", "Waiting on CI failing, Review required.");
  });

  it("summarises ready and waiting counts for the queue", async () => {
    render(<App />);
    await openMine();

    const summary = screen.getByTestId("merge-summary");
    expect(within(summary).getByTestId("ready-count")).toHaveTextContent("1 ready to merge");
    expect(within(summary).getByTestId("waiting-count")).toHaveTextContent("1 waiting on something");
  });

  it("advertises the ready count before the tab is opened", async () => {
    render(<App />);
    const badge = await screen.findByTestId("mine-ready-count");
    expect(badge).toHaveTextContent("1 ready");
  });

  it("filters the queue down to pull requests that are ready", async () => {
    render(<App />);
    await openMine();

    await userEvent.click(screen.getByTestId("filter-ready"));

    expect(screen.getByText("Ready to ship")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Waiting on CI and review")).not.toBeInTheDocument();
    });
  });

  it("leaves the review queue alone", async () => {
    render(<App />);
    await screen.findByText("Needs my review");

    expect(within(screen.getByTestId("review-queue")).queryByTestId("merge-readiness")).not.toBeInTheDocument();
  });
});

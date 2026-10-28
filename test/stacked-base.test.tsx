import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

function greenApproved(overrides: Partial<PullRequestNode>): PullRequestNode {
  return makePr({
    mergeable: "MERGEABLE",
    reviewDecision: "APPROVED",
    reviews: {
      nodes: [
        {
          id: "R_green",
          state: "APPROVED",
          submittedAt: "2026-10-20T11:30:00Z",
          author: { login: "alice" },
        },
      ],
    },
    reviewRequests: { totalCount: 0, nodes: [] },
    commits: GREEN_CHECKS,
    ...overrides,
  });
}

const STACKED = greenApproved({
  id: "mine-stacked",
  number: 90,
  title: "Stacked on a feature branch",
  url: "https://github.com/jdoconnor/review-radar/pull/90",
  baseRefName: "feat/parent",
  stack: null,
  stackEntry: null,
});

const STAGING = greenApproved({
  id: "mine-staging",
  number: 91,
  title: "Straight to staging",
  url: "https://github.com/jdoconnor/review-radar/pull/91",
  baseRefName: "staging",
  stack: null,
  stackEntry: null,
});

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return search.includes("review-requested") ? searchResponse([]) : searchResponse([STACKED, STAGING]);
    }),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function rowFor(title: string): HTMLElement {
  const row = screen.getByText(title).closest('[data-testid="pr-row"]');
  if (!(row instanceof HTMLElement)) throw new Error(`No row rendered for ${title}`);
  return row;
}

async function openMine(): Promise<void> {
  await userEvent.click(screen.getByTestId("tab-mine"));
  await screen.findByText("Stacked on a feature branch");
  await screen.findByText("Straight to staging");
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

describe("pull requests on a non-stable base", () => {
  it("is shown as a stack even without native GitHub stack data", async () => {
    render(<App />);
    await openMine();

    const row = rowFor("Stacked on a feature branch");
    expect(row).toHaveAttribute("data-in-stack", "true");
    expect(row).toHaveAttribute("data-base-ref", "feat/parent");

    const pill = within(row).getByTestId("stack-pill");
    expect(pill).toHaveTextContent("Stack");
    expect(pill).toHaveAttribute("data-stack-inferred", "true");
    expect(pill).toHaveAttribute("data-stack-base", "feat/parent");
    expect(pill).toHaveAccessibleName("Stacked on feat/parent, which is not main or staging.");
  });

  it("is waiting, not ready to merge", async () => {
    render(<App />);
    await openMine();

    const row = rowFor("Stacked on a feature branch");
    expect(row).toHaveAttribute("data-readiness", "waiting");
    expect(row).toHaveClass("readiness-waiting");

    const pill = within(row).getByTestId("merge-readiness");
    expect(pill).toHaveTextContent("Waiting: Stacked on feat/parent");
    expect(pill).toHaveAttribute("data-blockers", "stacked");
  });

  it("keeps main and staging as ready and excludes the stack from the counts", async () => {
    render(<App />);
    const badge = await screen.findByTestId("mine-ready-count");
    expect(badge).toHaveTextContent("1 ready");

    await openMine();

    const staging = rowFor("Straight to staging");
    expect(staging).toHaveAttribute("data-readiness", "ready");
    expect(within(staging).queryByTestId("stack-pill")).not.toBeInTheDocument();

    const summary = screen.getByTestId("merge-summary");
    expect(within(summary).getByTestId("ready-count")).toHaveTextContent("1 ready to merge");
    expect(within(summary).getByTestId("waiting-count")).toHaveTextContent("1 waiting on something");
  });

  it("is removed by the ready-to-merge filter", async () => {
    render(<App />);
    await openMine();

    await userEvent.click(screen.getByTestId("filter-ready"));

    expect(screen.getByText("Straight to staging")).toBeInTheDocument();
    expect(screen.queryByText("Stacked on a feature branch")).not.toBeInTheDocument();
  });
});

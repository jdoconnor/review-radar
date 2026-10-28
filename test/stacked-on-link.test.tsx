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

function pullUrl(number: number): string {
  return `https://github.com/jdoconnor/review-radar/pull/${number}`;
}

const PARENT = greenApproved({
  id: "mine-parent",
  number: 89,
  title: "Bottom of a stack",
  url: pullUrl(89),
  headRefName: "feat/parent",
  baseRefName: "main",
});

const CHILD = greenApproved({
  id: "mine-child",
  number: 90,
  title: "Stacked on the parent",
  url: pullUrl(90),
  headRefName: "feat/child",
  baseRefName: "feat/parent",
  stack: null,
  stackEntry: null,
});

/** Stub both views: the review queue stays empty, my pull requests serve `nodes`. */
function stubFetch(nodes: PullRequestNode[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return search.includes("review-requested") ? searchResponse([]) : searchResponse(nodes);
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

async function openMine(nodes: PullRequestNode[]): Promise<void> {
  stubFetch(nodes);
  render(<App />);
  await userEvent.click(screen.getByTestId("tab-mine"));
  await screen.findByText(nodes[0]!.title);
}

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the stack message on a waiting pull request", () => {
  it("links to the pull request whose head branch it merges into", async () => {
    await openMine([PARENT, CHILD]);

    const pill = within(rowFor("Stacked on the parent")).getByTestId("merge-readiness");
    expect(pill).toHaveTextContent("Waiting: Stacked on #89");

    const link = within(pill).getByTestId("stacked-on-link");
    expect(link).toHaveTextContent("Stacked on #89");
    expect(link).toHaveAttribute("href", pullUrl(89));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("is reachable by keyboard", async () => {
    await openMine([PARENT, CHILD]);

    const link = within(rowFor("Stacked on the parent")).getByTestId("stacked-on-link");
    link.focus();

    expect(link).toHaveFocus();
  });

  it("links a native stack rung without needing the parent in the view", async () => {
    const nativeChild = greenApproved({
      id: "mine-native-child",
      number: 90,
      title: "Middle of a native stack",
      url: pullUrl(90),
      baseRefName: "feat/parent",
      stack: {
        number: 4,
        size: 2,
        baseRefName: "main",
        entries: {
          nodes: [
            { position: 1, pullRequest: { number: 79, url: pullUrl(79) } },
            { position: 2, pullRequest: { number: 90, url: pullUrl(90) } },
          ],
        },
      },
      stackEntry: { position: 2 },
    });

    await openMine([nativeChild]);

    const pill = within(rowFor("Middle of a native stack")).getByTestId("merge-readiness");
    expect(within(pill).getByTestId("stacked-on-link")).toHaveAttribute("href", pullUrl(79));
  });

  it("keeps the branch name when no parent pull request is known", async () => {
    await openMine([CHILD]);

    const pill = within(rowFor("Stacked on the parent")).getByTestId("merge-readiness");
    expect(pill).toHaveTextContent("Waiting: Stacked on feat/parent");
    expect(within(pill).queryByTestId("stacked-on-link")).not.toBeInTheDocument();
  });
});

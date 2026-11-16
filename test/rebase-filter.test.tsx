import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr, makeSearchPayload } from "./fixtures";

/**
 * "Needs rebase" is a branch-state filter: GitHub reports `mergeStateStatus`
 * BEHIND when the head branch is out of date with its base. It is not the same
 * as a merge conflict, and an old cached response with no verdict at all must
 * not be swept in.
 *
 * The verdict no longer travels in the list query — folding the computed field
 * into "my pull requests" 502d it — so the list fixtures carry no verdict and
 * the lean merge-status query supplies it, by node id.
 */

const BEHIND = makePr({
  id: "mine-behind",
  number: 90,
  title: "Branch is out of date",
  url: "https://github.com/jdoconnor/review-radar/pull/90",
  mergeStateStatus: undefined,
});

const CLEAN = makePr({
  id: "mine-clean",
  number: 91,
  title: "Branch is up to date",
  url: "https://github.com/jdoconnor/review-radar/pull/91",
  mergeStateStatus: undefined,
});

const CONFLICTING = makePr({
  id: "mine-conflicting",
  number: 92,
  title: "Merge conflict, not a rebase",
  url: "https://github.com/jdoconnor/review-radar/pull/92",
  mergeable: "CONFLICTING",
  mergeStateStatus: undefined,
});

const LEGACY = makePr({
  id: "mine-legacy",
  number: 93,
  title: "Cached before the verdict",
  url: "https://github.com/jdoconnor/review-radar/pull/93",
  mergeStateStatus: undefined,
});

const REVIEW_BEHIND = makePr({
  id: "review-behind",
  number: 94,
  title: "Review request that needs a rebase",
  url: "https://github.com/jdoconnor/review-radar/pull/94",
  mergeStateStatus: undefined,
});

const REVIEW_CLEAN = makePr({
  id: "review-clean",
  number: 95,
  title: "Review request that is current",
  url: "https://github.com/jdoconnor/review-radar/pull/95",
  mergeStateStatus: undefined,
});

/** Verdicts the lean merge-status query returns, by node id. `mine-legacy`
 * is deliberately absent: neither the list nor the lean query has a verdict
 * for it, so it must never read as behind. */
const LEAN_STATUSES: Record<string, string> = {
  "mine-behind": "BEHIND",
  "mine-clean": "CLEAN",
  "mine-conflicting": "DIRTY",
  "review-behind": "BEHIND",
  "review-clean": "CLEAN",
};

const MINE_TITLES = [
  "Branch is out of date",
  "Branch is up to date",
  "Merge conflict, not a rebase",
  "Cached before the verdict",
];
const REVIEW_TITLES = ["Review request that needs a rebase", "Review request that is current"];

function visible(titles: string[]): string[] {
  return titles.filter((title) => screen.queryByText(title) !== null);
}

function stubFetch(leanStatus: "ok" | "fail" = "ok"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        variables?: { search?: string; ids?: string[] };
      };
      if (Array.isArray(body.variables?.ids)) {
        if (leanStatus === "fail") {
          return new Response("Bad Gateway", { status: 502 });
        }
        const nodes = body.variables.ids
          .filter((id) => id in LEAN_STATUSES)
          .map((id) => ({ id, mergeStateStatus: LEAN_STATUSES[id] }));
        return new Response(
          JSON.stringify({
            data: { nodes, rateLimit: makeSearchPayload([]).rateLimit },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const search = String(body.variables?.search ?? "");
      const nodes = search.includes("review-requested")
        ? [REVIEW_BEHIND, REVIEW_CLEAN]
        : [BEHIND, CLEAN, CONFLICTING, LEGACY];
      return new Response(JSON.stringify({ data: makeSearchPayload(nodes) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
  window.location.hash = "";
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("needs rebase filter", () => {
  it("keeps only the behind branches in my pull requests", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("review-queue");
    await user.click(screen.getByTestId("tab-mine"));
    await screen.findByText("Branch is out of date");
    // The rebase pill proves the lean merge-status response has landed; the
    // filter is meaningless until it has.
    await screen.findByTestId("rebase-pill");

    expect(visible(MINE_TITLES)).toEqual(MINE_TITLES);

    await user.click(screen.getByTestId("filter-rebase"));

    expect(visible(MINE_TITLES)).toEqual(["Branch is out of date"]);
    expect(screen.getByTestId("filter-rebase")).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByTestId("clear-filters"));
    expect(visible(MINE_TITLES)).toEqual(MINE_TITLES);
  });

  it("marks the branch state on the row, not just in the filter", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("review-queue");
    await user.click(screen.getByTestId("tab-mine"));
    await screen.findByText("Branch is out of date");
    await screen.findByTestId("rebase-pill");

    const behindRow = screen.getByText("Branch is out of date").closest('[data-testid="pr-row"]');
    const cleanRow = screen.getByText("Branch is up to date").closest('[data-testid="pr-row"]');
    if (!(behindRow instanceof HTMLElement) || !(cleanRow instanceof HTMLElement)) {
      throw new Error("Rows did not render");
    }

    expect(within(behindRow).getByTestId("rebase-pill")).toBeInTheDocument();
    expect(within(cleanRow).queryByTestId("rebase-pill")).not.toBeInTheDocument();
  });

  it("is offered on the review queue too and filters it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Review request that needs a rebase");
    await screen.findByTestId("rebase-pill");

    expect(visible(REVIEW_TITLES)).toEqual(REVIEW_TITLES);

    await user.click(screen.getByTestId("filter-rebase"));

    expect(visible(REVIEW_TITLES)).toEqual(["Review request that needs a rebase"]);
  });

  it("survives a reload through the URL", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Review request that needs a rebase");
    await screen.findByTestId("rebase-pill");

    await user.click(screen.getByTestId("filter-rebase"));
    await vi.waitFor(() => expect(window.location.hash).toContain("rebase"));

    // Simulate a reload: the URL survives, the React tree does not.
    cleanup();
    render(<App />);
    await screen.findByTestId("review-queue");
    await screen.findByTestId("rebase-pill");

    expect(await screen.findByTestId("filter-rebase")).toHaveAttribute("aria-pressed", "true");
    expect(visible(REVIEW_TITLES)).toEqual(["Review request that needs a rebase"]);
  });

  it("still renders the list when the lean merge-status query fails", async () => {
    const user = userEvent.setup();
    vi.unstubAllGlobals();
    stubFetch("fail");
    render(<App />);
    await screen.findByTestId("review-queue");
    await user.click(screen.getByTestId("tab-mine"));
    await screen.findByText("Branch is out of date");

    // The retry has settled by now, so the missing pill is the steady state,
    // not a race with the fetch.
    await new Promise((resolve) => setTimeout(resolve, 1600));

    expect(visible(MINE_TITLES)).toEqual(MINE_TITLES);
    expect(screen.queryByTestId("rebase-pill")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("filter-rebase"));
    expect(visible(MINE_TITLES)).toEqual([]);
  });
});

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
 */

const BEHIND = makePr({
  id: "mine-behind",
  number: 90,
  title: "Branch is out of date",
  url: "https://github.com/jdoconnor/review-radar/pull/90",
  mergeStateStatus: "BEHIND",
});

const CLEAN = makePr({
  id: "mine-clean",
  number: 91,
  title: "Branch is up to date",
  url: "https://github.com/jdoconnor/review-radar/pull/91",
  mergeStateStatus: "CLEAN",
});

const CONFLICTING = makePr({
  id: "mine-conflicting",
  number: 92,
  title: "Merge conflict, not a rebase",
  url: "https://github.com/jdoconnor/review-radar/pull/92",
  mergeable: "CONFLICTING",
  mergeStateStatus: "DIRTY",
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
  mergeStateStatus: "BEHIND",
});

const REVIEW_CLEAN = makePr({
  id: "review-clean",
  number: 95,
  title: "Review request that is current",
  url: "https://github.com/jdoconnor/review-radar/pull/95",
  mergeStateStatus: "CLEAN",
});

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

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
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

    expect(visible(REVIEW_TITLES)).toEqual(REVIEW_TITLES);

    await user.click(screen.getByTestId("filter-rebase"));

    expect(visible(REVIEW_TITLES)).toEqual(["Review request that needs a rebase"]);
  });

  it("survives a reload through the URL", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Review request that needs a rebase");

    await user.click(screen.getByTestId("filter-rebase"));
    await vi.waitFor(() => expect(window.location.hash).toContain("rebase"));

    // Simulate a reload: the URL survives, the React tree does not.
    cleanup();
    render(<App />);
    await screen.findByTestId("review-queue");

    expect(await screen.findByTestId("filter-rebase")).toHaveAttribute("aria-pressed", "true");
    expect(visible(REVIEW_TITLES)).toEqual(["Review request that needs a rebase"]);
  });
});

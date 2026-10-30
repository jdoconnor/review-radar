import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr, makeSearchPayload } from "./fixtures";

const NONE = makePr({
  id: "mine-none",
  number: 80,
  title: "Nobody asked yet",
  url: "https://github.com/jdoconnor/review-radar/pull/80",
  reviewRequests: { totalCount: 0, nodes: [] },
});

const ONE = makePr({
  id: "mine-one",
  number: 81,
  title: "One reviewer asked",
  url: "https://github.com/jdoconnor/review-radar/pull/81",
  reviewRequests: {
    totalCount: 1,
    nodes: [{ requestedReviewer: { __typename: "User", login: "alice" } }],
  },
});

const UNKNOWN = makePr({
  id: "mine-unknown",
  number: 82,
  title: "Reviewer data unavailable",
  url: "https://github.com/jdoconnor/review-radar/pull/82",
  reviewRequests: null,
});

const REVIEW = makePr({ id: "review", number: 83, title: "Waiting on my review" });

const TITLES = ["Nobody asked yet", "One reviewer asked", "Reviewer data unavailable"];

function visibleTitles(): string[] {
  return TITLES.filter((title) => screen.queryByText(title) !== null);
}

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return new Response(
        JSON.stringify({
          data: makeSearchPayload(search.includes("review-requested") ? [REVIEW] : [NONE, ONE, UNKNOWN]),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
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

describe("no reviewers preset filter", () => {
  it("filters my pull requests down to the ones nobody was asked to review", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Waiting on my review");

    await user.click(screen.getByTestId("tab-mine"));
    await screen.findByText("One reviewer asked");

    expect(visibleTitles()).toEqual(TITLES);

    await user.click(screen.getByTestId("filter-no-reviewers"));

    expect(visibleTitles()).toEqual(["Nobody asked yet"]);
    expect(screen.getByTestId("filter-no-reviewers")).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByTestId("clear-filters"));
    expect(visibleTitles()).toEqual(TITLES);
  });

  it("is not offered on the review queue, whose pull requests always name you", async () => {
    render(<App />);
    await screen.findByText("Waiting on my review");

    expect(screen.queryByTestId("filter-no-reviewers")).not.toBeInTheDocument();
  });

  it("survives a reload through the URL", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Waiting on my review");

    await user.click(screen.getByTestId("tab-mine"));
    await screen.findByText("One reviewer asked");
    await user.click(screen.getByTestId("filter-no-reviewers"));

    await vi.waitFor(() => expect(window.location.hash).toContain("no-reviewers"));

    // Simulate a reload: the URL survives, the React tree does not.
    cleanup();
    render(<App />);
    await screen.findByTestId("mine-view");

    expect(await screen.findByTestId("filter-no-reviewers")).toHaveAttribute("aria-pressed", "true");
  });
});

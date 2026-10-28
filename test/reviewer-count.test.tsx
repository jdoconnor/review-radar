import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
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

const ONE = makePr({
  id: "mine-one",
  number: 70,
  title: "One reviewer listed",
  url: "https://github.com/jdoconnor/review-radar/pull/70",
  reviewRequests: {
    totalCount: 1,
    nodes: [{ requestedReviewer: { __typename: "User", login: "alice" } }],
  },
});

const TWO = makePr({
  id: "mine-two",
  number: 71,
  title: "Two reviewers listed",
  url: "https://github.com/jdoconnor/review-radar/pull/71",
  reviewRequests: {
    totalCount: 2,
    nodes: [
      { requestedReviewer: { __typename: "User", login: "alice" } },
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
    ],
  },
});

const NONE = makePr({
  id: "mine-none",
  number: 72,
  title: "No reviewers yet",
  url: "https://github.com/jdoconnor/review-radar/pull/72",
  reviewRequests: { totalCount: 0, nodes: [] },
});

const REVIEW = makePr({
  id: "review",
  number: 73,
  title: "Waiting on my review",
  url: "https://github.com/jdoconnor/review-radar/pull/73",
  reviewRequests: {
    totalCount: 2,
    nodes: [
      { requestedReviewer: { __typename: "User", login: "alice" } },
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
    ],
  },
});

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return search.includes("review-requested")
        ? searchResponse([REVIEW])
        : searchResponse([ONE, TWO, NONE]);
    }),
  );
}

function stubWideScreen(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: true,
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

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
  stubFetch();
  stubWideScreen();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reviewer count on my pull requests", () => {
  it("shows how many reviewers are already requested", async () => {
    render(<App />);
    await screen.findByText("Two reviewers listed");

    const one = within(rowFor("One reviewer listed")).getByTestId("reviewers-pill");
    expect(one).toHaveTextContent("1 reviewer");
    expect(one).toHaveAttribute("title", "1 reviewer requested: @alice");
    expect(one).toHaveAttribute("data-count", "1");
    expect(one.querySelector("svg")).not.toBeNull();

    const two = within(rowFor("Two reviewers listed")).getByTestId("reviewers-pill");
    expect(two).toHaveTextContent("2 reviewers");
    expect(two).toHaveAttribute("title", "2 reviewers requested: @alice, Platform");
    expect(two).toHaveAttribute("data-count", "2");
    expect(two).toHaveAttribute("data-reviewer-state", "requested");
  });

  it("shrinks a pull request with no reviewers into an icon and a zero", async () => {
    render(<App />);
    await screen.findByText("No reviewers yet");

    const pill = within(rowFor("No reviewers yet")).getByTestId("reviewers-pill");
    expect(pill).toHaveTextContent("0");
    expect(pill).not.toHaveTextContent("No reviewers");
    expect(pill.querySelector("svg")).not.toBeNull();
    expect(pill).toHaveAttribute("data-count", "0");
    expect(pill).toHaveAttribute("data-reviewer-state", "none");
    expect(pill).toHaveClass("missing");
    expect(pill).toHaveAttribute(
      "title",
      "0 reviewers requested. Add a reviewer on GitHub if you meant to.",
    );
  });

  it("leaves the review queue alone", async () => {
    render(<App />);
    await screen.findByText("Waiting on my review");

    expect(within(rowFor("Waiting on my review")).queryByTestId("reviewers-pill")).not.toBeInTheDocument();
  });
});

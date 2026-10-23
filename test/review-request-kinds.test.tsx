import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr, makeSearchPayload } from "./fixtures";

const DIRECT = makePr({
  id: "direct",
  number: 61,
  title: "Direct review request",
  reviewRequests: {
    totalCount: 1,
    nodes: [{ requestedReviewer: { __typename: "User", login: "jdoconnor" } }],
  },
});

const TEAM = makePr({
  id: "team",
  number: 62,
  title: "Team review request",
  url: "https://github.com/jdoconnor/github-ui/pull/62",
  reviewRequests: {
    totalCount: 1,
    nodes: [{ requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } }],
  },
});

const BOTH = makePr({
  id: "both",
  number: 63,
  title: "Direct and team request",
  url: "https://github.com/jdoconnor/github-ui/pull/63",
  reviewRequests: {
    totalCount: 2,
    nodes: [
      { requestedReviewer: { __typename: "User", login: "jdoconnor" } },
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
    ],
  },
});

const NEITHER = makePr({
  id: "neither",
  number: 64,
  title: "Review requested from someone else",
  url: "https://github.com/jdoconnor/github-ui/pull/64",
  reviewRequests: {
    totalCount: 1,
    nodes: [{ requestedReviewer: { __typename: "User", login: "other-reviewer" } }],
  },
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ data: makeSearchPayload([DIRECT, TEAM, BOTH, NEITHER]) })),
  );
}

function rowFor(title: string): HTMLElement {
  const row = screen.getByText(title).closest('[data-testid="pr-row"]');
  if (!(row instanceof HTMLElement)) throw new Error(`No row rendered for ${title}`);
  return row;
}

function visibleTitles(): string[] {
  return ["Direct review request", "Team review request", "Direct and team request", "Review requested from someone else"].filter(
    (title) => screen.queryByText(title) !== null,
  );
}

beforeEach(async () => {
  await clearCache();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem("github-ui.token", "test-token");
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review request kinds", () => {
  it("labels a direct request with the viewer's login", async () => {
    render(<App />);
    await screen.findByText("Direct review request");

    const row = rowFor("Direct review request");
    const pill = within(row).getByTestId("direct-review");
    expect(pill).toHaveTextContent("Direct");
    expect(pill).toHaveAttribute("title", "Review requested from @jdoconnor");
    expect(within(row).queryByTestId("team-review")).not.toBeInTheDocument();
  });

  it("labels a team request with the team name", async () => {
    render(<App />);
    await screen.findByText("Team review request");

    const row = rowFor("Team review request");
    expect(within(row).getByTestId("team-review")).toHaveAttribute("title", "Platform");
    expect(within(row).queryByTestId("direct-review")).not.toBeInTheDocument();
  });

  it("shows both pills when both kinds of reviewer are requested", async () => {
    render(<App />);
    await screen.findByText("Direct and team request");

    const row = rowFor("Direct and team request");
    expect(within(row).getByTestId("direct-review")).toHaveAttribute(
      "title",
      "Review requested from @jdoconnor",
    );
    expect(within(row).getByTestId("team-review")).toHaveAttribute("title", "Platform");
  });

  it("shows no request pill when nobody matches", async () => {
    render(<App />);
    await screen.findByText("Review requested from someone else");

    const row = rowFor("Review requested from someone else");
    expect(within(row).queryByTestId("direct-review")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("team-review")).not.toBeInTheDocument();
  });

  it("filters to direct requests and then composes with team requests", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Direct review request");

    await user.click(screen.getByTestId("filter-direct"));
    expect(visibleTitles()).toEqual(["Direct review request", "Direct and team request"]);

    await user.click(screen.getByTestId("filter-team"));
    expect(visibleTitles()).toEqual(["Direct and team request"]);

    await user.click(screen.getByTestId("clear-filters"));
    expect(visibleTitles()).toHaveLength(4);
  });

  it("composes the kind filters with the text filter", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Direct review request");

    await user.click(screen.getByTestId("filter-team"));
    await user.type(screen.getByTestId("filter-text"), "direct");

    expect(visibleTitles()).toEqual(["Direct and team request"]);
  });
});

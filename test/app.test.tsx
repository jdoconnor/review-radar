import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr, makeSearchPayload } from "./fixtures";

const PR_URL = "https://github.com/jdoconnor/github-ui/pull/42";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function searchResponse(nodes: unknown[]): Response {
  return jsonResponse({
    data: {
      search: { nodes },
      rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-22T13:00:00Z", cost: 1 },
    },
  });
}

beforeEach(async () => {
  await clearCache();
  localStorage.setItem("github-ui.token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders review requests and switches to my pull requests", async () => {
    const reviewPr = makePr({ id: "review", number: 42, title: "Needs your review" });
    const minePr = makePr({
      id: "mine",
      number: 43,
      title: "My open pull request",
      url: "https://github.com/jdoconnor/github-ui/pull/43",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
        const search = String(body.variables?.search ?? "");
        return search.includes("review-requested") ? searchResponse([reviewPr]) : searchResponse([minePr]);
      }),
    );

    render(<App />);

    expect(await screen.findByText("Needs your review")).toBeInTheDocument();
    expect(screen.getByTestId("review-queue")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("tab-mine"));
    expect(await screen.findByText("My open pull request")).toBeInTheDocument();
    expect(screen.getByTestId("approval-pill")).toHaveTextContent("1 approval");
  });

  it("shows new activity since the last visit and clears it when marked seen", async () => {
    localStorage.setItem(
      "github-ui.last-seen",
      JSON.stringify({ "jdoconnor/github-ui#42": Date.parse("2026-10-20T09:00:00Z") }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => searchResponse([makePr()])),
    );

    render(<App />);
    await userEvent.click(screen.getByTestId("tab-mine"));

    const newActivity = await screen.findByTestId("new-activity");
    expect(newActivity).toHaveTextContent("2 new");

    await userEvent.click(screen.getByTestId("mark-seen"));
    await waitFor(() => expect(screen.queryByTestId("new-activity")).not.toBeInTheDocument());
  });

  it("renders an empty state when nothing needs review", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => searchResponse([])),
    );

    render(<App />);
    expect(await screen.findByText("No pull requests are waiting on you")).toBeInTheDocument();
  });

  it("surfaces an invalid token without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ message: "Bad credentials" }, 401)),
    );

    render(<App />);
    const error = await screen.findByTestId("auth-error");
    expect(error).toHaveTextContent("Token problem");
    expect(screen.getByTestId("review-queue")).toBeInTheDocument();
  });

  it("keeps cached rows visible when the network fails", async () => {
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (fail) throw new TypeError("Failed to fetch");
        return searchResponse([makePr()]);
      }),
    );

    const first = render(<App />);
    expect(await screen.findByText("Add a review queue")).toBeInTheDocument();
    first.unmount();

    fail = true;
    render(<App />);
    expect(await screen.findByText("Add a review queue")).toBeInTheDocument();
    expect(await screen.findByTestId("cache-indicator")).toBeInTheDocument();
  });
});

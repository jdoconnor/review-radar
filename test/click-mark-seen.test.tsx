import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr } from "./fixtures";

const PR_TITLE = "Add a review queue";

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

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => searchResponse([makePr()])),
  );
}

function row(): HTMLElement {
  const element = screen.getByText(PR_TITLE).closest('[data-testid="pr-row"]');
  if (!(element instanceof HTMLElement)) throw new Error("No row rendered");
  return element;
}

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
  // An old mark guarantees the fixture's comments and review count as new.
  localStorage.setItem(
    "review-radar.last-seen",
    JSON.stringify({ "jdoconnor/review-radar#42": Date.parse("2026-10-20T09:00:00Z") }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reading a pull request", () => {
  it("marks it seen when its row is clicked", async () => {
    stubFetch();
    render(<App />);
    await userEvent.click(screen.getByTestId("tab-mine"));
    expect(await screen.findByTestId("new-activity")).toHaveTextContent("2 new");

    await userEvent.click(row());

    await waitFor(() => expect(screen.queryByTestId("new-activity")).not.toBeInTheDocument());
    expect(screen.queryByTestId("mark-seen")).not.toBeInTheDocument();
    const marks = JSON.parse(localStorage.getItem("review-radar.last-seen") ?? "{}") as Record<
      string,
      number
    >;
    expect(marks["jdoconnor/review-radar#42"]).toEqual(expect.any(Number));
  });

  it("marks it seen when its title link is opened", async () => {
    stubFetch();
    render(<App />);
    await userEvent.click(screen.getByTestId("tab-mine"));
    expect(await screen.findByTestId("new-activity")).toHaveTextContent("2 new");

    await userEvent.click(within(row()).getByTestId("pr-title"));

    await waitFor(() => expect(screen.queryByTestId("new-activity")).not.toBeInTheDocument());
  });

  it("marks it seen when opened from the keyboard", async () => {
    stubFetch();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<App />);
    await userEvent.click(screen.getByTestId("tab-mine"));
    expect(await screen.findByTestId("new-activity")).toHaveTextContent("2 new");

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(open).toHaveBeenCalledWith(
      "https://github.com/jdoconnor/review-radar/pull/42",
      "_blank",
      "noopener,noreferrer",
    );
    await waitFor(() => expect(screen.queryByTestId("new-activity")).not.toBeInTheDocument());
  });

  it("leaves the mark alone when the row only takes focus", async () => {
    stubFetch();
    render(<App />);
    await userEvent.click(screen.getByTestId("tab-mine"));
    expect(await screen.findByTestId("new-activity")).toHaveTextContent("2 new");

    // Tab-focus is selection, not reading: visiting a row must not clear it.
    row().focus();

    expect(screen.getByTestId("new-activity")).toHaveTextContent("2 new");
  });
});

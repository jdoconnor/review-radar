import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr } from "./fixtures";
import type { PullRequestNode } from "../src/lib/types";

/**
 * Auto-refresh can land while the pointer rests over a card. If the list
 * re-sorts, inserts or drops a row at that moment, the card under the cursor
 * changes and the next click opens a pull request the user never aimed at.
 * These tests pin the hold: while the pointer is inside the rows, the visible
 * key order is frozen, and the newest order applies once the pointer leaves.
 */

let nodes: PullRequestNode[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function searchResponse(next: unknown[]): Response {
  return jsonResponse({
    data: {
      search: { nodes: next },
      viewer: { login: "jdoconnor" },
      rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-22T13:00:00Z", cost: 1 },
    },
  });
}

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => searchResponse(nodes)),
  );
}

const OLDER = makePr({
  id: "PR_older",
  number: 41,
  title: "Older review request",
  url: "https://github.com/jdoconnor/review-radar/pull/41",
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-20T09:00:00.000Z",
});

const NEWER = makePr({
  id: "PR_newer",
  number: 42,
  title: "Newer review request",
  url: "https://github.com/jdoconnor/review-radar/pull/42",
  createdAt: "2026-10-10T09:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
});

const ANCIENT = makePr({
  id: "PR_ancient",
  number: 40,
  title: "Forgotten review request",
  url: "https://github.com/jdoconnor/review-radar/pull/40",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-02T09:00:00.000Z",
});

function rowTitles(): string[] {
  return screen
    .queryAllByTestId("pr-row")
    .map((row) => within(row).getByTestId("pr-title").textContent ?? "");
}

function rowFor(title: string): HTMLElement {
  const element = screen.getByText(title).closest('[data-testid="pr-row"]');
  if (!(element instanceof HTMLElement)) throw new Error(`No row for ${title}`);
  return element;
}

/** Refresh both queues from the latest `nodes` without moving the pointer. */
async function pollWithoutMovingThePointer(): Promise<void> {
  fireEvent.click(screen.getByTestId("refresh-all"));
  await waitFor(() =>
    expect(screen.getByTestId("refresh-status")).toHaveTextContent("Refreshed both queues"),
  );
}

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
  window.location.hash = "";
  nodes = [OLDER, NEWER];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("holding the list still under the pointer", () => {
  it("does not insert a polled row above the card being hovered", async () => {
    stubFetch();
    render(<App />);

    await screen.findByText("Older review request");
    expect(rowTitles()).toEqual(["Older review request", "Newer review request"]);

    await userEvent.hover(rowFor("Older review request"));
    expect(screen.getByTestId("pr-rows")).toHaveAttribute("data-held", "true");

    nodes = [ANCIENT, OLDER, NEWER];
    await pollWithoutMovingThePointer();

    // The queue is oldest-first, so an unfrozen list would put the newcomer on
    // top and slide the row under the cursor down.
    expect(rowTitles()).toEqual(["Older review request", "Newer review request"]);
    expect(screen.queryByText("Forgotten review request")).not.toBeInTheDocument();

    await userEvent.unhover(rowFor("Older review request"));

    await waitFor(() =>
      expect(rowTitles()).toEqual([
        "Forgotten review request",
        "Older review request",
        "Newer review request",
      ]),
    );
    expect(screen.getByTestId("pr-rows")).toHaveAttribute("data-held", "false");
  });

  it("keeps the row that a poll dropped until the pointer leaves", async () => {
    stubFetch();
    render(<App />);

    await screen.findByText("Newer review request");
    await userEvent.hover(rowFor("Newer review request"));

    nodes = [OLDER];
    await pollWithoutMovingThePointer();

    // The hovered card must not disappear from under the cursor: its neighbours
    // would slide up into the click.
    expect(rowTitles()).toEqual(["Older review request", "Newer review request"]);

    await userEvent.unhover(rowFor("Newer review request"));

    await waitFor(() => expect(rowTitles()).toEqual(["Older review request"]));
  });

  it("applies the newest order when the pointer never entered the list", async () => {
    stubFetch();
    render(<App />);

    await screen.findByText("Older review request");
    expect(screen.getByTestId("pr-rows")).toHaveAttribute("data-held", "false");

    nodes = [ANCIENT, OLDER, NEWER];
    await pollWithoutMovingThePointer();

    await waitFor(() =>
      expect(rowTitles()).toEqual([
        "Forgotten review request",
        "Older review request",
        "Newer review request",
      ]),
    );
  });
});

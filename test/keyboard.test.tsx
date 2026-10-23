import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr } from "./fixtures";

/**
 * Keyboard navigation is part of the UI contract (AGENTS.md rule 7): the review
 * queue is meant to be driven without a mouse. These tests pin the behaviour
 * instead of leaving it implicit.
 */

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

const FIRST = makePr({
  id: "review-first",
  number: 42,
  title: "Oldest review request",
  createdAt: "2026-10-17T12:00:00.000Z",
});

const SECOND = makePr({
  id: "review-second",
  number: 43,
  title: "Newer review request",
  url: "https://github.com/jdoconnor/review-radar/pull/43",
  createdAt: "2026-10-18T12:00:00.000Z",
});

const MINE = makePr({
  id: "mine",
  number: 44,
  title: "My open pull request",
  url: "https://github.com/jdoconnor/review-radar/pull/44",
});

function stubFetch(reviewNodes: unknown[] = [FIRST, SECOND], mineNodes: unknown[] = [MINE]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return search.includes("review-requested")
        ? searchResponse(reviewNodes)
        : searchResponse(mineNodes);
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

async function renderReviewQueue(): Promise<HTMLElement[]> {
  render(<App />);
  const queue = await screen.findByTestId("review-queue");
  return within(queue).findAllByTestId("pr-row");
}

function selected(rows: HTMLElement[]): HTMLElement[] {
  return rows.filter((row) => row.dataset.selected === "true");
}

beforeEach(async () => {
  await clearCache();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("keyboard navigation", () => {
  it("selects the first row with j and walks the list with j and k", async () => {
    stubFetch();
    const rows = await renderReviewQueue();
    expect(rows).toHaveLength(2);

    fireEvent.keyDown(window, { key: "j" });
    expect(rows[0]?.dataset.selected).toBe("true");
    expect(rows[0]?.getAttribute("aria-selected")).toBe("true");
    expect(rows[1]?.dataset.selected).toBe("false");

    fireEvent.keyDown(window, { key: "j" });
    expect(rows[0]?.dataset.selected).toBe("false");
    expect(rows[1]?.dataset.selected).toBe("true");

    fireEvent.keyDown(window, { key: "k" });
    expect(rows[0]?.dataset.selected).toBe("true");
    expect(rows[1]?.dataset.selected).toBe("false");
  });

  it("moves with the arrow keys and clamps at both ends", async () => {
    stubFetch();
    const rows = await renderReviewQueue();

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(rows[0]?.dataset.selected).toBe("true");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    // Two rows, so the selection stops on the last one instead of wrapping.
    expect(rows[1]?.dataset.selected).toBe("true");
    expect(selected(rows)).toHaveLength(1);

    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(rows[0]?.dataset.selected).toBe("true");
  });

  it("leaves the selection alone while typing in the filter box", async () => {
    stubFetch();
    await renderReviewQueue();
    const queue = screen.getByTestId("review-queue");
    const search = screen.getByTestId("filter-text");

    await userEvent.click(search);
    await userEvent.type(search, "j");
    expect(search).toHaveValue("j");
    expect(selected(within(queue).queryAllByTestId("pr-row"))).toEqual([]);

    await userEvent.clear(search);
    expect(selected(within(queue).getAllByTestId("pr-row"))).toEqual([]);
  });

  it("responds to j pressed as soon as the rows commit", async () => {
    stubFetch();
    render(<App />);
    const queue = await screen.findByTestId("review-queue");
    // Deliberately synchronous: the rows exist before React has re-registered a
    // listener, which used to leave the keypress with an empty row list.
    const rows = within(queue).getAllByTestId("pr-row");

    fireEvent.keyDown(window, { key: "j" });
    expect(rows[0]?.dataset.selected).toBe("true");
  });

  it("keeps the selected row across a manual refresh", async () => {
    stubFetch();
    const rows = await renderReviewQueue();

    fireEvent.keyDown(window, { key: "j" });
    expect(rows[0]?.dataset.selected).toBe("true");

    const queue = screen.getByTestId("review-queue");
    await userEvent.click(screen.getByTestId("refresh"));

    const afterRefresh = await within(queue).findAllByTestId("pr-row");
    expect(afterRefresh).toHaveLength(2);
    expect(afterRefresh[0]?.dataset.selected).toBe("true");
  });

  it("only moves the active column on a wide screen", async () => {
    stubWideScreen();
    stubFetch();
    render(<App />);

    const review = await screen.findByTestId("review-queue");
    const reviewRows = await within(review).findAllByTestId("pr-row");
    const mineRows = await within(screen.getByTestId("mine-view")).findAllByTestId("pr-row");

    fireEvent.keyDown(window, { key: "j" });
    expect(reviewRows[0]?.dataset.selected).toBe("true");
    expect(selected(mineRows)).toEqual([]);
  });
});

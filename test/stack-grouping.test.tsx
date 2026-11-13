import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { groupStackRows, pullRequestKey, stackParents, toSummary } from "../src/lib/normalize";
import type { PullRequestNode, PullRequestSummary } from "../src/lib/types";
import { makePr } from "./fixtures";

/**
 * A stack is one unit of work: the rungs above the base cannot land until the
 * base does. These tests pin the list behaviour — the base keeps the position
 * its sort key earned, every rung stacked on it follows directly beneath and
 * indented — so a poll or a sort cannot scatter a stack through the queue.
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

function summaries(nodes: PullRequestNode[]): PullRequestSummary[] {
  const parents = stackParents(nodes);
  return nodes.map((pr) =>
    toSummary(pr, {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
      viewerLogin: "jdoconnor",
      stackedOn: parents.get(pullRequestKey(pr)) ?? null,
    }),
  );
}

const BASE = makePr({
  id: "base",
  number: 70,
  title: "Base of the stack",
  url: "https://github.com/jdoconnor/review-radar/pull/70",
  headRefName: "feat/base",
  baseRefName: "main",
  createdAt: "2026-10-18T09:00:00.000Z",
});

const CHILD = makePr({
  id: "child",
  number: 71,
  title: "Child of the stack",
  url: "https://github.com/jdoconnor/review-radar/pull/71",
  headRefName: "feat/child",
  baseRefName: "feat/base",
  stack: null,
  stackEntry: null,
  createdAt: "2026-10-19T09:00:00.000Z",
});

const GRANDCHILD = makePr({
  id: "grandchild",
  number: 72,
  title: "Tip of the stack",
  url: "https://github.com/jdoconnor/review-radar/pull/72",
  headRefName: "feat/grandchild",
  baseRefName: "feat/child",
  stack: null,
  stackEntry: null,
  createdAt: "2026-10-20T09:00:00.000Z",
});

const STANDALONE = makePr({
  id: "standalone",
  number: 73,
  title: "Standalone pull request",
  url: "https://github.com/jdoconnor/review-radar/pull/73",
  baseRefName: "main",
  stack: null,
  stackEntry: null,
  createdAt: "2026-10-17T09:00:00.000Z",
});

function keys(rows: Array<{ pr: PullRequestSummary; depth: number }>): string[] {
  return rows.map((row) => `#${row.pr.number}:${row.depth}`);
}

describe("groupStackRows", () => {
  it("moves every stacked rung under the pull request it sits on", () => {
    // Sorted newest first: the child would sort above its parent on its own.
    const rows = groupStackRows(summaries([GRANDCHILD, CHILD, BASE]));

    expect(keys(rows)).toEqual(["#70:0", "#71:1", "#72:2"]);
  });

  it("keeps the group where its base rung sorted", () => {
    const rows = groupStackRows(summaries([STANDALONE, CHILD, BASE, GRANDCHILD]));

    expect(keys(rows)).toEqual(["#73:0", "#70:0", "#71:1", "#72:2"]);
  });

  it("leaves standalone pull requests untouched", () => {
    const rows = groupStackRows(summaries([STANDALONE, BASE]));

    expect(keys(rows)).toEqual(["#73:0", "#70:0"]);
  });

  it("promotes a rung whose parent the filter hid", () => {
    const rows = groupStackRows(summaries([CHILD]));

    expect(keys(rows)).toEqual(["#71:0"]);
  });

  it("chains a native stack by position when GitHub omits the entries", () => {
    const first = makePr({
      id: "native-first",
      number: 80,
      title: "Native stack base",
      baseRefName: "main",
      stack: { number: 9, size: 2, baseRefName: "main" },
      stackEntry: { position: 1 },
    });
    const second = makePr({
      id: "native-second",
      number: 81,
      title: "Native stack tip",
      baseRefName: "feat/native",
      stack: { number: 9, size: 2, baseRefName: "main" },
      stackEntry: { position: 2 },
    });

    const rows = groupStackRows(summaries([second, first]));

    expect(keys(rows)).toEqual(["#80:0", "#81:1"]);
  });
});

function stubFetch(nodes: PullRequestNode[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return search.includes("review-requested") ? searchResponse(nodes) : searchResponse([]);
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

function renderedTitles(): string[] {
  return screen
    .getAllByTestId("pr-row")
    .map((row) => row.querySelector('[data-testid="pr-title"]')?.textContent ?? "");
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

describe("a stack in the review queue", () => {
  it("renders the rungs together and indents each one under its parent", async () => {
    // Oldest-first would put the standalone first, then the child, then the
    // parent. Grouping keeps the child beneath its parent instead.
    const child = { ...CHILD, createdAt: "2026-10-16T09:00:00.000Z" };
    stubFetch([STANDALONE, child, BASE]);

    render(<App />);
    await screen.findByText("Base of the stack");

    expect(renderedTitles()).toEqual([
      "Standalone pull request",
      "Base of the stack",
      "Child of the stack",
    ]);

    const [standaloneRow, baseRow, childRow] = screen.getAllByTestId("pr-row");
    expect(standaloneRow).toHaveAttribute("data-stack-depth", "0");
    expect(baseRow).toHaveAttribute("data-stack-depth", "0");
    expect(childRow).toHaveAttribute("data-stack-depth", "1");
    expect(childRow).toHaveClass("stacked-row");
    expect(baseRow).not.toHaveClass("stacked-row");
  });
});

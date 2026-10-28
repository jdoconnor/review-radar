import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { stackMembership } from "../src/lib/normalize";
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

const STACKED = makePr({
  id: "stacked",
  number: 80,
  title: "Middle of a stack",
  url: "https://github.com/jdoconnor/review-radar/pull/80",
  stack: { number: 7, size: 3, baseRefName: "main" },
  stackEntry: { position: 2 },
});

const STANDALONE = makePr({
  id: "standalone",
  number: 81,
  title: "Standalone pull request",
  url: "https://github.com/jdoconnor/review-radar/pull/81",
  stack: null,
  stackEntry: null,
});

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return search.includes("review-requested") ? searchResponse([STANDALONE]) : searchResponse([STACKED]);
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

describe("stack membership", () => {
  it("marks a pull request that belongs to a stack with its position", async () => {
    render(<App />);
    await screen.findByText("Middle of a stack");

    const pill = within(rowFor("Middle of a stack")).getByTestId("stack-pill");
    expect(rowFor("Middle of a stack")).toHaveAttribute("data-in-stack", "true");
    expect(pill).toHaveTextContent("Stack 2/3");
    expect(pill).toHaveAttribute("data-stack-number", "7");
    expect(pill).toHaveAttribute("data-stack-size", "3");
    expect(pill).toHaveAttribute("data-stack-position", "2");
    expect(pill).toHaveAttribute("data-stack-base", "main");
    expect(pill).toHaveAttribute(
      "title",
      "Part of a 3-pull-request stack, position 2 targeting main.",
    );
    expect(pill.querySelector("svg")).not.toBeNull();
    expect(pill).toHaveAccessibleName("Part of a 3-pull-request stack, position 2 targeting main.");
  });

  it("leaves a standalone pull request unmarked", async () => {
    render(<App />);
    await screen.findByText("Standalone pull request");

    expect(within(rowFor("Standalone pull request")).queryByTestId("stack-pill")).not.toBeInTheDocument();
    expect(rowFor("Standalone pull request")).toHaveAttribute("data-in-stack", "false");
  });
});

describe("stackMembership", () => {
  it("is null when GitHub reports no stack", () => {
    expect(stackMembership(makePr())).toBeNull();
    expect(stackMembership(makePr({ stack: null }))).toBeNull();
  });

  it("keeps the stack when the position is missing", () => {
    expect(stackMembership(makePr({ stack: { number: 2, size: 4, baseRefName: "trunk" } }))).toEqual({
      number: 2,
      size: 4,
      baseRefName: "trunk",
      position: null,
    });
  });

  it("infers a stack when the base is not main or staging", () => {
    expect(stackMembership(makePr({ stack: null, baseRefName: "feat/parent" }))).toEqual({
      number: 0,
      size: 0,
      baseRefName: "feat/parent",
      position: null,
      inferred: true,
    });
  });

  it("does not call main or staging a stack", () => {
    expect(stackMembership(makePr({ stack: null, baseRefName: "main" }))).toBeNull();
    expect(stackMembership(makePr({ stack: null, baseRefName: "staging" }))).toBeNull();
  });

  it("does not invent a stack when the base branch is unknown", () => {
    expect(stackMembership(makePr({ stack: null, baseRefName: "" }))).toBeNull();
    expect(stackMembership(makePr({ stack: null, baseRefName: undefined }))).toBeNull();
  });
});

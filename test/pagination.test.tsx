import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr } from "./fixtures";

const RATE_LIMIT = {
  limit: 5000,
  remaining: 4999,
  resetAt: "2026-10-22T13:00:00Z",
  cost: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function searchResponse(nodes: unknown[], pageInfo: { hasNextPage: boolean; endCursor: string | null }): Response {
  return jsonResponse({
    data: {
      search: { nodes, pageInfo },
      viewer: { login: "jdoconnor" },
      rateLimit: RATE_LIMIT,
    },
  });
}

function mySearchResponse(
  authored: { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } },
  assigned: { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } },
): Response {
  return jsonResponse({
    data: {
      authored,
      assigned,
      viewer: { login: "jdoconnor" },
      rateLimit: RATE_LIMIT,
    },
  });
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

interface CapturedRequest {
  query: string;
  variables: Record<string, unknown>;
}

const requests: CapturedRequest[] = [];
let failLoadMore = false;
let deferredLoadMore: {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} | null = null;

function installFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as CapturedRequest;
      requests.push(body);
      const query = String(body.query);

      if (query.includes("nodes(ids:")) {
        const ids = (body.variables.ids as string[]) ?? [];
        return jsonResponse({
          data: {
            nodes: ids.map((id) => ({ id, mergeStateStatus: "CLEAN" })),
            rateLimit: RATE_LIMIT,
          },
        });
      }

      const after = body.variables.after as string | null;
      const afterAuthored = body.variables.afterAuthored as string | null;
      const afterAssigned = body.variables.afterAssigned as string | null;
      const isLoadMore = Boolean(after ?? afterAuthored ?? afterAssigned);
      if (isLoadMore && failLoadMore) {
        return jsonResponse({ message: "GitHub returned 500." }, 500);
      }
      if (isLoadMore && deferredLoadMore) {
        return deferredLoadMore.promise;
      }

      if (query.includes("authored:")) {
        const authored =
          afterAuthored === null || afterAuthored === undefined
            ? {
                nodes: [
                  makePr({ id: "mine-a1", number: 101, title: "Mine authored one" }),
                  makePr({ id: "mine-a2", number: 102, title: "Mine authored two" }),
                ],
                pageInfo: { hasNextPage: true, endCursor: "a1" },
              }
            : {
                nodes: [makePr({ id: "mine-a3", number: 103, title: "Mine authored three" })],
                pageInfo: { hasNextPage: false, endCursor: "a2" },
              };
        const assigned =
          afterAssigned === null || afterAssigned === undefined
            ? {
                nodes: [makePr({ id: "mine-b1", number: 104, title: "Mine assigned one" })],
                pageInfo: { hasNextPage: false, endCursor: "b1" },
              }
            : { nodes: [], pageInfo: { hasNextPage: false, endCursor: "b1" } };
        return mySearchResponse(authored, assigned);
      }

      if (after === null || after === undefined) {
        return searchResponse(
          [
            makePr({ id: "review-1", number: 1, title: "Review one" }),
            makePr({ id: "review-2", number: 2, title: "Review two" }),
          ],
          { hasNextPage: true, endCursor: "r1" },
        );
      }
      return searchResponse([makePr({ id: "review-3", number: 3, title: "Review three" })], {
        hasNextPage: false,
        endCursor: "r2",
      });
    }),
  );
}

beforeEach(async () => {
  await clearCache();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
  requests.length = 0;
  failLoadMore = false;
  deferredLoadMore = null;
  stubWideScreen();
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Load more", () => {
  it("appends the next page and hides the button at the end", async () => {
    render(<App />);

    expect(await screen.findByText("Review one")).toBeInTheDocument();
    expect(screen.getByTestId("load-more-review")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("load-more-review"));

    expect(await screen.findByText("Review three")).toBeInTheDocument();
    expect(screen.queryByTestId("load-more-review")).not.toBeInTheDocument();
    expect(screen.getByText("Review one")).toBeInTheDocument();
    expect(screen.getByText("Review two")).toBeInTheDocument();

    const pageTwo = requests.find((request) => request.variables.after === "r1");
    expect(pageTwo).toBeDefined();
  });

  it("advances both cursors of my pull requests in one request", async () => {
    render(<App />);

    expect(await screen.findByText("Mine authored one")).toBeInTheDocument();
    expect(screen.getByTestId("load-more-mine")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("load-more-mine"));

    expect(await screen.findByText("Mine authored three")).toBeInTheDocument();
    expect(screen.queryByTestId("load-more-mine")).not.toBeInTheDocument();
    expect(screen.getByText("Mine assigned one")).toBeInTheDocument();

    const pageTwo = requests.find(
      (request) =>
        request.variables.afterAuthored === "a1" && request.variables.afterAssigned === "b1",
    );
    expect(pageTwo).toBeDefined();
  });

  it("shows a loading state while the next page fetches", async () => {
    let resolveDeferred!: (response: Response) => void;
    const promise = new Promise<Response>((resolve) => {
      resolveDeferred = resolve;
    });
    deferredLoadMore = { promise, resolve: resolveDeferred };

    render(<App />);
    expect(await screen.findByText("Review one")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("load-more-review"));

    const button = screen.getByTestId("load-more-review");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Loading more");

    resolveDeferred(
      searchResponse([makePr({ id: "review-3", number: 3, title: "Review three" })], {
        hasNextPage: false,
        endCursor: "r2",
      }),
    );
    expect(await screen.findByText("Review three")).toBeInTheDocument();
  });

  it("keeps the button and reports the error when the next page fails, then retries", async () => {
    failLoadMore = true;
    render(<App />);
    expect(await screen.findByText("Review one")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("load-more-review"));

    await waitFor(
      () => expect(screen.getByTestId("load-more-review-error")).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.getByTestId("load-more-review")).toBeInTheDocument();
    expect(screen.queryByText("Review three")).not.toBeInTheDocument();

    failLoadMore = false;
    await userEvent.click(screen.getByTestId("load-more-review"));
    expect(await screen.findByText("Review three")).toBeInTheDocument();
    expect(screen.queryByTestId("load-more-review-error")).not.toBeInTheDocument();
  });

  it("keeps loaded pages across a refresh", async () => {
    render(<App />);
    expect(await screen.findByText("Review one")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("load-more-review"));
    expect(await screen.findByText("Review three")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("refresh-all"));
    await waitFor(() => expect(screen.getByText("Review three")).toBeInTheDocument(), {
      timeout: 5000,
    });
  });
});

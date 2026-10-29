import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache, readCache } from "../src/lib/cache";
import { saveFilterDefaults } from "../src/lib/filterDefaults";
import { EMPTY_FILTERS } from "../src/components/ListToolbar";
import { makePr, makeSearchPayload } from "./fixtures";
import { installFakeIndexedDb } from "./fake-idb";

/**
 * The dashboard keeps tab, sort and filters in the URL and in IndexedDB. Both
 * paths have to agree on one format, and neither may write before the stored
 * state has been read: a write on mount used to replace the user's saved sort
 * with the queue default, so the review queue kept snapping back to "Oldest
 * first" on reload.
 */

const fake = installFakeIndexedDb();

const REVIEW = makePr({ id: "review", number: 42, title: "Needs your review" });
const MINE = makePr({
  id: "mine",
  number: 43,
  title: "My open pull request",
  url: "https://github.com/jdoconnor/review-radar/pull/43",
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
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
      const search = String(body.variables?.search ?? "");
      return jsonResponse({
        data: makeSearchPayload(search.includes("review-requested") ? [REVIEW] : [MINE]),
      });
    }),
  );
}

function sortSelect(): HTMLSelectElement {
  return screen.getByTestId("sort") as HTMLSelectElement;
}

function filterText(): HTMLInputElement {
  return screen.getByTestId("filter-text") as HTMLInputElement;
}

beforeEach(async () => {
  fake.reset();
  vi.stubGlobal("indexedDB", fake.factory);
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
  window.location.hash = "";
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("dashboard state persistence", () => {
  it("restores the sort order from the URL instead of the queue default", async () => {
    window.location.hash = "#/t:review/q:/s:newest";

    render(<App />);
    await screen.findByTestId("review-queue");

    await waitFor(() => expect(sortSelect().value).toBe("newest"));
  });

  it("restores filters from the URL", async () => {
    window.location.hash = "#/t:review/q:needle/s:attention";

    render(<App />);
    await screen.findByTestId("review-queue");

    await waitFor(() => expect(filterText().value).toBe("needle"));
    expect(sortSelect().value).toBe("attention");
  });

  it("writes a hash in the same format it reads", async () => {
    render(<App />);
    await screen.findByTestId("review-queue");

    await waitFor(() => expect(window.location.hash.startsWith("#/")).toBe(true));
  });

  it("keeps a chosen sort order across a reload", async () => {
    render(<App />);
    await screen.findByTestId("review-queue");
    await userEvent.selectOptions(sortSelect(), "newest");

    await waitFor(() => expect(window.location.hash).toContain("s:newest"));

    // Simulate a reload: the URL survives, the React tree does not.
    cleanup();
    render(<App />);
    await screen.findByTestId("review-queue");

    await waitFor(() => expect(sortSelect().value).toBe("newest"));
  });

  it("round-trips filter text containing hash separators", async () => {
    render(<App />);
    await screen.findByTestId("review-queue");

    const messy = "owner/repo: needle";
    await userEvent.type(filterText(), messy);
    await waitFor(() => expect(window.location.hash).toContain("owner%2Frepo%3A"));

    cleanup();
    render(<App />);
    await screen.findByTestId("review-queue");

    await waitFor(() => expect(filterText().value).toBe(messy));
  });

  it("keeps stored filter defaults when the app starts", async () => {
    const defaults = { ...EMPTY_FILTERS, text: "needle" };
    await saveFilterDefaults(defaults);

    render(<App />);
    await screen.findByTestId("review-queue");

    await waitFor(() => expect(filterText().value).toBe("needle"));
    await waitFor(async () => {
      const stored = await readCache<typeof defaults>("filter-defaults");
      expect(stored?.value.text).toBe("needle");
    });
  });
});

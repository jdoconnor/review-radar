import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache, readCache, writeCache } from "../src/lib/cache";
import { makePr, makeSearchPayload } from "./fixtures";
import { installFakeIndexedDb } from "./fake-idb";

const TOKEN = "test-token";
const fake = installFakeIndexedDb();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ data: makeSearchPayload([makePr()]) })),
  );
}

beforeEach(async () => {
  fake.reset();
  vi.stubGlobal("indexedDB", fake.factory);
  await clearCache();
  localStorage.setItem("github-ui.token", TOKEN);
  stubFetch();
});

afterEach(() => {
  fake.failPuts(false);
  vi.unstubAllGlobals();
});

describe("cache settings", () => {
  it("reports how many responses are cached", async () => {
    await writeCache({ key: "one", value: 1, etag: null, fetchedAt: 1, lastUsedAt: 1 });
    await writeCache({ key: "two", value: 2, etag: null, fetchedAt: 2, lastUsedAt: 2 });

    render(<App />);
    await screen.findByTestId("review-queue");
    await userEvent.click(screen.getByTestId("open-settings"));

    await waitFor(() => expect(screen.getByTestId("cache-stats")).toHaveTextContent(/\d+ cached responses/));
    expect(screen.queryByTestId("quota-warning")).not.toBeInTheDocument();
  });

  it("clears the cache without signing out or losing last-seen marks", async () => {
    localStorage.setItem("github-ui.last-seen", JSON.stringify({ "jdoconnor/github-ui#42": 123 }));
    await writeCache({ key: "seeded", value: 1, etag: null, fetchedAt: 1, lastUsedAt: 1 });

    render(<App />);
    await screen.findByTestId("review-queue");
    await userEvent.click(screen.getByTestId("open-settings"));
    await userEvent.click(screen.getByTestId("clear-cache"));

    await waitFor(() => expect(screen.getByTestId("cache-stats")).toHaveTextContent("0 cached responses"));
    expect(localStorage.getItem("github-ui.token")).toBe(TOKEN);
    expect(localStorage.getItem("github-ui.last-seen")).toBe(
      JSON.stringify({ "jdoconnor/github-ui#42": 123 }),
    );
    expect(await readCache("seeded")).toBeNull();
    expect(screen.getByTestId("review-queue")).toBeInTheDocument();
  });

  it("warns when the browser is out of storage and keeps working from memory", async () => {
    fake.failPuts(true);

    render(<App />);
    expect(await screen.findByTestId("review-queue")).toBeInTheDocument();
    expect(await screen.findByText("Add a review queue")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("open-settings"));
    const warning = await screen.findByTestId("quota-warning");
    expect(warning).toHaveTextContent("out of storage");
    expect(warning).toHaveTextContent("in memory");
  });
});

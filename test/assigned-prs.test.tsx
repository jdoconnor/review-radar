import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr } from "./fixtures";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const RATE_LIMIT = { limit: 5000, remaining: 4999, resetAt: "2026-10-22T13:00:00Z", cost: 1 };

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pull requests assigned to me", () => {
  it("appears in my pull requests alongside the ones I authored", async () => {
    const authored = makePr({
      id: "PR_authored",
      number: 10,
      title: "Authored by me",
      url: "https://github.com/jdoconnor/review-radar/pull/10",
    });
    const assigned = makePr({
      id: "PR_assigned",
      number: 11,
      title: "Assigned to me",
      url: "https://github.com/jdoconnor/review-radar/pull/11",
      author: { login: "alice", avatarUrl: "" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          variables?: { search?: string; assigned?: string };
        };
        const search = String(body.variables?.search ?? "");
        if (search.includes("review-requested")) {
          return jsonResponse({
            data: { search: { nodes: [] }, viewer: { login: "jdoconnor" }, rateLimit: RATE_LIMIT },
          });
        }
        expect(body.variables?.assigned).toContain("assignee:@me");
        return jsonResponse({
          data: {
            authored: { nodes: [authored] },
            assigned: { nodes: [assigned] },
            viewer: { login: "jdoconnor" },
            rateLimit: RATE_LIMIT,
          },
        });
      }),
    );

    render(<App />);
    await userEvent.click(screen.getByTestId("tab-mine"));

    expect(await screen.findByText("Authored by me")).toBeInTheDocument();
    expect(screen.getByText("Assigned to me")).toBeInTheDocument();
    expect(screen.getAllByTestId("pr-row")).toHaveLength(2);
    expect(screen.getByTestId("tab-mine")).toHaveTextContent("2");
  });
});

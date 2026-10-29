import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";
import { makePr, makeSearchPayload } from "./fixtures";

const PR_URL = "https://github.com/jdoconnor/review-radar/pull/42";

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
      viewer: { login: "jdoconnor" },
      rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-22T13:00:00Z", cost: 1 },
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

beforeEach(async () => {
  await clearCache();
  sessionStorage.clear();
  localStorage.setItem("review-radar.token", "test-token");
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
      url: "https://github.com/jdoconnor/review-radar/pull/43",
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
    expect(screen.getByTestId("list-toolbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New activity" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("tab-mine"));
    expect(await screen.findByText("My open pull request")).toBeInTheDocument();
    expect(screen.getByTestId("approval-pill")).toHaveTextContent("1 approval");
    expect(screen.getByTestId("list-toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New activity" })).toBeInTheDocument();
  });

  it("shows both queues side by side on a wide screen", async () => {
    stubWideScreen();
    const reviewPr = makePr({ id: "review", number: 42, title: "Needs your review" });
    const minePr = makePr({
      id: "mine",
      number: 43,
      title: "My open pull request",
      url: "https://github.com/jdoconnor/review-radar/pull/43",
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
    expect(await screen.findByText("My open pull request")).toBeInTheDocument();
    expect(screen.getByTestId("review-queue")).toBeInTheDocument();
    expect(screen.getByTestId("mine-view")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-review")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-mine")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Needs my review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "My pull requests" })).toBeInTheDocument();
    expect(screen.getAllByTestId("list-toolbar")).toHaveLength(1);
    expect(screen.getAllByTestId("filter-text")).toHaveLength(1);
  });

  it("filters both columns from the shared toolbar", async () => {
    stubWideScreen();
    const reviewAlpha = makePr({ id: "review-alpha", number: 50, title: "Review alpha" });
    const reviewBeta = makePr({ id: "review-beta", number: 51, title: "Review beta" });
    const mineAlpha = makePr({ id: "mine-alpha", number: 52, title: "Mine alpha" });
    const mineBeta = makePr({ id: "mine-beta", number: 53, title: "Mine beta" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
        const search = String(body.variables?.search ?? "");
        return search.includes("review-requested")
          ? searchResponse([reviewAlpha, reviewBeta])
          : searchResponse([mineAlpha, mineBeta]);
      }),
    );

    render(<App />);

    for (const title of ["Review alpha", "Review beta", "Mine alpha", "Mine beta"]) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }

    await userEvent.type(screen.getByTestId("filter-text"), "alpha");

    await waitFor(() => {
      expect(screen.queryByText("Review beta")).not.toBeInTheDocument();
      expect(screen.queryByText("Mine beta")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Review alpha")).toBeInTheDocument();
    expect(screen.getByText("Mine alpha")).toBeInTheDocument();
  });

  it("applies shared quick filters to both columns", async () => {
    stubWideScreen();
    const reviewChanges = makePr({
      id: "review-changes",
      number: 54,
      title: "Review changes",
      reviews: {
        nodes: [
          {
            id: "R_changes",
            state: "CHANGES_REQUESTED",
            submittedAt: "2026-10-20T11:30:00.000Z",
            author: { login: "alice" },
          },
        ],
      },
    });
    const mineClean = makePr({ id: "mine-clean", number: 55, title: "Mine clean" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
        const search = String(body.variables?.search ?? "");
        return search.includes("review-requested") ? searchResponse([reviewChanges]) : searchResponse([mineClean]);
      }),
    );

    render(<App />);

    expect(await screen.findByText("Review changes")).toBeInTheDocument();
    expect(await screen.findByText("Mine clean")).toBeInTheDocument();

    const changes = screen.getByRole("button", { name: "Changes requested" });
    expect(changes).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(changes);

    expect(changes).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Review changes")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Mine clean")).not.toBeInTheDocument());

    await userEvent.click(screen.getByTestId("clear-filters"));
    expect(await screen.findByText("Mine clean")).toBeInTheDocument();
  });

  it("shows whether the viewer or someone else approved a pull request", async () => {
    const approvedByViewer = makePr({
      id: "self-approved",
      number: 44,
      title: "Already approved by you",
      reviews: {
        nodes: [
          {
            id: "R_self",
            state: "APPROVED",
            submittedAt: "2026-10-20T11:30:00.000Z",
            author: { login: "jdoconnor" },
          },
        ],
      },
    });
    const approvedByOther = makePr({
      id: "other-approved",
      number: 45,
      title: "Approved by someone else",
      reviews: {
        nodes: [
          {
            id: "R_other",
            state: "APPROVED",
            submittedAt: "2026-10-20T11:30:00.000Z",
            author: { login: "alice" },
          },
        ],
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
        const search = String(body.variables?.search ?? "");
        return search.includes("review-requested")
          ? searchResponse([approvedByViewer])
          : searchResponse([approvedByOther]);
      }),
    );

    render(<App />);

    expect(await screen.findByText("Already approved by you")).toBeInTheDocument();
    expect(screen.getByTestId("approval-pill")).toHaveTextContent("You approved");
    expect(screen.getByTestId("approval-pill")).toHaveTextContent("1 approval");

    await userEvent.click(screen.getByTestId("tab-mine"));
    expect(await screen.findByText("Approved by someone else")).toBeInTheDocument();
    expect(screen.getByTestId("approval-pill")).toHaveTextContent("1 approval by others");
  });

  it("shows approval, conflict, CI and comment state as icons with tooltips", async () => {
    const pr = makePr({
      id: "status-icons",
      number: 46,
      title: "Status icons",
      mergeable: "CONFLICTING",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => searchResponse([pr])),
    );

    render(<App />);
    expect(await screen.findByText("Status icons")).toBeInTheDocument();

    const approval = screen.getByTestId("approval-pill");
    expect(approval).toHaveAttribute("title", "1 approval by others");
    expect(approval).not.toHaveClass("pill");

    const conflict = screen.getByTestId("conflict-pill");
    expect(conflict).toHaveAttribute("title", "Merge conflicts");
    expect(conflict).not.toHaveClass("pill");

    const check = screen.getByTestId("check-pill");
    expect(check).toHaveAttribute("title", "1/2 failing");
    expect(check).not.toHaveClass("pill");

    const comments = screen.getByTestId("comments");
    expect(comments).toHaveAttribute("title", "3 comments");
    expect(comments).not.toHaveClass("pill");

    const statusIcons = screen.getByTestId("status-icons");
    expect(statusIcons).toContainElement(approval);
    expect(statusIcons).toContainElement(conflict);
    expect(statusIcons).toContainElement(check);
    expect(statusIcons).toContainElement(comments);
  });

  it("shows new activity since the last visit and clears it when marked seen", async () => {
    localStorage.setItem(
      "review-radar.last-seen",
      JSON.stringify({ "jdoconnor/review-radar#42": Date.parse("2026-10-20T09:00:00Z") }),
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

  it("seeds an activity baseline so later activity can be detected", async () => {
    const pr = makePr();
    const respond = (nodes: unknown[]) =>
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { variables?: { search?: string } };
        const search = String(body.variables?.search ?? "");
        return search.includes("review-requested") ? searchResponse([]) : searchResponse(nodes);
      });
    vi.stubGlobal("fetch", respond([pr]));

    render(<App />);
    await userEvent.click(screen.getByTestId("tab-mine"));
    await screen.findByText(pr.title);

    await waitFor(() => {
      expect(localStorage.getItem("review-radar.activity-baseline")).toEqual(expect.any(String));
    });
    expect(screen.queryByTestId("new-activity")).not.toBeInTheDocument();

    const baseline = Number(localStorage.getItem("review-radar.activity-baseline"));
    const later = makePr({
      comments: {
        totalCount: 4,
        nodes: [
          ...(makePr().comments?.nodes ?? []),
          { id: "C_4", createdAt: new Date(baseline + 1000).toISOString(), author: { login: "dave" } },
        ],
      },
    });
    vi.stubGlobal("fetch", respond([later]));

    await userEvent.click(screen.getByTestId("refresh-all"));
    expect(await screen.findByTestId("new-activity")).toHaveTextContent("1 new");
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

  it("keeps pull requests when the token cannot read their commits", async () => {
    const pr = makePr({ commits: { nodes: [null] } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: {
            search: { nodes: [pr] },
            viewer: { login: "jdoconnor" },
            rateLimit: { limit: 5000, remaining: 4999, resetAt: "2026-10-22T13:00:00Z", cost: 1 },
          },
          errors: [
            { type: "FORBIDDEN", message: "Resource not accessible by personal access token" },
            { type: "FORBIDDEN", message: "Resource not accessible by personal access token" },
          ],
        }),
      ),
    );

    render(<App />);
    expect(await screen.findByText("Add a review queue")).toBeInTheDocument();
    const warning = await screen.findByTestId("permission-warning");
    expect(warning).toHaveTextContent("Limited data");
    expect(warning).toHaveTextContent("Contents, Checks and Commit statuses");
    expect(screen.queryByTestId("permission-error")).not.toBeInTheDocument();
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

  it("switches between dark and light themes and remembers the choice", async () => {
    localStorage.setItem("review-radar.theme", "dark");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => searchResponse([makePr()])),
    );

    render(<App />);

    expect(await screen.findByTestId("review-queue")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    const toggle = screen.getByTestId("theme-toggle");
    expect(toggle).toHaveAccessibleName("Switch to light theme");

    await userEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("review-radar.theme")).toBe("light");
    expect(toggle).toHaveAccessibleName("Switch to dark theme");
  });

  it("offers an explicit theme choice in settings", async () => {
    localStorage.setItem("review-radar.theme", "dark");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => searchResponse([makePr()])),
    );

    render(<App />);

    expect(await screen.findByTestId("review-queue")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("open-settings"));

    const select = screen.getByLabelText("Theme");
    expect(select).toHaveValue("dark");

    await userEvent.selectOptions(select, "light");

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("review-radar.theme")).toBe("light");
  });

  it("themes the token setup screen and toggles before sign-in", async () => {
    localStorage.removeItem("review-radar.token");
    localStorage.setItem("review-radar.theme", "dark");

    render(<App />);

    expect(screen.getByRole("heading", { name: /review desk/i })).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("theme-toggle"));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("review-radar.theme")).toBe("light");
  });
});

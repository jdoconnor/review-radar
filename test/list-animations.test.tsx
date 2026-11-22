import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullRequestList } from "../src/components/PullRequestList";
import { EMPTY_FILTERS } from "../src/components/ListToolbar";
import { toSummary } from "../src/lib/normalize";
import type { PullRequestSummary } from "../src/lib/types";
import { makePr } from "./fixtures";

function summary(id: string, number: number, title: string): PullRequestSummary {
  return toSummary(makePr({ id, number, title }), {
    lastSeenAt: null,
    reviewRequestedFromMe: true,
    viewerLogin: "jdoconnor",
  });
}

function renderList(items: PullRequestSummary[]) {
  return render(
    <PullRequestList
      kind="review"
      active
      items={items}
      loading={false}
      filters={EMPTY_FILTERS}
      sort="attention"
      searchRef={createRef<HTMLInputElement>()}
      viewerLogin="jdoconnor"
      error={null}
      warning={null}
      stale={false}
      fromCache={false}
      lastUpdated={null}
      hasMore={false}
      loadingMore={false}
      loadMoreError={null}
      onLoadMore={() => {}}
      onActivate={() => {}}
      onMarkSeen={() => {}}
      onRefresh={() => {}}
    />,
  );
}

const one = summary("PR_1", 1, "First pull request");
const two = summary("PR_2", 2, "Second pull request");

afterEach(() => {
  vi.useRealTimers();
});

describe("list animations", () => {
  it("marks rows as entering when they first appear, staggered", () => {
    renderList([one, two]);
    const rows = screen.getAllByTestId("pr-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveAttribute("data-phase", "enter");
      expect(row.className).toContain("pr-row--entering");
    }
    // The second row waits a beat behind the first.
    expect(rows[0]!.style.getPropertyValue("--enter-delay")).toBe("0ms");
    expect(rows[1]!.style.getPropertyValue("--enter-delay")).toBe("45ms");
  });

  it("removes a vanished row immediately and leaves a brief poof behind", () => {
    vi.useFakeTimers();
    const { rerender } = renderList([one, two]);
    act(() => {
      vi.advanceTimersByTime(1000); // let the enter phase settle
    });

    rerender(
      <PullRequestList
        kind="review"
        active
        items={[one]}
        loading={false}
        filters={EMPTY_FILTERS}
        sort="attention"
        searchRef={createRef<HTMLInputElement>()}
        viewerLogin="jdoconnor"
        error={null}
        warning={null}
        stale={false}
        fromCache={false}
        lastUpdated={null}
        hasMore={false}
        loadingMore={false}
        loadMoreError={null}
        onLoadMore={() => {}}
        onActivate={() => {}}
        onMarkSeen={() => {}}
        onRefresh={() => {}}
      />,
    );

    // The departed row is gone in the same commit — no lingering copy for
    // text or test-id queries to trip over — and a decorative poof marks
    // where it left.
    expect(screen.getAllByTestId("pr-row")).toHaveLength(1);
    expect(screen.queryByText("Second pull request")).not.toBeInTheDocument();
    const poofs = screen.getAllByTestId("row-poof");
    expect(poofs).toHaveLength(1);
    expect(poofs[0]!).toHaveAttribute("aria-hidden", "true");

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByTestId("row-poof")).toBeNull();
    expect(screen.getAllByTestId("pr-row")).toHaveLength(1);
  });

  it("does not re-animate rows that stay put across a rerender", () => {
    vi.useFakeTimers();
    const { rerender } = renderList([one, two]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    for (const row of screen.getAllByTestId("pr-row")) {
      expect(row).toHaveAttribute("data-phase", "stay");
    }
    rerender(
      <PullRequestList
        kind="review"
        active
        items={[one, two]}
        loading={false}
        filters={EMPTY_FILTERS}
        sort="attention"
        searchRef={createRef<HTMLInputElement>()}
        viewerLogin="jdoconnor"
        error={null}
        warning={null}
        stale={false}
        fromCache={false}
        lastUpdated={null}
        hasMore={false}
        loadingMore={false}
        loadMoreError={null}
        onLoadMore={() => {}}
        onActivate={() => {}}
        onMarkSeen={() => {}}
        onRefresh={() => {}}
      />,
    );
    for (const row of screen.getAllByTestId("pr-row")) {
      expect(row).toHaveAttribute("data-phase", "stay");
    }
    expect(screen.queryByTestId("row-poof")).toBeNull();
  });
});

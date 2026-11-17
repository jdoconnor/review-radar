import { describe, expect, it } from "vitest";
import {
  MERGE_STATUS_BATCH_SIZE,
  MERGE_STATUS_QUERY,
  MY_PRS_QUERY,
  PAGE_SIZE,
  REVIEW_QUEUE_QUERY,
  cacheKeyFor,
  mergeNodePages,
  mergeStatusBatches,
  mergeStatuses,
  myHasMorePages,
  myPageInfo,
  myPullRequests,
  nextMyCursors,
  nextReviewCursors,
  reviewHasMorePages,
  reviewPageInfo,
  variablesFor,
  withMergeStatuses,
} from "../src/lib/queries";
import type { MergeStatusPayload, MySearchPayload, SearchPayload } from "../src/lib/types";
import { makePr, makeSearchPayload } from "./fixtures";

const RATE_LIMIT = makeSearchPayload([]).rateLimit;

describe("my pull requests search", () => {
  it("asks for authored and assigned pull requests", () => {
    const variables = variablesFor("mine");
    expect(String(variables.search)).toContain("author:@me");
    expect(String(variables.assigned)).toContain("assignee:@me");
    expect(String(variables.assigned)).toContain("is:pr is:open");
  });

  it("does not OR two qualifiers, which GitHub search rejects", () => {
    const variables = variablesFor("mine");
    expect(String(variables.search)).not.toContain(" OR ");
    expect(String(variables.assigned)).not.toContain(" OR ");
  });
});

describe("list pagination", () => {
  it("fetches 25 pull requests per page with cursor pagination", () => {
    expect(PAGE_SIZE).toBe(25);
    for (const query of [REVIEW_QUEUE_QUERY, MY_PRS_QUERY]) {
      expect(query).toContain("first: 25");
      expect(query).toContain("pageInfo { hasNextPage endCursor }");
    }
    expect(REVIEW_QUEUE_QUERY).toContain("$after: String");
    expect(MY_PRS_QUERY).toContain("$afterAuthored: String");
    expect(MY_PRS_QUERY).toContain("$afterAssigned: String");
  });

  it("passes no cursor for the first page and the cursors after that", () => {
    expect(variablesFor("review")).toEqual({
      search: expect.stringContaining("review-requested"),
      after: null,
    });
    expect(variablesFor("review", { after: "cursor-1" }).after).toBe("cursor-1");
    expect(variablesFor("mine", { after: "a-1", afterAssigned: "b-1" })).toEqual({
      search: expect.stringContaining("author:@me"),
      assigned: expect.stringContaining("assignee:@me"),
      afterAuthored: "a-1",
      afterAssigned: "b-1",
    });
  });

  it("keys the cache per page, so pages do not overwrite each other", () => {
    expect(cacheKeyFor("review")).not.toBe(cacheKeyFor("review", { after: "cursor-1" }));
    expect(cacheKeyFor("review", { after: "cursor-1" })).toBe(
      cacheKeyFor("review", { after: "cursor-1" }),
    );
  });

  it("reads pageInfo and reports whether another page exists", () => {
    const withMore: SearchPayload = {
      ...makeSearchPayload([makePr({ id: "PR_1" })]),
      search: {
        nodes: [makePr({ id: "PR_1" })],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
    };
    expect(reviewPageInfo(withMore)).toEqual({ hasNextPage: true, endCursor: "cursor-1" });
    expect(reviewHasMorePages(withMore)).toBe(true);
    expect(nextReviewCursors(withMore)).toEqual({ after: "cursor-1" });

    const lastPage: SearchPayload = {
      ...withMore,
      search: { nodes: [], pageInfo: { hasNextPage: false, endCursor: "cursor-2" } },
    };
    expect(reviewHasMorePages(lastPage)).toBe(false);

    // A legacy cached response without pageInfo reads as a single page.
    expect(reviewPageInfo(makeSearchPayload([]))).toBeNull();
    expect(reviewHasMorePages(makeSearchPayload([]))).toBe(false);
    expect(nextReviewCursors(makeSearchPayload([]))).toEqual({ after: null });
  });

  it("reads both halves of my pull requests and their cursors", () => {
    const payload: MySearchPayload = {
      authored: {
        nodes: [makePr({ id: "PR_a" })],
        pageInfo: { hasNextPage: true, endCursor: "a-1" },
      },
      assigned: {
        nodes: [makePr({ id: "PR_b" })],
        pageInfo: { hasNextPage: false, endCursor: "b-1" },
      },
      rateLimit: RATE_LIMIT,
    };
    expect(myPageInfo(payload)).toEqual({
      authored: { hasNextPage: true, endCursor: "a-1" },
      assigned: { hasNextPage: false, endCursor: "b-1" },
    });
    expect(myHasMorePages(payload)).toBe(true);
    expect(nextMyCursors(payload)).toEqual({ after: "a-1", afterAssigned: "b-1" });

    const done: MySearchPayload = {
      ...payload,
      authored: { nodes: [], pageInfo: { hasNextPage: false, endCursor: "a-2" } },
    };
    expect(myHasMorePages(done)).toBe(false);
    // The exhausted half re-sends its last cursor, which answers an empty page.
    expect(nextMyCursors(done)).toEqual({ after: "a-2", afterAssigned: "b-1" });
  });

  it("merges pages in order, keeping a pull request that moved once", () => {
    const first = makePr({ id: "PR_1", number: 1 });
    const second = makePr({ id: "PR_2", number: 2 });
    const third = makePr({ id: "PR_3", number: 3 });
    expect(
      mergeNodePages([
        [first, second],
        [second, third],
      ]).map((pr) => pr.id),
    ).toEqual(["PR_1", "PR_2", "PR_3"]);
  });
});

describe("list queries", () => {
  it("do not ask for mergeStateStatus", () => {
    // The verdict is computed per pull request: folding it into the list
    // queries pushed "my pull requests" past GitHub's ~10s timeout (502).
    expect(REVIEW_QUEUE_QUERY).not.toContain("mergeStateStatus");
    expect(MY_PRS_QUERY).not.toContain("mergeStateStatus");
  });
});

describe("merge status query", () => {
  it("asks for the verdict by node id and nothing else per pull request", () => {
    expect(MERGE_STATUS_QUERY).toContain("nodes(ids: $ids)");
    expect(MERGE_STATUS_QUERY).toContain("mergeStateStatus");
    expect(MERGE_STATUS_QUERY).not.toContain("statusCheckRollup");
    expect(MERGE_STATUS_QUERY).not.toContain("reviews(");
    expect(MERGE_STATUS_QUERY).not.toContain("search(");
  });

  it("batches ids at the batch size, deduplicated in first-seen order", () => {
    const ids = Array.from({ length: MERGE_STATUS_BATCH_SIZE + 5 }, (_, i) => `PR_${i % 52}`);
    const batches = mergeStatusBatches(ids);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MERGE_STATUS_BATCH_SIZE);
    expect(batches[1]).toHaveLength(2);
    expect(batches[0]?.[0]).toBe("PR_0");
    expect(batches[1]?.[0]).toBe("PR_50");
  });

  it("returns no batches for no ids", () => {
    expect(mergeStatusBatches([])).toEqual([]);
  });

  it("maps node ids to verdicts, skipping nulls and verdict-less nodes", () => {
    const payload: MergeStatusPayload = {
      nodes: [
        { id: "PR_1", mergeStateStatus: "BEHIND" },
        { id: "PR_2", mergeStateStatus: "CLEAN" },
        { id: "PR_3", mergeStateStatus: null },
        null,
      ],
      rateLimit: RATE_LIMIT,
    };
    expect([...mergeStatuses(payload).entries()]).toEqual([
      ["PR_1", "BEHIND"],
      ["PR_2", "CLEAN"],
    ]);
  });

  it("overlays lean verdicts and keeps the list verdict when unanswered", () => {
    const behind = makePr({ id: "PR_behind", number: 1, mergeStateStatus: undefined });
    const legacy = makePr({ id: "PR_legacy", number: 2, mergeStateStatus: "BEHIND" });
    const overlaid = withMergeStatuses([behind, legacy], new Map([["PR_behind", "BEHIND"]]));
    expect(overlaid[0]?.mergeStateStatus).toBe("BEHIND");
    expect(overlaid[1]?.mergeStateStatus).toBe("BEHIND");
  });

  it("lets a fresh lean verdict win over a stale cached one", () => {
    const stale = makePr({ id: "PR_stale", number: 3, mergeStateStatus: "BEHIND" });
    const overlaid = withMergeStatuses([stale], new Map([["PR_stale", "CLEAN"]]));
    expect(overlaid[0]?.mergeStateStatus).toBe("CLEAN");
  });
});

describe("myPullRequests", () => {
  it("merges authored and assigned pull requests", () => {
    const authored = makePr({ id: "PR_authored", number: 1 });
    const assigned = makePr({
      id: "PR_assigned",
      number: 2,
      author: { login: "alice", avatarUrl: "" },
    });
    const payload: MySearchPayload = {
      authored: { nodes: [authored] },
      assigned: { nodes: [assigned] },
      rateLimit: RATE_LIMIT,
    };

    expect(myPullRequests(payload).map((pr) => pr.id)).toEqual(["PR_authored", "PR_assigned"]);
  });

  it("lists a pull request that is both authored and assigned only once", () => {
    const both = makePr({ id: "PR_both", number: 3 });
    const payload: MySearchPayload = {
      authored: { nodes: [both] },
      assigned: { nodes: [both] },
      rateLimit: RATE_LIMIT,
    };

    expect(myPullRequests(payload)).toHaveLength(1);
  });

  it("reads a legacy cached response with a single search connection", () => {
    const mine = makePr({ id: "PR_legacy", number: 4 });
    const payload = makeSearchPayload([mine]);

    expect(myPullRequests(payload).map((pr) => pr.id)).toEqual(["PR_legacy"]);
  });

  it("drops non-pull-request search nodes", () => {
    const mine = makePr({ id: "PR_only", number: 5 });
    const payload: MySearchPayload = {
      authored: { nodes: [mine, {}] },
      assigned: { nodes: [{}] },
      rateLimit: RATE_LIMIT,
    };

    expect(myPullRequests(payload).map((pr) => pr.id)).toEqual(["PR_only"]);
  });
});

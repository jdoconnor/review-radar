import { describe, expect, it } from "vitest";
import {
  MERGE_STATUS_BATCH_SIZE,
  MERGE_STATUS_QUERY,
  MY_PRS_QUERY,
  REVIEW_QUEUE_QUERY,
  mergeStatusBatches,
  mergeStatuses,
  myPullRequests,
  variablesFor,
  withMergeStatuses,
} from "../src/lib/queries";
import type { MergeStatusPayload, MySearchPayload } from "../src/lib/types";
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

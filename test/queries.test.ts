import { describe, expect, it } from "vitest";
import { myPullRequests, variablesFor } from "../src/lib/queries";
import type { MySearchPayload } from "../src/lib/types";
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

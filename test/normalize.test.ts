import { describe, expect, it } from "vitest";
import {
  approvalCount,
  changesRequestedCount,
  countMergeReadiness,
  filterSummaries,
  latestReviews,
  sortForAttention,
  stackParents,
  summarizeChecks,
  toSummary,
  clockTime,
} from "../src/lib/normalize";
import type { PullRequestNode } from "../src/lib/types";
import { makePr } from "./fixtures";

const GREEN_CHECKS: PullRequestNode["commits"] = {
  nodes: [
    {
      commit: {
        statusCheckRollup: {
          state: "SUCCESS",
          contexts: { totalCount: 0, nodes: [] },
        },
      },
    },
  ],
};

function readyPr(overrides: Partial<PullRequestNode> = {}): PullRequestNode {
  return makePr({
    reviewDecision: "APPROVED",
    reviews: {
      nodes: [
        { id: "R_ready", state: "APPROVED", submittedAt: "2026-10-20T11:00:00Z", author: { login: "alice" } },
      ],
    },
    reviewRequests: { totalCount: 0, nodes: [] },
    commits: GREEN_CHECKS,
    ...overrides,
  });
}

function readinessOf(pr: PullRequestNode) {
  return toSummary(pr, { lastSeenAt: null, reviewRequestedFromMe: false }).readiness;
}


describe("latestReviews", () => {
  it("keeps only the most recent review per author", () => {
    const reviews = latestReviews([
      { id: "1", state: "CHANGES_REQUESTED", submittedAt: "2026-10-19T10:00:00Z", author: { login: "alice" } },
      { id: "2", state: "APPROVED", submittedAt: "2026-10-19T12:00:00Z", author: { login: "alice" } },
      { id: "3", state: "APPROVED", submittedAt: "2026-10-18T10:00:00Z", author: { login: "bob" } },
    ]);
    expect(approvalCount(reviews)).toBe(2);
    expect(changesRequestedCount(reviews)).toBe(0);
  });

  it("ignores anonymous and dismissed reviews", () => {
    const reviews = latestReviews([
      { id: "1", state: "APPROVED", submittedAt: null, author: null },
      { id: "2", state: "DISMISSED", submittedAt: "2026-10-19T12:00:00Z", author: { login: "alice" } },
    ]);
    expect(approvalCount(reviews)).toBe(0);
  });

  it("does not let a later comment revoke an approval", () => {
    const reviews = latestReviews([
      { id: "1", state: "APPROVED", submittedAt: "2026-10-19T10:00:00Z", author: { login: "alice" } },
      { id: "2", state: "COMMENTED", submittedAt: "2026-10-19T12:00:00Z", author: { login: "alice" } },
    ]);
    expect(approvalCount(reviews)).toBe(1);
  });
});

describe("summarizeChecks", () => {
  it("counts failing and pending contexts", () => {
    const summary = summarizeChecks(
      makePr({
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  state: "FAILURE",
                  contexts: {
                    totalCount: 3,
                    nodes: [
                      { __typename: "CheckRun", name: "test", conclusion: "FAILURE", status: "COMPLETED" },
                      { __typename: "CheckRun", name: "e2e", conclusion: "IN_PROGRESS", status: "IN_PROGRESS" },
                      { __typename: "StatusContext", context: "ci", state: "SUCCESS" },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    );
    expect(summary.state).toBe("failure");
    expect(summary.failing).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.total).toBe(3);
  });

  it("returns unknown when there is no rollup", () => {
    expect(summarizeChecks(makePr({ commits: null })).state).toBe("unknown");
  });

  it("uses the rollup state when individual contexts are forbidden", () => {
    const summary = summarizeChecks(
      makePr({
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  state: "FAILURE",
                  contexts: { totalCount: 20, nodes: [null, null, null] },
                },
              },
            },
          ],
        },
      }),
    );
    expect(summary.state).toBe("failure");
    expect(summary.total).toBe(20);
    expect(summary.failing).toBe(0);
    expect(summary.pending).toBe(0);
  });
});

describe("toSummary", () => {
  it("counts new activity from other people after last seen", () => {
    const pr = makePr();
    const summary = toSummary(pr, {
      lastSeenAt: Date.parse("2026-10-20T09:00:00Z"),
      reviewRequestedFromMe: false,
    });
    // One comment from carol, one review from alice; bob's comment is older
    // and the author's own comment is excluded.
    expect(summary.newActivity).toBe(2);
  });

  it("reports no new activity before the first visit", () => {
    const summary = toSummary(makePr(), { lastSeenAt: null, reviewRequestedFromMe: true });
    expect(summary.newActivity).toBe(0);
    expect(summary.reviewRequestedFromMe).toBe(true);
  });

  it("summarises approvals and changes requested", () => {
    const pr = makePr({
      reviews: {
        nodes: [
          { id: "1", state: "APPROVED", submittedAt: "2026-10-19T10:00:00Z", author: { login: "alice" } },
          { id: "2", state: "CHANGES_REQUESTED", submittedAt: "2026-10-19T11:00:00Z", author: { login: "bob" } },
        ],
      },
    });
    const summary = toSummary(pr, { lastSeenAt: null, reviewRequestedFromMe: false });
    expect(summary.approvals).toBe(1);
    expect(summary.changesRequested).toBe(1);
  });

  it("separates the viewer's approval from approvals by others", () => {
    const pr = makePr({
      reviews: {
        nodes: [
          { id: "1", state: "APPROVED", submittedAt: "2026-10-19T10:00:00Z", author: { login: "alice" } },
          { id: "2", state: "APPROVED", submittedAt: "2026-10-19T11:00:00Z", author: { login: "jdoconnor" } },
        ],
      },
    });
    const summary = toSummary(pr, {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
      viewerLogin: "jdoconnor",
    });
    expect(summary.approvals).toBe(2);
    expect(summary.approvedByViewer).toBe(true);
    expect(summary.approvalsByOthers).toBe(1);
    expect(summary.viewerKnown).toBe(true);
  });

  it("marks approvals by others when the viewer has not approved", () => {
    const pr = makePr();
    const summary = toSummary(pr, {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
      viewerLogin: "jdoconnor",
    });
    expect(summary.approvals).toBe(1);
    expect(summary.approvedByViewer).toBe(false);
    expect(summary.approvalsByOthers).toBe(1);
  });

  it("uses the latest review when the viewer changes their mind", () => {
    const pr = makePr({
      reviews: {
        nodes: [
          { id: "1", state: "APPROVED", submittedAt: "2026-10-19T10:00:00Z", author: { login: "jdoconnor" } },
          { id: "2", state: "CHANGES_REQUESTED", submittedAt: "2026-10-19T11:00:00Z", author: { login: "jdoconnor" } },
        ],
      },
    });
    const summary = toSummary(pr, {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
      viewerLogin: "jdoconnor",
    });
    expect(summary.approvals).toBe(0);
    expect(summary.approvedByViewer).toBe(false);
    expect(summary.approvalsByOthers).toBe(0);
    expect(summary.changesRequested).toBe(1);
  });
});

describe("sortForAttention", () => {
  it("puts changes requested and failing CI ahead of approvals", () => {
    const urgent = toSummary(
      makePr({
        id: "urgent",
        number: 1,
        reviews: {
          nodes: [{ id: "1", state: "CHANGES_REQUESTED", submittedAt: "2026-10-19T10:00:00Z", author: { login: "a" } }],
        },
      }),
      { lastSeenAt: null, reviewRequestedFromMe: false },
    );
    const approved = toSummary(makePr({ id: "approved", number: 2, reviewDecision: "APPROVED" }), {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
    });
    expect(sortForAttention([approved, urgent])[0]?.number).toBe(1);
  });
});

describe("merge readiness", () => {
  it("is ready when the review is approved, checks are green and the branch is mergeable", () => {
    expect(readinessOf(readyPr())).toEqual({ state: "ready", blockers: [], reasons: [] });
  });

  it("is not ready when the base is not main or staging", () => {
    const readiness = readinessOf(readyPr({ baseRefName: "feat/parent" }));
    expect(readiness.state).toBe("waiting");
    expect(readiness.blockers).toEqual(["stacked"]);
    expect(readiness.reasons).toEqual(["Stacked on feat/parent"]);
    expect(readiness.stackedOn).toBeUndefined();
  });

  it("names and points at the pull request a stack waits on", () => {
    const parent = { number: 79, url: "https://github.com/jdoconnor/review-radar/pull/79" };
    const readiness = toSummary(readyPr({ baseRefName: "feat/parent" }), {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
      stackedOn: parent,
    }).readiness;
    expect(readiness.blockers).toEqual(["stacked"]);
    expect(readiness.reasons).toEqual(["Stacked on #79"]);
    expect(readiness.stackedOn).toEqual(parent);
  });

  it("stays ready for a pull request that targets staging", () => {
    expect(readinessOf(readyPr({ baseRefName: "staging" }))).toEqual({
      state: "ready",
      blockers: [],
      reasons: [],
    });
  });

  it("lists CI and review blockers in a stable order", () => {
    const readiness = readinessOf(makePr());
    expect(readiness.state).toBe("waiting");
    expect(readiness.blockers).toEqual(["ci-failing", "review-required"]);
    expect(readiness.reasons).toEqual(["CI failing", "Review required"]);
  });

  it("treats drafts and conflicts as blockers", () => {
    expect(readinessOf(readyPr({ isDraft: true })).blockers).toEqual(["draft"]);
    expect(readinessOf(readyPr({ mergeable: "CONFLICTING" })).blockers).toEqual(["conflicts"]);
  });

  it("waits while checks are still running", () => {
    const readiness = readinessOf(
      readyPr({
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  state: "PENDING",
                  contexts: {
                    totalCount: 1,
                    nodes: [
                      { __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: null },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    );
    expect(readiness.blockers).toEqual(["ci-running"]);
  });

  it("does not also demand a fresh review when changes were requested", () => {
    const readiness = readinessOf(
      readyPr({
        reviewDecision: "CHANGES_REQUESTED",
        reviews: {
          nodes: [
            { id: "R", state: "CHANGES_REQUESTED", submittedAt: "2026-10-20T11:00:00Z", author: { login: "alice" } },
          ],
        },
      }),
    );
    expect(readiness.blockers).toEqual(["changes-requested"]);
  });

  it("waits on requested reviewers when no approval rule is enforced yet", () => {
    const readiness = readinessOf(
      readyPr({
        reviewDecision: null,
        reviews: { nodes: [] },
        reviewRequests: {
          totalCount: 2,
          nodes: [{ requestedReviewer: { __typename: "User", login: "alice" } }],
        },
      }),
    );
    expect(readiness.blockers).toEqual(["reviewers-requested"]);
  });

  it("does not require a review when none is requested or enforced", () => {
    const readiness = readinessOf(
      readyPr({
        reviewDecision: null,
        reviews: { nodes: [] },
        reviewRequests: { totalCount: 0, nodes: [] },
      }),
    );
    expect(readiness.state).toBe("ready");
  });

  it("does not claim ready while mergeability is unknown", () => {
    expect(readinessOf(readyPr({ mergeable: "UNKNOWN" })).blockers).toEqual(["mergeability-unknown"]);
  });

  it("counts ready and waiting pull requests", () => {
    const items = [
      readyPr({ id: "a", number: 1 }),
      makePr({ id: "b", number: 2 }),
      readyPr({ id: "c", number: 3 }),
    ].map((pr) => toSummary(pr, { lastSeenAt: null, reviewRequestedFromMe: false }));
    expect(countMergeReadiness(items)).toEqual({ ready: 2, waiting: 1 });
  });

  it("surfaces ready pull requests above waiting ones in the attention sort", () => {
    const ready = toSummary(readyPr({ id: "ready", number: 1 }), {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
    });
    const waiting = toSummary(makePr({ id: "waiting", number: 2 }), {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
    });
    expect(sortForAttention([waiting, ready])[0]?.number).toBe(1);
  });
});

describe("stackParents", () => {
  const pullUrl = (number: number) => `https://github.com/jdoconnor/review-radar/pull/${number}`;

  it("points an inferred stack at the pull request whose head is its base", () => {
    const parent = makePr({
      id: "parent",
      number: 79,
      url: pullUrl(79),
      headRefName: "feat/parent",
      baseRefName: "main",
    });
    const child = makePr({ id: "child", number: 80, headRefName: "feat/child", baseRefName: "feat/parent" });

    expect(stackParents([parent, child])).toEqual(
      new Map([["jdoconnor/review-radar#80", { number: 79, url: pullUrl(79) }]]),
    );
  });

  it("resolves nothing when the parent is not in the loaded view", () => {
    const child = makePr({ id: "child", number: 80, headRefName: "feat/child", baseRefName: "feat/parent" });
    expect(stackParents([child]).size).toBe(0);
  });

  it("does not match a head branch in another repository", () => {
    const parent = makePr({
      id: "parent",
      number: 79,
      headRefName: "feat/parent",
      repository: { nameWithOwner: "someone/else" },
    });
    const child = makePr({ id: "child", number: 80, headRefName: "feat/child", baseRefName: "feat/parent" });
    expect(stackParents([parent, child]).size).toBe(0);
  });

  it("leaves native stacks to GitHub's own entries", () => {
    const other = makePr({ id: "other", number: 79, headRefName: "feat/parent" });
    const child = makePr({
      id: "child",
      number: 80,
      baseRefName: "feat/parent",
      stack: { number: 3, size: 2, baseRefName: "main" },
      stackEntry: { position: 2 },
    });
    expect(stackParents([other, child]).size).toBe(0);
  });
});

describe("filterSummaries", () => {
  it("searches title, repo, author and labels", () => {
    const summary = toSummary(makePr(), { lastSeenAt: null, reviewRequestedFromMe: false });
    expect(
      filterSummaries([summary], {
        text: "review queue",
        repo: "",
        onlyFailing: false,
        onlyChanges: false,
        onlyNew: false,
      }),
    ).toHaveLength(1);
    expect(
      filterSummaries([summary], {
        text: "nope",
        repo: "",
        onlyFailing: false,
        onlyChanges: false,
        onlyNew: false,
      }),
    ).toHaveLength(0);
  });
});

const BASE_FILTERS = {
  text: "",
  repo: "",
  onlyFailing: false,
  onlyChanges: false,
  onlyNew: false,
  onlyDirect: false,
  onlyTeam: false,
  onlyReady: false,
  onlyNoReviewers: false,
};

function summaryWithReviewers(
  number: number,
  nodes: Array<{ requestedReviewer: { __typename: "User"; login: string } | { __typename: "Team"; name: string; slug: string } | null }>,
) {
  return toSummary(
    makePr({
      id: `pr-${number}`,
      number,
      title: `Pull request ${number}`,
      reviewRequests: { totalCount: nodes.length, nodes },
    }),
    { lastSeenAt: null, reviewRequestedFromMe: true, viewerLogin: "jdoconnor" },
  );
}

describe("review request kinds", () => {
  it("marks a direct request when the viewer is named", () => {
    const summary = summaryWithReviewers(1, [
      { requestedReviewer: { __typename: "User", login: "jdoconnor" } },
    ]);
    expect(summary.directReviewRequest).toBe(true);
    expect(summary.teamReviewRequests).toEqual([]);
  });

  it("compares logins case-insensitively and ignores other people", () => {
    const summary = summaryWithReviewers(2, [
      { requestedReviewer: { __typename: "User", login: "JDOCONNOR" } },
      { requestedReviewer: { __typename: "User", login: "someone-else" } },
    ]);
    expect(summary.directReviewRequest).toBe(true);

    const other = summaryWithReviewers(3, [
      { requestedReviewer: { __typename: "User", login: "someone-else" } },
    ]);
    expect(other.directReviewRequest).toBe(false);
  });

  it("does not guess a direct request when the viewer is unknown", () => {
    const summary = toSummary(
      makePr({
        reviewRequests: {
          totalCount: 1,
          nodes: [{ requestedReviewer: { __typename: "User", login: "jdoconnor" } }],
        },
      }),
      { lastSeenAt: null, reviewRequestedFromMe: true },
    );
    expect(summary.directReviewRequest).toBe(false);
  });

  it("collects team names, falls back to the slug, and drops nameless teams", () => {
    const summary = summaryWithReviewers(4, [
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
      { requestedReviewer: { __typename: "Team", name: "", slug: "design" } },
      { requestedReviewer: { __typename: "Team", name: "  ", slug: "  " } },
      { requestedReviewer: null },
    ]);
    expect(summary.teamReviewRequests).toEqual(["Platform", "design"]);
    expect(summary.directReviewRequest).toBe(false);
  });

  it("deduplicates a team that appears twice", () => {
    const summary = summaryWithReviewers(5, [
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
    ]);
    expect(summary.teamReviewRequests).toEqual(["Platform"]);
  });

  it("reports both kinds at once", () => {
    const summary = summaryWithReviewers(6, [
      { requestedReviewer: { __typename: "User", login: "jdoconnor" } },
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
    ]);
    expect(summary.directReviewRequest).toBe(true);
    expect(summary.teamReviewRequests).toEqual(["Platform"]);
  });

  it("filters by kind and composes with the text filter", () => {
    const direct = summaryWithReviewers(7, [
      { requestedReviewer: { __typename: "User", login: "jdoconnor" } },
    ]);
    const team = summaryWithReviewers(8, [
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
    ]);
    const both = summaryWithReviewers(9, [
      { requestedReviewer: { __typename: "User", login: "jdoconnor" } },
      { requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } },
    ]);
    const neither = summaryWithReviewers(10, [
      { requestedReviewer: { __typename: "User", login: "someone-else" } },
    ]);

    expect(filterSummaries([direct, team, both, neither], { ...BASE_FILTERS, onlyDirect: true })).toEqual([
      direct,
      both,
    ]);
    expect(filterSummaries([direct, team, both, neither], { ...BASE_FILTERS, onlyTeam: true })).toEqual([
      team,
      both,
    ]);
    expect(
      filterSummaries([direct, team, both, neither], { ...BASE_FILTERS, onlyDirect: true, onlyTeam: true }),
    ).toEqual([both]);
    expect(
      filterSummaries([direct, team, both, neither], { ...BASE_FILTERS, onlyTeam: true, text: "9" }),
    ).toEqual([both]);
    expect(filterSummaries([direct, team, both, neither], { ...BASE_FILTERS, onlyTeam: true, text: "7" })).toEqual(
      [],
    );
  });
});

describe("reviewer count", () => {
  it("counts users and teams and labels them for a tooltip", () => {
    const summary = summaryWithReviewers(11, [
      { requestedReviewer: { __typename: "User", login: "alice" } },
      { requestedReviewer: { __typename: "Team", name: "", slug: "platform" } },
    ]);
    expect(summary.pendingReviewRequests).toBe(2);
    expect(summary.requestedReviewers).toEqual(["@alice", "platform"]);
    expect(summary.reviewersKnown).toBe(true);
  });

  it("uses totalCount even when the node page is shorter", () => {
    const summary = toSummary(
      makePr({
        reviewRequests: {
          totalCount: 25,
          nodes: [{ requestedReviewer: { __typename: "User", login: "alice" } }],
        },
      }),
      { lastSeenAt: null, reviewRequestedFromMe: false },
    );
    expect(summary.pendingReviewRequests).toBe(25);
    expect(summary.requestedReviewers).toEqual(["@alice"]);
  });

  it("distinguishes zero reviewers from unknown reviewer data", () => {
    const none = toSummary(
      makePr({ reviewRequests: { totalCount: 0, nodes: [] } }),
      { lastSeenAt: null, reviewRequestedFromMe: false },
    );
    expect(none.pendingReviewRequests).toBe(0);
    expect(none.reviewersKnown).toBe(true);

    const unknown = toSummary(makePr({ reviewRequests: null }), {
      lastSeenAt: null,
      reviewRequestedFromMe: false,
    });
    expect(unknown.pendingReviewRequests).toBe(0);
    expect(unknown.reviewersKnown).toBe(false);
  });
});

describe("no reviewers filter", () => {
  function withReviewRequests(number: number, reviewRequests: PullRequestNode["reviewRequests"]) {
    return toSummary(
      makePr({
        id: `pr-${number}`,
        number,
        title: `Pull request ${number}`,
        reviewRequests,
      }),
      { lastSeenAt: null, reviewRequestedFromMe: false },
    );
  }

  it("keeps only pull requests with no reviewer requested and known reviewer data", () => {
    const none = withReviewRequests(20, { totalCount: 0, nodes: [] });
    const user = withReviewRequests(21, {
      totalCount: 1,
      nodes: [{ requestedReviewer: { __typename: "User", login: "alice" } }],
    });
    const team = withReviewRequests(22, {
      totalCount: 1,
      nodes: [{ requestedReviewer: { __typename: "Team", name: "Platform", slug: "platform" } }],
    });
    const unknown = withReviewRequests(23, null);

    expect(filterSummaries([none, user, team, unknown], { ...BASE_FILTERS, onlyNoReviewers: true })).toEqual([
      none,
    ]);
    expect(filterSummaries([none, user, team, unknown], BASE_FILTERS)).toEqual([none, user, team, unknown]);
  });

  it("composes with the other quick filters", () => {
    const none = toSummary(
      makePr({
        id: "pr-24",
        number: 24,
        title: "Pull request 24",
        reviewRequests: { totalCount: 0, nodes: [] },
        commits: GREEN_CHECKS,
      }),
      { lastSeenAt: null, reviewRequestedFromMe: false },
    );
    const failing = toSummary(
      makePr({
        id: "pr-25",
        number: 25,
        title: "Pull request 25",
        reviewRequests: { totalCount: 0, nodes: [] },
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  state: "FAILURE",
                  contexts: {
                    totalCount: 1,
                    nodes: [{ __typename: "CheckRun", name: "test", conclusion: "FAILURE" }],
                  },
                },
              },
            },
          ],
        },
      }),
      { lastSeenAt: null, reviewRequestedFromMe: false },
    );

    expect(
      filterSummaries([none, failing], { ...BASE_FILTERS, onlyNoReviewers: true, onlyFailing: true }),
    ).toEqual([failing]);
  });
});

describe("clockTime", () => {
  it("shows only the viewer's local time for today", () => {
    const now = new Date(2026, 9, 29, 15, 30).getTime();
    const thisMorning = new Date(2026, 9, 29, 9, 5).getTime();
    const label = clockTime(thisMorning, now);
    expect(label).toBe(
      new Date(thisMorning).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    );
    expect(label).not.toMatch(/Oct/);
  });

  it("includes the date when the data is not from today", () => {
    const now = new Date(2026, 9, 29, 15, 30).getTime();
    const yesterday = new Date(2026, 9, 28, 22, 10).getTime();
    expect(clockTime(yesterday, now)).toBe(
      new Date(yesterday).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    expect(clockTime(yesterday, now)).toMatch(/Oct/);
  });

  it("returns an empty label for an invalid timestamp", () => {
    expect(clockTime(Number.NaN)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import {
  approvalCount,
  changesRequestedCount,
  filterSummaries,
  latestReviews,
  sortForAttention,
  summarizeChecks,
  toSummary,
} from "../src/lib/normalize";
import { makePr } from "./fixtures";

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

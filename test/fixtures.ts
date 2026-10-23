import type { PullRequestNode, SearchPayload } from "../src/lib/types";

export function makePr(overrides: Partial<PullRequestNode> = {}): PullRequestNode {
  const now = new Date("2026-10-20T12:00:00.000Z").toISOString();
  return {
    id: "PR_1",
    number: 42,
    title: "Add a review queue",
    url: "https://github.com/jdoconnor/github-ui/pull/42",
    isDraft: false,
    createdAt: "2026-10-18T12:00:00.000Z",
    updatedAt: now,
    additions: 120,
    deletions: 30,
    changedFiles: 6,
    mergeable: "MERGEABLE",
    reviewDecision: "REVIEW_REQUIRED",
    repository: { nameWithOwner: "jdoconnor/github-ui" },
    author: { login: "jdoconnor", avatarUrl: "https://example.com/avatar.png" },
    labels: { nodes: [{ name: "feature", color: "6ea8fe" }] },
    reviewRequests: {
      totalCount: 1,
      nodes: [{ requestedReviewer: { __typename: "User", login: "reviewer" } }],
    },
    reviews: {
      nodes: [
        {
          id: "R_1",
          state: "APPROVED",
          submittedAt: "2026-10-20T11:30:00.000Z",
          author: { login: "alice" },
        },
      ],
    },
    comments: {
      totalCount: 3,
      nodes: [
        {
          id: "C_1",
          createdAt: "2026-10-19T13:00:00.000Z",
          author: { login: "bob" },
        },
        {
          id: "C_2",
          createdAt: "2026-10-20T10:00:00.000Z",
          author: { login: "carol" },
        },
        {
          id: "C_3",
          createdAt: "2026-10-20T11:00:00.000Z",
          author: { login: "jdoconnor" },
        },
      ],
    },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: "FAILURE",
              contexts: {
                totalCount: 2,
                nodes: [
                  { __typename: "CheckRun", name: "test", conclusion: "FAILURE", status: "COMPLETED" },
                  { __typename: "CheckRun", name: "lint", conclusion: "SUCCESS", status: "COMPLETED" },
                ],
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

export function makeSearchPayload(nodes: PullRequestNode[]): SearchPayload {
  return {
    search: { nodes },
    viewer: { login: "jdoconnor" },
    rateLimit: {
      limit: 5000,
      remaining: 4999,
      resetAt: "2026-10-20T13:00:00.000Z",
      cost: 1,
    },
  };
}

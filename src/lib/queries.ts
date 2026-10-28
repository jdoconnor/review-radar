import { cacheKey } from "./cache";
import type { PullRequestNode, SearchPayload, ViewerPayload } from "./types";

const PR_FIELDS = `
  id
  number
  title
  url
  isDraft
  createdAt
  updatedAt
  additions
  deletions
  changedFiles
  mergeable
  reviewDecision
  baseRefName
  headRefName
  repository { nameWithOwner }
  author { login avatarUrl }
  labels(first: 20) { nodes { name color } }
  reviewRequests(first: 20) {
    totalCount
    nodes {
      requestedReviewer {
        __typename
        ... on User { login }
        ... on Team { name slug }
      }
    }
  }
  stack {
    number
    size
    baseRefName
    entries(first: 100) {
      nodes {
        position
        pullRequest { number url }
      }
    }
  }
  stackEntry {
    position
  }
  reviews(last: 50) {
    nodes { id state submittedAt author { login } }
  }
  comments(last: 50) {
    totalCount
    nodes { id createdAt author { login } }
  }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun { name conclusion status }
              ... on StatusContext { context state }
            }
          }
        }
      }
    }
  }
`;

const RATE_LIMIT = `rateLimit { limit remaining resetAt cost }`;

function searchQuery(): string {
  return `
    query ReviewRadar($search: String!) {
      search(query: $search, type: ISSUE, first: 50) {
        nodes {
          ... on PullRequest {
            ${PR_FIELDS}
          }
        }
      }
      viewer { login }
      ${RATE_LIMIT}
    }
  `;
}

export const REVIEW_QUEUE_QUERY = searchQuery();
export const MY_PRS_QUERY = searchQuery();

export const VIEWER_QUERY = `
  query Viewer {
    viewer { login avatarUrl name }
    ${RATE_LIMIT}
  }
`;

export type SearchKind = "review" | "mine";

export function searchText(kind: SearchKind): string {
  return kind === "review"
    ? "is:pr is:open review-requested:@me archived:false sort:updated-desc"
    : "is:pr is:open author:@me archived:false sort:updated-desc";
}

export function queryFor(kind: SearchKind): string {
  return kind === "review" ? REVIEW_QUEUE_QUERY : MY_PRS_QUERY;
}

export function variablesFor(kind: SearchKind): Record<string, unknown> {
  return { search: searchText(kind) };
}

export function cacheKeyFor(kind: SearchKind): string {
  return cacheKey(queryFor(kind), variablesFor(kind));
}

/** Pull requests out of a search connection, dropping non-PR nodes/issues. */
export function pullRequests(payload: SearchPayload): PullRequestNode[] {
  return payload.search.nodes.filter((node): node is PullRequestNode => {
    const candidate = node as Partial<PullRequestNode>;
    return typeof candidate.id === "string" && typeof candidate.number === "number";
  });
}

export function isViewerPayload(payload: unknown): payload is ViewerPayload {
  return Boolean(payload && typeof payload === "object" && "viewer" in payload);
}

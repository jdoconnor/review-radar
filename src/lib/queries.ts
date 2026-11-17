import { cacheKey } from "./cache";
import type {
  MergeStateStatus,
  MergeStatusPayload,
  MySearchPayload,
  PageInfo,
  PullRequestNode,
  SearchPayload,
  ViewerPayload,
} from "./types";

/** How many pull requests one list request fetches. The first page is 25;
 * "Load more" fetches the next 25, so the initial load stays small and fast
 * instead of walking up to 100 pull requests in one request. */
export const PAGE_SIZE = 25;

/**
 * The fields every list row needs. Deliberately no `mergeStateStatus`: GitHub
 * computes that verdict per pull request, and folding it into these queries
 * pushed "my pull requests" — two searches of 50 at the time, each already
 * walking the head commit and its full check rollup — past GitHub's ~10s
 * GraphQL timeout, which answers 502. The verdict travels in
 * MERGE_STATUS_QUERY instead, after a list loads. The lists now fetch 25
 * pull requests per page (see PAGE_SIZE) and page lazily from there.
 */
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
    query ReviewRadar($search: String!, $after: String) {
      search(query: $search, type: ISSUE, first: ${PAGE_SIZE}, after: $after) {
        pageInfo { hasNextPage endCursor }
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

/**
 * "My pull requests" combines the PRs the viewer authored with the PRs they
 * were assigned. GitHub search cannot OR two qualifiers — `author:@me OR
 * assignee:@me` is rejected because logical operators apply to text, not
 * qualifiers — so the view runs two aliased searches in the same request. That
 * keeps the one-request-per-view rule and lets a PR that is both authored and
 * assigned be deduplicated locally.
 */
function mySearchQuery(): string {
  return `
    query ReviewRadar($search: String!, $assigned: String!, $afterAuthored: String, $afterAssigned: String) {
      authored: search(query: $search, type: ISSUE, first: ${PAGE_SIZE}, after: $afterAuthored) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ... on PullRequest {
            ${PR_FIELDS}
          }
        }
      }
      assigned: search(query: $assigned, type: ISSUE, first: ${PAGE_SIZE}, after: $afterAssigned) {
        pageInfo { hasNextPage endCursor }
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
export const MY_PRS_QUERY = mySearchQuery();

export const VIEWER_QUERY = `
  query Viewer {
    viewer { login avatarUrl name }
    ${RATE_LIMIT}
  }
`;

/** How many pull requests one merge-status request covers. */
export const MERGE_STATUS_BATCH_SIZE = 50;

/**
 * Merge status, and nothing else. `nodes(ids:)` takes the global ids the list
 * queries already returned, so this document never changes shape: only the
 * variables do. Asked on its own, without the rollup, reviews, comments and
 * stack selections, the computed verdict is cheap; folded into the list query
 * it timed the request out.
 */
export const MERGE_STATUS_QUERY = `
  query MergeStatus($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequest {
        id
        mergeStateStatus
      }
    }
    ${RATE_LIMIT}
  }
`;

export type SearchKind = "review" | "mine";

export function searchText(kind: SearchKind): string {
  return kind === "review"
    ? "is:pr is:open review-requested:@me archived:false sort:updated-desc"
    : "is:pr is:open author:@me archived:false sort:updated-desc";
}

/** The second half of "my pull requests": open PRs assigned to the viewer. */
export function assignedSearchText(): string {
  return "is:pr is:open assignee:@me archived:false sort:updated-desc";
}

/**
 * Cursor variables for the next page of a list. `after` is the cursor of the
 * first (or only) search connection — the review queue's single search, or the
 * authored half of "my pull requests". `afterAssigned` is the assigned half's
 * cursor and is unused for the review queue. All null for the first page.
 */
export interface PageCursors {
  after?: string | null;
  afterAssigned?: string | null;
}

export function queryFor(kind: SearchKind): string {
  return kind === "review" ? REVIEW_QUEUE_QUERY : MY_PRS_QUERY;
}

export function variablesFor(kind: SearchKind, cursors?: PageCursors): Record<string, unknown> {
  return kind === "review"
    ? { search: searchText(kind), after: cursors?.after ?? null }
    : {
        search: searchText(kind),
        assigned: assignedSearchText(),
        afterAuthored: cursors?.after ?? null,
        afterAssigned: cursors?.afterAssigned ?? null,
      };
}

export function cacheKeyFor(kind: SearchKind, cursors?: PageCursors): string {
  return cacheKey(queryFor(kind), variablesFor(kind, cursors));
}

/** The pageInfo of the review queue's single search connection, if the
 * response carried one. A legacy cached response without pageInfo reads as
 * a single page. */
export function reviewPageInfo(payload: SearchPayload): PageInfo | null {
  return payload.search.pageInfo ?? null;
}

/** Whether the review queue has another page after this one. */
export function reviewHasMorePages(payload: SearchPayload): boolean {
  return reviewPageInfo(payload)?.hasNextPage ?? false;
}

/** Cursor variables for the page after this one of the review queue. */
export function nextReviewCursors(payload: SearchPayload): PageCursors {
  return { after: reviewPageInfo(payload)?.endCursor ?? null };
}

/**
 * The pageInfo of each half of "my pull requests". A legacy cached response
 * with a single `search` connection reads as the authored half.
 */
export function myPageInfo(payload: MySearchPayload): {
  authored: PageInfo | null;
  assigned: PageInfo | null;
} {
  return {
    authored: payload.authored?.pageInfo ?? payload.search?.pageInfo ?? null,
    assigned: payload.assigned?.pageInfo ?? null,
  };
}

/** Whether either half of "my pull requests" has another page after this one. */
export function myHasMorePages(payload: MySearchPayload): boolean {
  const info = myPageInfo(payload);
  return Boolean(info.authored?.hasNextPage || info.assigned?.hasNextPage);
}

/**
 * Cursor variables for the page after this one of "my pull requests". A half
 * that is exhausted re-sends its last cursor, which answers an empty page;
 * a half that never returned a cursor re-sends null, which re-reads its first
 * page (deduplicated when the pages merge).
 */
export function nextMyCursors(payload: MySearchPayload): PageCursors {
  const info = myPageInfo(payload);
  return {
    after: info.authored?.endCursor ?? null,
    afterAssigned: info.assigned?.endCursor ?? null,
  };
}

/**
 * One list from several fetched pages, in page order. A pull request that
 * appears on two pages — it moved between the first page and a later one
 * while the list was open — is kept once, from the page that returned it
 * first.
 */
export function mergeNodePages(pages: PullRequestNode[][]): PullRequestNode[] {
  const seen = new Set<string>();
  const merged: PullRequestNode[] = [];
  for (const page of pages) {
    for (const pr of page) {
      if (seen.has(pr.id)) continue;
      seen.add(pr.id);
      merged.push(pr);
    }
  }
  return merged;
}

/** Pull requests out of a search connection, dropping non-PR nodes/issues. */
export function pullRequests(payload: SearchPayload): PullRequestNode[] {
  return prNodes(payload.search.nodes);
}

function prNodes(nodes: Array<PullRequestNode | Record<string, never>>): PullRequestNode[] {
  return nodes.filter((node): node is PullRequestNode => {
    const candidate = node as Partial<PullRequestNode>;
    return typeof candidate.id === "string" && typeof candidate.number === "number";
  });
}

/**
 * Authored and assigned pull requests as one list. A pull request that is both
 * authored by and assigned to the viewer is returned once, and a legacy cached
 * response with a single `search` connection still reads.
 */
export function myPullRequests(payload: MySearchPayload): PullRequestNode[] {
  const authored = prNodes(payload.authored?.nodes ?? payload.search?.nodes ?? []);
  const assigned = prNodes(payload.assigned?.nodes ?? []);
  return mergeNodePages([authored, assigned]);
}

/**
 * Split node ids into merge-status batches, deduplicated in first-seen order.
 * A batch is one `MERGE_STATUS_QUERY` request.
 */
export function mergeStatusBatches(ids: readonly string[]): string[][] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += MERGE_STATUS_BATCH_SIZE) {
    batches.push(unique.slice(start, start + MERGE_STATUS_BATCH_SIZE));
  }
  return batches;
}

/** Node ids mapped to their merge-state verdicts. Null nodes and nodes GitHub
 * answered without a verdict (not a pull request, or no verdict computed) are
 * skipped, so the caller falls back to whatever the list response carried. */
export function mergeStatuses(
  payload: MergeStatusPayload | null | undefined,
): Map<string, MergeStateStatus> {
  const statuses = new Map<string, MergeStateStatus>();
  for (const node of payload?.nodes ?? []) {
    if (!node || typeof node.id !== "string") continue;
    if (typeof node.mergeStateStatus !== "string") continue;
    statuses.set(node.id, node.mergeStateStatus);
  }
  return statuses;
}

/**
 * Overlay lean merge-status verdicts onto list nodes. A pull request the lean
 * query has not answered keeps the verdict its list response carried (usually
 * none), so a slow or failed lean fetch never blanks a row; a verdict the lean
 * query did answer wins over a stale cached one.
 */
export function withMergeStatuses(
  nodes: PullRequestNode[],
  statuses: ReadonlyMap<string, MergeStateStatus>,
): PullRequestNode[] {
  return nodes.map((pr) => {
    const status = statuses.get(pr.id);
    return status === undefined ? pr : { ...pr, mergeStateStatus: status };
  });
}

export function isViewerPayload(payload: unknown): payload is ViewerPayload {
  return Boolean(payload && typeof payload === "object" && "viewer" in payload);
}

export interface RateLimit {
  limit: number;
  remaining: number;
  resetAt: string;
  cost: number;
}

export type CheckState = "success" | "failure" | "pending" | "neutral" | "unknown";

export interface CheckSummary {
  state: CheckState;
  total: number;
  failing: number;
  pending: number;
}

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

export interface ReviewNode {
  id: string;
  state: ReviewState;
  submittedAt: string | null;
  author: { login: string } | null;
}

export interface CommentNode {
  id: string;
  createdAt: string;
  author: { login: string } | null;
}

export interface LabelNode {
  name: string;
  color: string;
}

export interface ReviewerNode {
  requestedReviewer:
    | { __typename: "User"; login: string }
    | { __typename: "Team"; name: string; slug: string }
    | null;
}

/**
 * Native GitHub stacked pull requests. `stack` is null for a pull request that
 * stands alone; `stackEntry` carries its place in the stack.
 */
export interface StackNode {
  number: number;
  size: number;
  baseRefName: string;
}

export interface StackEntryNode {
  /** 1 is closest to the stack's base branch. */
  position: number;
}

export interface StackMembership {
  number: number;
  size: number;
  baseRefName: string;
  /** Null when GitHub did not return `stackEntry` for the pull request. */
  position: number | null;
  /**
   * True when the pull request was not reported as a native GitHub stack, but
   * its base branch is another branch (not `main` or `staging`), so it is
   * effectively stacked anyway.
   */
  inferred?: boolean;
}

export interface CheckContextNode {
  __typename: "CheckRun" | "StatusContext";
  name?: string;
  conclusion?: string | null;
  status?: string;
  context?: string;
  state?: string;
}

export interface PullRequestNode {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  /** Branch the pull request would merge into. */
  baseRefName?: string;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  labels: { nodes: LabelNode[] } | null;
  reviewRequests: { totalCount: number; nodes: ReviewerNode[] } | null;
  /** Null or absent when the pull request is not part of a native stack. */
  stack?: StackNode | null;
  stackEntry?: StackEntryNode | null;
  reviews: { nodes: ReviewNode[] } | null;
  comments: { totalCount: number; nodes: CommentNode[] } | null;
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          state: string;
          contexts: { totalCount: number; nodes: Array<CheckContextNode | null> } | null;
        } | null;
      };
    } | null>;
  } | null;
}

export interface SearchPayload {
  search: { nodes: Array<PullRequestNode | Record<string, never>> };
  viewer: { login: string };
  rateLimit: RateLimit;
}

/** Every condition that keeps an authored pull request from being merged. */
export type MergeBlocker =
  | "draft"
  | "conflicts"
  | "changes-requested"
  | "ci-failing"
  | "ci-running"
  | "review-required"
  | "reviewers-requested"
  | "mergeability-unknown"
  | "stacked";

export interface MergeReadiness {
  state: "ready" | "waiting";
  /** Blocking conditions, most important first, so `reasons[0]` is the headline. */
  blockers: MergeBlocker[];
  /** Display labels aligned with `blockers`. */
  reasons: string[];
}

export interface PullRequestSummary {
  key: string;
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  authorAvatarUrl: string | null;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: PullRequestNode["mergeable"];
  reviewDecision: PullRequestNode["reviewDecision"];
  /** Branch the pull request would merge into; empty when GitHub omitted it. */
  baseRefName: string;
  labels: LabelNode[];
  reviewRequestedFromMe: boolean;
  /** A `User` reviewer in `reviewRequests` is the viewer. */
  directReviewRequest: boolean;
  pendingReviewRequests: number;
  /** Display labels for pending requests: users as `@login`, teams by name. */
  requestedReviewers: string[];
  /** False when GitHub omitted `reviewRequests`, for example on a permission error. */
  reviewersKnown: boolean;
  /**
   * Stack membership: GitHub's native stack when present, otherwise inferred
   * from a base branch that is not `main` or `staging`. Null when the pull
   * request merges straight into a stable branch.
   */
  stack: StackMembership | null;
  teamReviewRequests: string[];
  approvals: number;
  approvedByViewer: boolean;
  approvalsByOthers: number;
  viewerKnown: boolean;
  changesRequested: number;
  comments: number;
  newActivity: number;
  lastSeenAt: number | null;
  checks: CheckSummary;
  /** Whether every known condition for merging is satisfied, and what is left. */
  readiness: MergeReadiness;
}

export interface ViewerPayload {
  viewer: { login: string; avatarUrl: string; name: string | null };
  rateLimit: RateLimit;
}

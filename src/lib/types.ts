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
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  labels: { nodes: LabelNode[] } | null;
  reviewRequests: { totalCount: number; nodes: ReviewerNode[] } | null;
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
  | "mergeability-unknown";

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
  labels: LabelNode[];
  reviewRequestedFromMe: boolean;
  /** A `User` reviewer in `reviewRequests` is the viewer. */
  directReviewRequest: boolean;
  pendingReviewRequests: number;
  /** Display labels for pending requests: users as `@login`, teams by name. */
  requestedReviewers: string[];
  /** False when GitHub omitted `reviewRequests`, for example on a permission error. */
  reviewersKnown: boolean;
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

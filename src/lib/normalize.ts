import type {
  CheckContextNode,
  CheckState,
  CheckSummary,
  MergeBlocker,
  MergeReadiness,
  PullRequestNode,
  PullRequestSummary,
  ReviewNode,
} from "./types";

const FAILURE_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

const PENDING_CONCLUSIONS = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

function checkRunState(node: CheckContextNode): CheckState {
  if (node.__typename === "StatusContext") {
    const state = (node.state ?? "").toUpperCase();
    if (state === "SUCCESS") return "success";
    if (state === "FAILURE" || state === "ERROR") return "failure";
    if (state === "PENDING" || state === "EXPECTED") return "pending";
    return "neutral";
  }
  const conclusion = (node.conclusion ?? "").toUpperCase();
  if (conclusion === "SUCCESS") return "success";
  if (FAILURE_CONCLUSIONS.has(conclusion)) return "failure";
  if (!conclusion || PENDING_CONCLUSIONS.has(conclusion)) return "pending";
  return "neutral";
}

export function summarizeChecks(pr: PullRequestNode): CheckSummary {
  const rollup = pr.commits?.nodes[0]?.commit.statusCheckRollup ?? null;
  if (!rollup) return { state: "unknown", total: 0, failing: 0, pending: 0 };

  const contexts = rollup.contexts?.nodes ?? [];
  const total = rollup.contexts?.totalCount ?? contexts.length;
  let failing = 0;
  let pending = 0;
  for (const context of contexts) {
    if (!context) continue;
    const state = checkRunState(context);
    if (state === "failure") failing += 1;
    if (state === "pending") pending += 1;
  }

  const rollupState = (rollup.state ?? "").toUpperCase();
  let state: CheckState;
  if (failing > 0 || rollupState === "FAILURE" || rollupState === "ERROR") state = "failure";
  else if (pending > 0 || rollupState === "PENDING" || rollupState === "EXPECTED") state = "pending";
  else if (rollupState === "SUCCESS") state = "success";
  else if (rollupState === "NEUTRAL") state = "neutral";
  else state = "unknown";

  return { state, total, failing, pending };
}

/** Latest decisive review per human author. A later comment does not revoke an approval or change request. */
export function latestReviews(reviews: ReviewNode[]): ReviewNode[] {
  const byAuthor = new Map<string, ReviewNode>();
  for (const review of reviews) {
    if (review.state !== "APPROVED" && review.state !== "CHANGES_REQUESTED" && review.state !== "DISMISSED") {
      continue;
    }
    const login = review.author?.login;
    if (!login) continue;
    const existing = byAuthor.get(login);
    const reviewTime = review.submittedAt ? Date.parse(review.submittedAt) : 0;
    const existingTime = existing?.submittedAt ? Date.parse(existing.submittedAt) : 0;
    if (!existing || reviewTime >= existingTime) byAuthor.set(login, review);
  }
  return [...byAuthor.values()];
}

export function approvalCount(reviews: ReviewNode[]): number {
  return latestReviews(reviews).filter((review) => review.state === "APPROVED").length;
}

export function changesRequestedCount(reviews: ReviewNode[]): number {
  return latestReviews(reviews).filter((review) => review.state === "CHANGES_REQUESTED").length;
}

/**
 * Team names from the `reviewRequests` union. GitHub can omit a team's name and
 * only send the slug, and either can be blank on a deleted team; a nameless
 * entry is dropped rather than rendered as "undefined".
 */
export function teamReviewRequests(pr: PullRequestNode): string[] {
  const nodes = pr.reviewRequests?.nodes ?? [];
  const teams: string[] = [];
  for (const node of nodes) {
    const reviewer = node.requestedReviewer;
    if (reviewer?.__typename !== "Team") continue;
    const name = (reviewer.name ?? "").trim() || (reviewer.slug ?? "").trim();
    if (!name || teams.includes(name)) continue;
    teams.push(name);
  }
  return teams;
}

/**
 * Display labels for the pending review requests, users first. The nodes are
 * capped by the query page size, so this may hold fewer entries than
 * `reviewRequests.totalCount`.
 */
export function requestedReviewers(pr: PullRequestNode): string[] {
  const nodes = pr.reviewRequests?.nodes ?? [];
  const reviewers: string[] = [];
  for (const node of nodes) {
    const reviewer = node.requestedReviewer;
    if (!reviewer) continue;
    const name =
      reviewer.__typename === "User"
        ? (reviewer.login ?? "").trim()
        : (reviewer.name ?? "").trim() || (reviewer.slug ?? "").trim();
    if (!name) continue;
    const label = reviewer.__typename === "User" ? `@${name}` : name;
    if (!reviewers.includes(label)) reviewers.push(label);
  }
  return reviewers;
}

/**
 * True when the viewer is named directly in `reviewRequests`. Team requests do
 * not count: they are surfaced separately by `teamReviewRequests`.
 */
export function directReviewRequest(pr: PullRequestNode, viewerLogin?: string | null): boolean {
  const viewer = viewerLogin?.trim().toLowerCase();
  if (!viewer) return false;
  const nodes = pr.reviewRequests?.nodes ?? [];
  return nodes.some((node) => {
    const reviewer = node.requestedReviewer;
    return (
      reviewer?.__typename === "User" && (reviewer.login ?? "").trim().toLowerCase() === viewer
    );
  });
}

/**
 * Native stack membership from GitHub. A non-null `stack` is the signal that the
 * pull request is part of a stack; `stackEntry.position` is optional because a
 * permission-limited response can omit it.
 */
export function stackMembership(
  pr: Pick<PullRequestNode, "stack" | "stackEntry">,
): PullRequestSummary["stack"] {
  const stack = pr.stack;
  if (!stack) return null;
  const position = pr.stackEntry?.position;
  return {
    number: typeof stack.number === "number" ? stack.number : 0,
    size: typeof stack.size === "number" ? stack.size : 0,
    baseRefName: typeof stack.baseRefName === "string" ? stack.baseRefName : "",
    position: typeof position === "number" && position > 0 ? position : null,
  };
}

const MERGE_BLOCKER_LABELS: Record<MergeBlocker, string> = {
  draft: "Draft",
  conflicts: "Merge conflicts",
  "changes-requested": "Changes requested",
  "ci-failing": "CI failing",
  "ci-running": "CI running",
  "review-required": "Review required",
  "reviewers-requested": "Reviewers requested",
  "mergeability-unknown": "Mergeability unknown",
};

type ReadinessInput = Pick<
  PullRequestSummary,
  | "isDraft"
  | "mergeable"
  | "reviewDecision"
  | "approvals"
  | "changesRequested"
  | "pendingReviewRequests"
  | "reviewersKnown"
  | "checks"
>;

/**
 * GitHub reports whether a branch is mergeable, not whether the author is still
 * waiting on something. This combines the review verdict, CI rollup, draft and
 * conflict state into one answer: `ready` means nothing we can see is in the
 * way, and every blocker is listed when something is.
 *
 * `reviewDecision` is GitHub's own verdict, so it already accounts for branch
 * protection. A null decision means no approval rule is enforced; with no
 * approval yet, an outstanding review request still counts as waiting.
 */
export function mergeReadiness(pr: ReadinessInput): MergeReadiness {
  const blockers: MergeBlocker[] = [];
  if (pr.isDraft) blockers.push("draft");
  if (pr.mergeable === "CONFLICTING") blockers.push("conflicts");
  if (pr.changesRequested > 0) blockers.push("changes-requested");
  if (pr.checks.state === "failure") blockers.push("ci-failing");
  else if (pr.checks.state === "pending") blockers.push("ci-running");
  if (!reviewsSatisfied(pr) && pr.changesRequested === 0) {
    const waitingOnReviewer = pr.reviewersKnown && pr.approvals === 0 && pr.pendingReviewRequests > 0;
    blockers.push(waitingOnReviewer ? "reviewers-requested" : "review-required");
  }
  if (pr.mergeable === "UNKNOWN") blockers.push("mergeability-unknown");

  return {
    state: blockers.length === 0 ? "ready" : "waiting",
    blockers,
    reasons: blockers.map((blocker) => MERGE_BLOCKER_LABELS[blocker]),
  };
}

function reviewsSatisfied(pr: ReadinessInput): boolean {
  if (pr.reviewDecision === "APPROVED") return true;
  if (pr.reviewDecision === "REVIEW_REQUIRED" || pr.reviewDecision === "CHANGES_REQUESTED") return false;
  // No approval rule is enforced. Without an approval and with a reviewer still
  // requested, the author is waiting on that review.
  if (pr.approvals > 0) return true;
  return !pr.reviewersKnown || pr.pendingReviewRequests === 0;
}

export function countMergeReadiness(
  items: Array<Pick<PullRequestSummary, "readiness">>,
): { ready: number; waiting: number } {
  let ready = 0;
  for (const item of items) {
    if (item.readiness.state === "ready") ready += 1;
  }
  return { ready, waiting: items.length - ready };
}

function activityAfter(pr: PullRequestNode, lastSeenAt: number | null): number {
  if (lastSeenAt === null) return 0;
  const author = pr.author?.login ?? "";
  let count = 0;
  for (const comment of pr.comments?.nodes ?? []) {
    if (comment.author?.login === author) continue;
    if (Date.parse(comment.createdAt) > lastSeenAt) count += 1;
  }
  for (const review of pr.reviews?.nodes ?? []) {
    if (!review.submittedAt || review.author?.login === author) continue;
    if (Date.parse(review.submittedAt) > lastSeenAt) count += 1;
  }
  return count;
}

export function toSummary(
  pr: PullRequestNode,
  options: { lastSeenAt: number | null; reviewRequestedFromMe: boolean; viewerLogin?: string | null },
): PullRequestSummary {
  const key = `${pr.repository.nameWithOwner}#${pr.number}`;
  const reviews = pr.reviews?.nodes ?? [];
  const latest = latestReviews(reviews);
  const approvals = latest.filter((review) => review.state === "APPROVED");
  const viewerLogin = options.viewerLogin ?? null;
  const approvedByViewer = viewerLogin
    ? approvals.some((review) => review.author?.login === viewerLogin)
    : false;
  const approvalsByOthers = viewerLogin
    ? approvals.filter((review) => review.author?.login !== viewerLogin).length
    : approvals.length;
  const changesRequested = latest.filter((review) => review.state === "CHANGES_REQUESTED").length;
  const checks = summarizeChecks(pr);
  const pendingReviewRequests = pr.reviewRequests?.totalCount ?? 0;
  const reviewersKnown = pr.reviewRequests != null;
  const readiness = mergeReadiness({
    isDraft: pr.isDraft,
    mergeable: pr.mergeable,
    reviewDecision: pr.reviewDecision,
    approvals: approvals.length,
    changesRequested,
    pendingReviewRequests,
    reviewersKnown,
    checks,
  });
  return {
    key,
    id: pr.id,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: pr.repository.nameWithOwner,
    author: pr.author?.login ?? "ghost",
    authorAvatarUrl: pr.author?.avatarUrl ?? null,
    isDraft: pr.isDraft,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    mergeable: pr.mergeable,
    reviewDecision: pr.reviewDecision,
    labels: pr.labels?.nodes ?? [],
    reviewRequestedFromMe: options.reviewRequestedFromMe,
    directReviewRequest: directReviewRequest(pr, viewerLogin),
    pendingReviewRequests,
    requestedReviewers: requestedReviewers(pr),
    reviewersKnown,
    stack: stackMembership(pr),
    teamReviewRequests: teamReviewRequests(pr),
    approvals: approvals.length,
    approvedByViewer,
    approvalsByOthers,
    viewerKnown: Boolean(viewerLogin),
    changesRequested,
    comments: pr.comments?.totalCount ?? 0,
    newActivity: activityAfter(pr, options.lastSeenAt),
    lastSeenAt: options.lastSeenAt,
    checks,
    readiness,
  };
}

export function sortForAttention(items: PullRequestSummary[]): PullRequestSummary[] {
  const score = (pr: PullRequestSummary): number => {
    let value = 0;
    if (pr.changesRequested > 0) value += 100;
    if (pr.readiness.state === "ready") value += 90;
    if (pr.checks.state === "failure") value += 80;
    if (pr.mergeable === "CONFLICTING") value += 60;
    if (pr.newActivity > 0) value += 40;
    if (pr.isDraft) value -= 50;
    return value;
  };
  return [...items].sort((left, right) => {
    const delta = score(right) - score(left);
    if (delta !== 0) return delta;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

export function filterSummaries(
  items: PullRequestSummary[],
  filters: {
    text: string;
    repo: string;
    onlyFailing: boolean;
    onlyChanges: boolean;
    onlyNew: boolean;
    onlyDirect?: boolean;
    onlyTeam?: boolean;
    onlyReady?: boolean;
  },
): PullRequestSummary[] {
  const text = filters.text.trim().toLowerCase();
  return items.filter((pr) => {
    if (filters.repo && pr.repo !== filters.repo) return false;
    if (filters.onlyFailing && pr.checks.state !== "failure") return false;
    if (filters.onlyChanges && pr.changesRequested === 0) return false;
    if (filters.onlyNew && pr.newActivity === 0) return false;
    if (filters.onlyDirect && !pr.directReviewRequest) return false;
    if (filters.onlyTeam && pr.teamReviewRequests.length === 0) return false;
    if (filters.onlyReady && pr.readiness.state !== "ready") return false;
    if (!text) return true;
    const haystack = [pr.title, pr.repo, pr.author, String(pr.number), ...pr.labels.map((label) => label.name)]
      .join(" ")
      .toLowerCase();
    return haystack.includes(text);
  });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return formatter.format(seconds, "second");
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 2_592_000) return formatter.format(Math.round(seconds / 86_400), "day");
  if (abs < 31_536_000) return formatter.format(Math.round(seconds / 2_592_000), "month");
  return formatter.format(Math.round(seconds / 31_536_000), "year");
}

export function checkLabel(state: CheckState): string {
  switch (state) {
    case "success":
      return "CI passing";
    case "failure":
      return "CI failing";
    case "pending":
      return "CI running";
    case "neutral":
      return "CI neutral";
    default:
      return "No CI";
  }
}

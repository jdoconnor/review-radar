import type {
  CheckContextNode,
  CheckState,
  CheckSummary,
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

export function teamReviewRequests(pr: PullRequestNode): string[] {
  const nodes = pr.reviewRequests?.nodes ?? [];
  const teams: string[] = [];
  for (const node of nodes) {
    if (node.requestedReviewer?.__typename === "Team") teams.push(node.requestedReviewer.name);
  }
  return teams;
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
    pendingReviewRequests: pr.reviewRequests?.totalCount ?? 0,
    teamReviewRequests: teamReviewRequests(pr),
    approvals: approvals.length,
    approvedByViewer,
    approvalsByOthers,
    viewerKnown: Boolean(viewerLogin),
    changesRequested: latest.filter((review) => review.state === "CHANGES_REQUESTED").length,
    comments: pr.comments?.totalCount ?? 0,
    newActivity: activityAfter(pr, options.lastSeenAt),
    lastSeenAt: options.lastSeenAt,
    checks: summarizeChecks(pr),
  };
}

export function sortForAttention(items: PullRequestSummary[]): PullRequestSummary[] {
  const score = (pr: PullRequestSummary): number => {
    let value = 0;
    if (pr.changesRequested > 0) value += 100;
    if (pr.checks.state === "failure") value += 80;
    if (pr.mergeable === "CONFLICTING") value += 60;
    if (pr.newActivity > 0) value += 40;
    if (pr.reviewDecision === "APPROVED") value += 20;
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
  filters: { text: string; repo: string; onlyFailing: boolean; onlyChanges: boolean; onlyNew: boolean },
): PullRequestSummary[] {
  const text = filters.text.trim().toLowerCase();
  return items.filter((pr) => {
    if (filters.repo && pr.repo !== filters.repo) return false;
    if (filters.onlyFailing && pr.checks.state !== "failure") return false;
    if (filters.onlyChanges && pr.changesRequested === 0) return false;
    if (filters.onlyNew && pr.newActivity === 0) return false;
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

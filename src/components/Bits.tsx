import type { ReactNode } from "react";
import type { CheckState, MergeReadiness, PullRequestSummary } from "../lib/types";
import { checkLabel, relativeTime } from "../lib/normalize";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span className="spinner-dot" />
      <span className="spinner-dot" />
      <span className="spinner-dot" />
    </span>
  );
}

export function EmptyState({
  title,
  body,
  icon = "✓",
}: {
  title: string;
  body: string;
  icon?: string;
}) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function StatusIcon({
  children,
  label,
  testId,
  className = "",
  count,
  dataApproval,
  dataCount,
  dataReviewerState,
}: {
  children: ReactNode;
  label: string;
  testId: string;
  className?: string;
  count?: number;
  dataApproval?: "viewer" | "others" | "unknown" | "none";
  dataCount?: number;
  dataReviewerState?: "none" | "requested";
}) {
  return (
    <span
      className={`status-icon ${className}`.trim()}
      data-testid={testId}
      data-approval={dataApproval}
      data-count={dataCount}
      data-reviewer-state={dataReviewerState}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className="status-glyph" aria-hidden="true">
        {children}
      </span>
      {count != null ? (
        <span className="status-count" aria-hidden="true">
          {count}
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ApprovalGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" focusable="false">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="m5.1 8.2 1.9 1.9 3.9-4.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" focusable="false">
      <path
        d="M1.75 8h3l1.5-4 3.5 8 1.5-4h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConflictGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" focusable="false">
      <path
        d="M8 2.25 14 13.25H2L8 2.25Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M8 6v3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r=".75" fill="currentColor" />
    </svg>
  );
}

function CommentGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" focusable="false">
      <path
        d="M2.25 3.25h11.5v7.5H7l-3.25 2.5v-2.5h-1.5v-7.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReviewerGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" focusable="false">
      <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M1.75 13.25c0-2.1 1.9-3.75 4.25-3.75s4.25 1.65 4.25 3.75"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M12.25 3.25v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10.25 5.25h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function StackGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" focusable="false">
      <path
        d="M8 1.75 14 5 8 8.25 2 5l6-3.25Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="m2.75 8 5.25 2.85L13.25 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m2.75 11 5.25 2.85L13.25 11"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ApprovalStatus({ pr }: { pr: PullRequestSummary }) {
  const others = pr.approvalsByOthers;
  if (pr.approvedByViewer) {
    const label =
      others > 0
        ? `You approved (${pr.approvals} approval${pr.approvals === 1 ? "" : "s"}, ${others} other${others === 1 ? "" : "s"})`
        : `You approved (${pr.approvals} approval${pr.approvals === 1 ? "" : "s"})`;
    return (
      <StatusIcon
        label={label}
        testId="approval-pill"
        className="approval"
        count={pr.approvals}
        dataApproval="viewer"
      >
        <ApprovalGlyph />
      </StatusIcon>
    );
  }
  if (pr.approvalsByOthers > 0) {
    const label = `${pr.approvalsByOthers} approval${pr.approvalsByOthers === 1 ? "" : "s"}${
      pr.viewerKnown ? " by others" : ""
    }`;
    return (
      <StatusIcon
        label={label}
        testId="approval-pill"
        className="approval"
        count={pr.approvalsByOthers}
        dataApproval={pr.viewerKnown ? "others" : "unknown"}
      >
        <ApprovalGlyph />
      </StatusIcon>
    );
  }
  return (
    <StatusIcon
      label="No approvals"
      testId="approval-pill"
      className="status-muted"
      count={0}
      dataApproval="none"
    >
      <ApprovalGlyph />
    </StatusIcon>
  );
}

export function CheckStatus({ state, failing, total }: { state: CheckState; failing: number; total: number }) {
  const label = state === "failure" && failing > 0 ? `${failing}/${total} failing` : checkLabel(state);
  return (
    <StatusIcon label={label} testId="check-pill" className={`check-${state}`}>
      <CheckGlyph />
    </StatusIcon>
  );
}

export function ChangesPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="pill changes" data-testid="changes-pill">
      {count} change{count === 1 ? "" : "s"} requested
    </span>
  );
}

export function NewActivityPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="pill fresh" data-testid="new-activity">
      {count} new
    </span>
  );
}

export function DraftPill() {
  return (
    <span className="pill draft" data-testid="draft-pill">
      Draft
    </span>
  );
}

export function ConflictStatus({ conflicting }: { conflicting: boolean }) {
  if (!conflicting) return null;
  return (
    <StatusIcon label="Merge conflicts" testId="conflict-pill" className="conflict">
      <ConflictGlyph />
    </StatusIcon>
  );
}

export function CommentsStatus({ count }: { count: number }) {
  const label = `${count} comment${count === 1 ? "" : "s"}`;
  return (
    <StatusIcon label={label} testId="comments" count={count}>
      <CommentGlyph />
    </StatusIcon>
  );
}

export function DirectReviewPill({ viewer }: { viewer: string | null }) {
  return (
    <span
      className="pill direct"
      data-testid="direct-review"
      title={viewer ? `Review requested from @${viewer}` : "Review requested from you"}
    >
      Direct
    </span>
  );
}

export function TeamReviewPill({ teams }: { teams: string[] }) {
  if (teams.length === 0) return null;
  return (
    <span className="pill team" data-testid="team-review" title={teams.join(", ")}>
      Team review
    </span>
  );
}

/**
 * How many reviewers are already requested on an authored PR. It shares the
 * icon-and-count shape of the other row statuses so a zero still reads at a
 * glance without a text pill taking over the row. Zero stays called out in amber
 * because that is the case a user wants to notice.
 */
export function ReviewersPill({
  count,
  names,
  known,
}: {
  count: number;
  names: string[];
  known: boolean;
}) {
  if (!known) return null;
  const noun = count === 1 ? "reviewer" : "reviewers";
  const listed = names.slice(0, 5).join(", ");
  const more = count > names.length ? `${listed ? ", " : ""}${count - names.length} more` : "";
  const label =
    count === 0
      ? "0 reviewers requested. Add a reviewer on GitHub if you meant to."
      : `${count} ${noun} requested${listed ? `: ${listed}${more}` : ""}`;
  return (
    <StatusIcon
      label={label}
      testId="reviewers-pill"
      className={`reviewers${count === 0 ? " missing" : ""}`}
      count={count}
      dataCount={count}
      dataReviewerState={count === 0 ? "none" : "requested"}
    >
      <ReviewerGlyph />
    </StatusIcon>
  );
}

/**
 * Native GitHub stack membership. The pill says which rung of the stack the pull
 * request occupies; a standalone pull request renders nothing.
 */
export function StackPill({ stack }: { stack: PullRequestSummary["stack"] }) {
  if (!stack) return null;
  const hasPosition = stack.position !== null;
  const hasSize = stack.size > 0;
  const visible =
    hasPosition && hasSize
      ? `Stack ${stack.position}/${stack.size}`
      : hasSize
        ? `Stack · ${stack.size} PRs`
        : "Stack";
  const target = stack.baseRefName ? ` targeting ${stack.baseRefName}` : "";
  const description =
    hasPosition && hasSize
      ? `Part of a ${stack.size}-pull-request stack, position ${stack.position}${target}.`
      : hasSize
        ? `Part of a ${stack.size}-pull-request stack${target}.`
        : "Part of a pull request stack.";
  return (
    <span
      className="pill stack"
      data-testid="stack-pill"
      data-stack-number={stack.number || undefined}
      data-stack-size={hasSize ? stack.size : undefined}
      data-stack-position={stack.position ?? undefined}
      data-stack-base={stack.baseRefName || undefined}
      role="img"
      aria-label={description}
      title={description}
    >
      <StackGlyph />
      <span aria-hidden="true">{visible}</span>
    </span>
  );
}

/**
 * One-glance answer for an authored PR: green when nothing is left to wait on,
 * otherwise the headline blocker. The complete list is in the tooltip so a row
 * never hides *why* it is waiting.
 */
export function MergeReadinessPill({ readiness }: { readiness: MergeReadiness }) {
  const ready = readiness.state === "ready";
  const reasons = readiness.reasons;
  const label = ready ? "Ready to merge" : `Waiting: ${reasons[0] ?? "something"}`;
  const description = ready
    ? "Ready to merge: no conflicts, no failing checks, and no review outstanding."
    : `Waiting on ${reasons.join(", ")}.`;
  return (
    <span
      className={`pill readiness ${ready ? "ready" : "waiting"}`}
      data-testid="merge-readiness"
      data-readiness={readiness.state}
      data-blockers={readiness.blockers.join(",")}
      title={description}
    >
      <span className="readiness-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function LabelChips({ labels }: { labels: PullRequestSummary["labels"] }) {
  return (
    <span className="labels">
      {labels.slice(0, 5).map((label) => (
        <span
          key={label.name}
          className="label-chip"
          style={{
            borderColor: `#${label.color}`,
            color: `#${label.color}`,
          }}
        >
          {label.name}
        </span>
      ))}
    </span>
  );
}

export function Age({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {relativeTime(iso)}
    </time>
  );
}

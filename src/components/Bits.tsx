import type { CheckState, PullRequestSummary } from "../lib/types";
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

export function CheckPill({ state, failing, total }: { state: CheckState; failing: number; total: number }) {
  const label = state === "failure" && failing > 0 ? `${failing}/${total} failing` : checkLabel(state);
  return (
    <span className={`pill check-${state}`} data-testid="check-pill" title={label}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function ApprovalPill({ pr }: { pr: PullRequestSummary }) {
  if (pr.reviewDecision === "APPROVED") {
    return (
      <span className="pill approval" data-testid="approval-pill">
        ✓ {pr.approvals} approval{pr.approvals === 1 ? "" : "s"}
      </span>
    );
  }
  if (pr.changesRequested > 0) {
    return (
      <span className="pill changes" data-testid="changes-pill">
        {pr.changesRequested} change{pr.changesRequested === 1 ? "" : "s"} requested
      </span>
    );
  }
  return (
    <span className="pill muted" data-testid="approval-pill">
      {pr.approvals} approval{pr.approvals === 1 ? "" : "s"}
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

export function ConflictPill() {
  return (
    <span className="pill conflict" data-testid="conflict-pill">
      Conflicts
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

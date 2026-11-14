import type { CSSProperties } from "react";
import type { PullRequestSummary } from "../lib/types";
import {
  Age,
  ApprovalStatus,
  ChangesPill,
  CheckStatus,
  CommentsStatus,
  ConflictStatus,
  DirectReviewPill,
  DraftPill,
  LabelChips,
  MergeReadinessPill,
  NewActivityPill,
  RebaseStatus,
  ReviewersPill,
  StackPill,
  TeamReviewPill,
} from "./Bits";

interface Props {
  pr: PullRequestSummary;
  kind: "review" | "mine";
  viewerLogin: string | null;
  /**
   * How many rungs deep this pull request sits in a stack. 0 is a standalone
   * pull request or the base of a stack, which renders flush with the list.
   */
  stackDepth?: number;
  /**
   * How many rows sit below this one and would disappear if it collapsed. 0
   * means the row has no stack to open, so it gets no toggle.
   */
  stackChildren?: number;
  stackExpanded?: boolean;
  onToggleStack?: () => void;
  selected: boolean;
  onSelect: () => void;
  onMarkSeen: (key: string) => void;
}

export function PullRequestRow({
  pr,
  kind,
  viewerLogin,
  stackDepth = 0,
  stackChildren = 0,
  stackExpanded = false,
  onToggleStack,
  selected,
  onSelect,
  onMarkSeen,
}: Props) {
  const stacked = stackDepth > 0;
  const hasStack = stackChildren > 0;
  const toggleLabel = `${stackExpanded ? "Hide" : "Show"} ${stackChildren} stacked ${
    stackChildren === 1 ? "pull request" : "pull requests"
  }`;

  // Opening or selecting a pull request is reading it, so any click on the row
  // clears its "new" activity. Focus alone does not: tabbing through the list
  // must not mark every row read. Only rows with activity have anything to
  // clear, which also keeps clicks in the review queue from writing a mark.
  const markRead = (): void => {
    if (pr.newActivity > 0) onMarkSeen(pr.key);
  };

  return (
    <article
      className={`card card-border pr-row ${stacked ? "stacked-row" : ""} ${
        selected ? "selected" : ""
      } ${kind === "review" ? "needs-review" : `readiness-${pr.readiness.state}`}`}
      data-testid="pr-row"
      data-pr-key={pr.key}
      data-readiness={kind === "mine" ? pr.readiness.state : undefined}
      data-in-stack={pr.stack || hasStack ? "true" : "false"}
      data-base-ref={pr.baseRefName || undefined}
      data-stack-depth={stackDepth}
      data-stack-children={hasStack ? stackChildren : undefined}
      data-stack-expanded={hasStack ? String(stackExpanded) : undefined}
      data-selected={selected ? "true" : "false"}
      aria-selected={selected}
      tabIndex={0}
      style={stacked ? ({ "--stack-depth": stackDepth } as CSSProperties) : undefined}
      onClick={() => {
        onSelect();
        markRead();
      }}
      onFocus={onSelect}
    >
      <div className="pr-main">
        <div className="pr-meta">
          {hasStack ? (
            <button
              type="button"
              className="btn btn-xs btn-outline stack-toggle"
              data-testid="stack-toggle"
              aria-expanded={stackExpanded}
              aria-label={toggleLabel}
              title={toggleLabel}
              onClick={(event) => {
                event.stopPropagation();
                onToggleStack?.();
              }}
            >
              <span className="stack-chevron" aria-hidden="true">
                ▸
              </span>
              <span className="stack-toggle-label" aria-hidden="true">
                {stackChildren} stacked
              </span>
            </button>
          ) : null}
          {stacked ? (
            <>
              <span className="stack-elbow" aria-hidden="true">
                ↳
              </span>
              <span className="sr-only">Stacked under the pull request above.</span>
            </>
          ) : null}
          <span className="repo" data-testid="pr-repo">
            {pr.repo}
          </span>
          <span className="separator" aria-hidden="true">
            ·
          </span>
          <span className="number">#{pr.number}</span>
          {kind === "review" ? (
            <span className="badge badge-sm badge-primary review-flag">Needs review</span>
          ) : null}
        </div>

        <h2 className="pr-title">
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            data-testid="pr-title"
            onClick={(event) => {
              event.stopPropagation();
              markRead();
            }}
            onAuxClick={markRead}
          >
            {pr.title}
          </a>
        </h2>

        <div className="pr-sub">
          <span className="author">@{pr.author}</span>
          <span className="separator" aria-hidden="true">
            ·
          </span>
          <Age iso={pr.updatedAt} />
          <span className="separator" aria-hidden="true">
            ·
          </span>
          <span className="diffstat">
            <span className="additions">+{pr.additions}</span>{" "}
            <span className="deletions">−{pr.deletions}</span>
          </span>
          <LabelChips labels={pr.labels} />
        </div>
      </div>

      <div className="pr-status">
        {kind === "mine" ? <MergeReadinessPill readiness={pr.readiness} /> : null}
        {pr.isDraft ? <DraftPill /> : null}
        <StackPill stack={pr.stack} />
        {kind === "review" && pr.directReviewRequest ? (
          <DirectReviewPill viewer={viewerLogin} />
        ) : null}
        <TeamReviewPill teams={pr.teamReviewRequests} />
        <ChangesPill count={pr.changesRequested} />
        <NewActivityPill count={pr.newActivity} />
        <span className="status-icons" data-testid="status-icons">
          {kind === "mine" ? (
            <ReviewersPill
              count={pr.pendingReviewRequests}
              names={pr.requestedReviewers}
              known={pr.reviewersKnown}
            />
          ) : null}
          <ApprovalStatus pr={pr} />
          <ConflictStatus conflicting={pr.mergeable === "CONFLICTING"} />
          <RebaseStatus behind={pr.needsRebase} />
          <CheckStatus state={pr.checks.state} failing={pr.checks.failing} total={pr.checks.total} />
          <CommentsStatus count={pr.comments} />
        </span>
        {kind === "mine" && pr.newActivity > 0 ? (
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            data-testid="mark-seen"
            onClick={(event) => {
              event.stopPropagation();
              onMarkSeen(pr.key);
            }}
          >
            Mark seen
          </button>
        ) : null}
      </div>
    </article>
  );
}

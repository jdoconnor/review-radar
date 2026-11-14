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
  selected: boolean;
  onSelect: () => void;
  onMarkSeen: (key: string) => void;
}

export function PullRequestRow({
  pr,
  kind,
  viewerLogin,
  stackDepth = 0,
  selected,
  onSelect,
  onMarkSeen,
}: Props) {
  const stacked = stackDepth > 0;
  // A row's level is 1-based: level 1 sits directly on `main`, level 2 sits on
  // level 1. The indent is capped by CSS for reflow, so the visible `L<n>`
  // marker — not the offset — is what keeps deep rungs distinguishable.
  const level = stackDepth + 1;
  const stackSize = pr.stack?.size ?? 0;
  const levelText =
    stackSize >= level ? `Level ${level} of ${stackSize}` : `Level ${level}`;

  // Opening or selecting a pull request is reading it, so any click on the row
  // clears its "new" activity. Focus alone does not: tabbing through the list
  // must not mark every row read. Only rows with activity have anything to
  // clear, which also keeps clicks in the review queue from writing a mark.
  const markRead = (): void => {
    if (pr.newActivity > 0) onMarkSeen(pr.key);
  };

  return (
    <article
      className={`pr-row ${stacked ? "stacked-row" : ""} ${selected ? "selected" : ""} ${
        kind === "review" ? "needs-review" : `readiness-${pr.readiness.state}`
      }`}
      data-testid="pr-row"
      data-pr-key={pr.key}
      data-readiness={kind === "mine" ? pr.readiness.state : undefined}
      data-in-stack={pr.stack ? "true" : "false"}
      data-base-ref={pr.baseRefName || undefined}
      data-stack-depth={stackDepth}
      data-stack-level={stacked ? level : undefined}
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
          {stacked ? (
            <>
              <span className="stack-elbow" aria-hidden="true">
                ↳
              </span>
              <span
                className="stack-level"
                data-testid="stack-level"
                aria-hidden="true"
                title={levelText}
              >
                L{level}
              </span>
              <span className="sr-only">{levelText}, stacked under the pull request above.</span>
            </>
          ) : null}
          <span className="repo" data-testid="pr-repo">
            {pr.repo}
          </span>
          <span className="separator" aria-hidden="true">
            ·
          </span>
          <span className="number">#{pr.number}</span>
          {kind === "review" ? <span className="review-flag">Needs review</span> : null}
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
            className="button tiny ghost"
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

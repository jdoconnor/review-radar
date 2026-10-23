import type { PullRequestSummary } from "../lib/types";
import {
  Age,
  ApprovalPill,
  CheckPill,
  ConflictPill,
  DraftPill,
  LabelChips,
  NewActivityPill,
  TeamReviewPill,
} from "./Bits";

interface Props {
  pr: PullRequestSummary;
  kind: "review" | "mine";
  selected: boolean;
  onSelect: () => void;
  onMarkSeen: (key: string) => void;
}

export function PullRequestRow({ pr, kind, selected, onSelect, onMarkSeen }: Props) {
  return (
    <article
      className={`pr-row ${selected ? "selected" : ""} ${kind === "review" ? "needs-review" : ""}`}
      data-testid="pr-row"
      data-pr-key={pr.key}
      data-selected={selected ? "true" : "false"}
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onFocus={onSelect}
    >
      <div className="pr-main">
        <div className="pr-meta">
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
            onClick={(event) => event.stopPropagation()}
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
        {pr.isDraft ? <DraftPill /> : null}
        <TeamReviewPill teams={pr.teamReviewRequests} />
        {kind === "mine" ? <ApprovalPill pr={pr} /> : null}
        <CheckPill state={pr.checks.state} failing={pr.checks.failing} total={pr.checks.total} />
        {pr.mergeable === "CONFLICTING" ? <ConflictPill /> : null}
        <NewActivityPill count={pr.newActivity} />
        <span className="comments" title={`${pr.comments} comments`}>
          💬 {pr.comments}
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

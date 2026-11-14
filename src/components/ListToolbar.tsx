import type { RefObject } from "react";

export interface Filters {
  text: string;
  repo: string;
  onlyFailing: boolean;
  onlyChanges: boolean;
  onlyNew: boolean;
  onlyDirect: boolean;
  onlyTeam: boolean;
  onlyReady: boolean;
  onlyNoReviewers: boolean;
  onlyRebase: boolean;
}

export type SortOrder = "attention" | "oldest" | "newest";

/** The order each queue opens with before the user picks one. */
export const DEFAULT_SORT: Record<"review" | "mine", SortOrder> = {
  review: "oldest",
  mine: "attention",
};

export function isSortOrder(value: string): value is SortOrder {
  return value === "attention" || value === "oldest" || value === "newest";
}

export const EMPTY_FILTERS: Filters = {
  text: "",
  repo: "",
  onlyFailing: false,
  onlyChanges: false,
  onlyNew: false,
  onlyDirect: false,
  onlyTeam: false,
  onlyReady: false,
  onlyNoReviewers: false,
  onlyRebase: false,
};

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.text !== "" ||
    filters.repo !== "" ||
    filters.onlyFailing ||
    filters.onlyChanges ||
    filters.onlyNew ||
    filters.onlyDirect ||
    filters.onlyTeam ||
    filters.onlyReady ||
    filters.onlyNoReviewers ||
    filters.onlyRebase
  );
}

interface Props {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  repos: string[];
  /** Which queues the toolbar is driving, so only relevant chips render. */
  view: "review" | "mine" | "both";
  searchRef: RefObject<HTMLInputElement | null>;
}

export function ListToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  repos,
  view,
  searchRef,
}: Props) {
  return (
    <div
      className="list-toolbar shared"
      role="search"
      aria-label="Filter pull requests"
      data-testid="list-toolbar"
    >
      <input
        ref={searchRef}
        className="input input-sm min-w-0 max-w-[calc(20ch+1.5rem)] flex-1"
        type="search"
        placeholder="Filter pull requests…"
        value={filters.text}
        onChange={(event) => onFiltersChange({ ...filters, text: event.target.value })}
        aria-label="Filter pull requests"
        data-testid="filter-text"
      />
      <select
        className="select select-sm w-auto max-w-52"
        value={filters.repo}
        onChange={(event) => onFiltersChange({ ...filters, repo: event.target.value })}
        aria-label="Filter by repository"
        data-testid="filter-repo"
      >
        <option value="">All repositories</option>
        {repos.map((repo) => (
          <option key={repo} value={repo}>
            {repo}
          </option>
        ))}
      </select>
      <select
        className="select select-sm w-auto"
        value={sort}
        onChange={(event) => onSortChange(event.target.value as SortOrder)}
        aria-label="Sort pull requests"
        title="Oldest first puts the longest-waiting review requests on top; Needs attention puts blocked and failing pull requests on top"
        data-testid="sort"
      >
        <option value="attention">Needs attention</option>
        <option value="oldest">Oldest first</option>
        <option value="newest">Recently updated</option>
      </select>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Branch state filters">
        <button
          type="button"
          className={`btn btn-xs ${filters.onlyRebase ? "btn-primary" : "btn-outline"}`}
          aria-pressed={filters.onlyRebase}
          title="Only pull requests whose branch is behind its base branch and needs a rebase or update"
          onClick={() => onFiltersChange({ ...filters, onlyRebase: !filters.onlyRebase })}
          data-testid="filter-rebase"
        >
          Needs rebase
        </button>
      </div>
      {view !== "mine" ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Review request filters">
          <button
            type="button"
            className={`btn btn-xs ${filters.onlyDirect ? "btn-primary" : "btn-outline"}`}
            aria-pressed={filters.onlyDirect}
            title="Only pull requests where a review was requested from you directly"
            onClick={() => onFiltersChange({ ...filters, onlyDirect: !filters.onlyDirect })}
            data-testid="filter-direct"
          >
            Direct only
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filters.onlyTeam ? "btn-primary" : "btn-outline"}`}
            aria-pressed={filters.onlyTeam}
            title="Only pull requests where a team you belong to was asked to review"
            onClick={() => onFiltersChange({ ...filters, onlyTeam: !filters.onlyTeam })}
            data-testid="filter-team"
          >
            Team only
          </button>
        </div>
      ) : null}
      {view !== "review" ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
          <button
            type="button"
            className={`btn btn-xs ${filters.onlyNoReviewers ? "btn-primary" : "btn-outline"}`}
            aria-pressed={filters.onlyNoReviewers}
            title="Only your pull requests with no reviewer requested"
            onClick={() => onFiltersChange({ ...filters, onlyNoReviewers: !filters.onlyNoReviewers })}
            data-testid="filter-no-reviewers"
          >
            No reviewers
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filters.onlyReady ? "btn-primary" : "btn-outline"}`}
            aria-pressed={filters.onlyReady}
            title="Only your pull requests with nothing left to wait on"
            onClick={() => onFiltersChange({ ...filters, onlyReady: !filters.onlyReady })}
            data-testid="filter-ready"
          >
            Ready to merge
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filters.onlyNew ? "btn-primary" : "btn-outline"}`}
            aria-pressed={filters.onlyNew}
            title="Only your pull requests with new activity"
            onClick={() => onFiltersChange({ ...filters, onlyNew: !filters.onlyNew })}
          >
            New activity
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filters.onlyFailing ? "btn-primary" : "btn-outline"}`}
            aria-pressed={filters.onlyFailing}
            onClick={() => onFiltersChange({ ...filters, onlyFailing: !filters.onlyFailing })}
          >
            Failing CI
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filters.onlyChanges ? "btn-primary" : "btn-outline"}`}
            aria-pressed={filters.onlyChanges}
            onClick={() => onFiltersChange({ ...filters, onlyChanges: !filters.onlyChanges })}
          >
            Changes requested
          </button>
        </div>
      ) : null}
      {hasActiveFilters(filters) ? (
        <button
          type="button"
          className="btn btn-xs btn-ghost"
          aria-label="Clear filters"
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          data-testid="clear-filters"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

import type { RefObject } from "react";

export interface Filters {
  text: string;
  repo: string;
  onlyFailing: boolean;
  onlyChanges: boolean;
  onlyNew: boolean;
  onlyDirect: boolean;
  onlyTeam: boolean;
}

export type SortOrder = "default" | "attention" | "oldest" | "newest";

export const EMPTY_FILTERS: Filters = {
  text: "",
  repo: "",
  onlyFailing: false,
  onlyChanges: false,
  onlyNew: false,
  onlyDirect: false,
  onlyTeam: false,
};

export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.text !== "" ||
    filters.repo !== "" ||
    filters.onlyFailing ||
    filters.onlyChanges ||
    filters.onlyNew ||
    filters.onlyDirect ||
    filters.onlyTeam
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
  refreshing: boolean;
  onRefresh: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}

export function ListToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  repos,
  view,
  refreshing,
  onRefresh,
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
        className="search"
        type="search"
        placeholder="Filter pull requests…"
        value={filters.text}
        onChange={(event) => onFiltersChange({ ...filters, text: event.target.value })}
        aria-label="Filter pull requests"
        data-testid="filter-text"
      />
      <select
        className="select"
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
        className="select"
        value={sort}
        onChange={(event) => onSortChange(event.target.value as SortOrder)}
        aria-label="Sort pull requests"
        title="Oldest first for review requests; needs attention for your pull requests"
        data-testid="sort"
      >
        <option value="default">Default order</option>
        <option value="oldest">Oldest first</option>
        <option value="newest">Recently updated</option>
        <option value="attention">Needs attention</option>
      </select>
      {view !== "mine" ? (
        <div className="chips" role="group" aria-label="Review request filters">
          <button
            type="button"
            className={`chip ${filters.onlyDirect ? "active" : ""}`}
            aria-pressed={filters.onlyDirect}
            title="Only pull requests where a review was requested from you directly"
            onClick={() => onFiltersChange({ ...filters, onlyDirect: !filters.onlyDirect })}
            data-testid="filter-direct"
          >
            Direct only
          </button>
          <button
            type="button"
            className={`chip ${filters.onlyTeam ? "active" : ""}`}
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
        <div className="chips" role="group" aria-label="Quick filters">
          <button
            type="button"
            className={`chip ${filters.onlyNew ? "active" : ""}`}
            aria-pressed={filters.onlyNew}
            title="Only your pull requests with new activity"
            onClick={() => onFiltersChange({ ...filters, onlyNew: !filters.onlyNew })}
          >
            New activity
          </button>
          <button
            type="button"
            className={`chip ${filters.onlyFailing ? "active" : ""}`}
            aria-pressed={filters.onlyFailing}
            onClick={() => onFiltersChange({ ...filters, onlyFailing: !filters.onlyFailing })}
          >
            Failing CI
          </button>
          <button
            type="button"
            className={`chip ${filters.onlyChanges ? "active" : ""}`}
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
          className="button tiny ghost"
          aria-label="Clear filters"
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          data-testid="clear-filters"
        >
          Clear
        </button>
      ) : null}
      <button
        type="button"
        className="button tiny ghost refresh"
        onClick={onRefresh}
        disabled={refreshing}
        data-testid="refresh"
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

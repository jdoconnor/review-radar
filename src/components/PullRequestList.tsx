import { useEffect, useMemo, useRef, useState } from "react";
import type { GithubError } from "../lib/github";
import { filterSummaries, sortForAttention } from "../lib/normalize";
import type { PullRequestSummary } from "../lib/types";
import { EmptyState, Spinner } from "./Bits";
import { PullRequestRow } from "./PullRequestRow";

interface Props {
  kind: "review" | "mine";
  heading?: string;
  active: boolean;
  items: PullRequestSummary[];
  loading: boolean;
  refreshing: boolean;
  error: GithubError | null;
  warning: string | null;
  stale: boolean;
  fromCache: boolean;
  lastUpdated: number | null;
  onActivate: () => void;
  onMarkSeen: (key: string) => void;
  onRefresh: () => void;
}

interface Filters {
  text: string;
  repo: string;
  onlyFailing: boolean;
  onlyChanges: boolean;
  onlyNew: boolean;
}

const EMPTY_FILTERS: Filters = {
  text: "",
  repo: "",
  onlyFailing: false,
  onlyChanges: false,
  onlyNew: false,
};

export function PullRequestList({
  kind,
  heading,
  active,
  items,
  loading,
  refreshing,
  error,
  warning,
  stale,
  lastUpdated,
  onActivate,
  onMarkSeen,
  onRefresh,
}: Props) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<"attention" | "oldest" | "newest">(kind === "review" ? "oldest" : "attention");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const repos = useMemo(
    () => [...new Set(items.map((item) => item.repo))].sort((left, right) => left.localeCompare(right)),
    [items],
  );

  const visible = useMemo(() => {
    const filtered = filterSummaries(items, filters);
    if (sort === "oldest") return [...filtered].sort((l, r) => Date.parse(l.createdAt) - Date.parse(r.createdAt));
    if (sort === "newest") return [...filtered].sort((l, r) => Date.parse(r.updatedAt) - Date.parse(l.updatedAt));
    return sortForAttention(filtered);
  }, [items, filters, sort]);

  useEffect(() => {
    if (selectedKey && !visible.some((item) => item.key === selectedKey)) setSelectedKey(null);
  }, [visible, selectedKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!active) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        if (event.key === "Escape") searchRef.current?.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const index = visible.findIndex((item) => item.key === selectedKey);
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = visible[Math.min(index + 1, visible.length - 1)];
        if (next) setSelectedKey(next.key);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        const previous = visible[Math.max(index - 1, 0)];
        if (previous) setSelectedKey(previous.key);
      } else if (event.key === "Enter" || event.key === "o") {
        const selected = visible.find((item) => item.key === selectedKey);
        if (selected) window.open(selected.url, "_blank", "noopener,noreferrer");
      } else if (event.key === "m") {
        const selected = visible.find((item) => item.key === selectedKey);
        if (selected && selected.newActivity > 0) onMarkSeen(selected.key);
      } else if (event.key === "r") {
        onRefresh();
      } else if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, visible, selectedKey, onMarkSeen, onRefresh]);

  const hasFilters =
    filters.text !== "" ||
    filters.repo !== "" ||
    filters.onlyFailing ||
    filters.onlyChanges ||
    filters.onlyNew;

  return (
    <section
      className={`list ${active ? "active" : ""}`}
      data-testid={kind === "review" ? "review-queue" : "mine-view"}
      data-active={active ? "true" : "false"}
      aria-label={heading ?? (kind === "review" ? "Review requests" : "My pull requests")}
      onMouseDown={onActivate}
      onFocusCapture={onActivate}
    >
      {heading ? (
        <div className="list-head">
          <h2>{heading}</h2>
          <span className="count">{items.length}</span>
        </div>
      ) : null}
      <div className="list-toolbar">
        <input
          ref={searchRef}
          className="search"
          type="search"
          placeholder={kind === "review" ? "Filter review requests…" : "Filter your pull requests…"}
          value={filters.text}
          onChange={(event) => setFilters({ ...filters, text: event.target.value })}
          aria-label="Filter pull requests"
          data-testid="filter-text"
        />
        <select
          className="select"
          value={filters.repo}
          onChange={(event) => setFilters({ ...filters, repo: event.target.value })}
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
          onChange={(event) => setSort(event.target.value as typeof sort)}
          aria-label="Sort pull requests"
          data-testid="sort"
        >
          <option value="oldest">Oldest first</option>
          <option value="newest">Recently updated</option>
          <option value="attention">Needs attention</option>
        </select>
        {kind === "mine" ? (
          <div className="chips" role="group" aria-label="Quick filters">
            <button
              type="button"
              className={`chip ${filters.onlyNew ? "active" : ""}`}
              onClick={() => setFilters({ ...filters, onlyNew: !filters.onlyNew })}
            >
              New activity
            </button>
            <button
              type="button"
              className={`chip ${filters.onlyFailing ? "active" : ""}`}
              onClick={() => setFilters({ ...filters, onlyFailing: !filters.onlyFailing })}
            >
              Failing CI
            </button>
            <button
              type="button"
              className={`chip ${filters.onlyChanges ? "active" : ""}`}
              onClick={() => setFilters({ ...filters, onlyChanges: !filters.onlyChanges })}
            >
              Changes requested
            </button>
          </div>
        ) : null}
        {hasFilters ? (
          <button type="button" className="button tiny ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
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

      {error ? (
        <div
          className={`banner ${error.kind === "auth" || error.kind === "forbidden" ? "banner-error" : "banner-warn"}`}
          role="status"
          data-testid={
            error.kind === "auth"
              ? "auth-error"
              : error.kind === "forbidden"
                ? "permission-error"
                : error.kind === "rate-limit"
                  ? "rate-limit"
                  : "error"
          }
        >
          <strong>
            {error.kind === "auth"
              ? "Token problem."
              : error.kind === "forbidden"
                ? "Token permissions."
                : error.kind === "rate-limit"
                  ? "GitHub rate limit."
                  : error.kind === "network"
                    ? "Offline."
                    : "GitHub error."}
          </strong>{" "}
          {error.kind === "rate-limit" && error.resetAt
            ? `Resets at ${new Date(error.resetAt).toLocaleTimeString()}. `
            : ""}
          {error.message}
          {stale && lastUpdated ? (
            <span className="banner-sub"> Showing cached results from {new Date(lastUpdated).toLocaleTimeString()}.</span>
          ) : null}
        </div>
      ) : null}

      {warning && !error ? (
        <div className="banner banner-warn" role="status" data-testid="permission-warning">
          <strong>Limited data.</strong> {warning}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="loading-block">
          <Spinner label="Loading pull requests" />
          <span>Loading pull requests…</span>
        </div>
      ) : items.length === 0 && !hasFilters ? (
        kind === "review" ? (
          <EmptyState
            title="No pull requests are waiting on you"
            body="When someone requests your review, it shows up here. Take a breath."
          />
        ) : (
          <EmptyState
            title="No open pull requests of yours"
            body="Everything you opened is merged, closed, or not opened yet."
          />
        )
      ) : visible.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          body="Clear the search or loosen the quick filters to see the rest."
          icon="⌕"
        />
      ) : (
        <div className="rows" role="list" aria-label={kind === "review" ? "Review requests" : "My pull requests"}>
          {visible.map((pr) => (
            <PullRequestRow
              key={pr.key}
              pr={pr}
              kind={kind}
              selected={selectedKey === pr.key}
              onSelect={() => setSelectedKey(pr.key)}
              onMarkSeen={onMarkSeen}
            />
          ))}
        </div>
      )}

      <p className="keyboard-hint">
        <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>o</kbd> open · <kbd>m</kbd> mark seen · <kbd>r</kbd> refresh ·{" "}
        <kbd>/</kbd> filter
      </p>
    </section>
  );
}

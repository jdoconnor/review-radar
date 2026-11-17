import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchGraphQL, GithubError } from "../lib/github";
import {
  mergeNodePages,
  myHasMorePages,
  myPullRequests,
  nextMyCursors,
  nextReviewCursors,
  pullRequests,
  queryFor,
  reviewHasMorePages,
  variablesFor,
  type PageCursors,
  type SearchKind,
} from "../lib/queries";
import type { MySearchPayload, PullRequestNode, SearchPayload } from "../lib/types";

type Payload = SearchPayload | MySearchPayload;

interface Options {
  kind: SearchKind;
  token: string;
  /** The first page, from the view's cache-first query. Null until it loads. */
  firstPage: Payload | null;
}

export interface PaginatedList {
  /** First page plus every loaded page, deduplicated by id, in page order. */
  nodes: PullRequestNode[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: GithubError | null;
  loadMore: () => void;
}

function nodesOf(kind: SearchKind, payload: Payload): PullRequestNode[] {
  return kind === "review"
    ? pullRequests(payload as SearchPayload)
    : myPullRequests(payload as MySearchPayload);
}

function hasMoreOf(kind: SearchKind, payload: Payload): boolean {
  return kind === "review"
    ? reviewHasMorePages(payload as SearchPayload)
    : myHasMorePages(payload as MySearchPayload);
}

function cursorsOf(kind: SearchKind, payload: Payload): PageCursors {
  return kind === "review"
    ? nextReviewCursors(payload as SearchPayload)
    : nextMyCursors(payload as MySearchPayload);
}

/**
 * Lazy pagination on top of a view's first-page query.
 *
 * The first page keeps its existing cache-first query (polling included); this
 * hook only appends further pages, one explicit "Load more" at a time. Each
 * page is fetched through the same cached client, keyed on query plus
 * variables, so a page caches separately from the first one and a repeat
 * fetch of the same cursor is a conditional request.
 *
 * A poll or manual refresh of the first page never wipes the loaded pages or
 * resets the view to page one: pages stay as loaded snapshots, and a pull
 * request that moved onto the first page meanwhile is deduplicated, first
 * page first. A token change clears the loaded pages — the next person on
 * this browser must not inherit the previous person's rows.
 */
export function usePaginatedList(options: Options): PaginatedList {
  const { kind, token, firstPage } = options;
  const [pages, setPages] = useState<Payload[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<GithubError | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A new token is a new user: drop every loaded page.
  useEffect(() => {
    setPages([]);
    setLoadMoreError(null);
  }, [token]);

  // No first page, no extra pages: nothing to append to.
  useEffect(() => {
    if (firstPage === null) {
      setPages([]);
      setLoadMoreError(null);
    }
  }, [firstPage]);

  const lastPage = pages.length > 0 ? pages[pages.length - 1] : firstPage;
  const hasMore = lastPage !== null && lastPage !== undefined ? hasMoreOf(kind, lastPage) : false;

  const nodes = useMemo(() => {
    const first = firstPage === null ? [] : nodesOf(kind, firstPage);
    return mergeNodePages([first, ...pages.map((page) => nodesOf(kind, page))]);
  }, [kind, firstPage, pages]);

  const loadMore = useCallback(() => {
    if (loadingMore || !token) return;
    const current = pages.length > 0 ? pages[pages.length - 1] : firstPage;
    if (!current || !hasMoreOf(kind, current)) return;
    const cursors = cursorsOf(kind, current);
    setLoadingMore(true);
    setLoadMoreError(null);
    void fetchGraphQL<Payload>(token, queryFor(kind), variablesFor(kind, cursors))
      .then((result) => {
        if (!mounted.current) return;
        setPages((previous) => [...previous, result.data]);
      })
      .catch((caught: unknown) => {
        if (!mounted.current) return;
        const failure =
          caught instanceof GithubError
            ? caught
            : new GithubError("network", caught instanceof Error ? caught.message : String(caught));
        setLoadMoreError(failure);
      })
      .finally(() => {
        if (mounted.current) setLoadingMore(false);
      });
  }, [kind, token, firstPage, pages, loadingMore]);

  return { nodes, hasMore, loadingMore, loadMoreError, loadMore };
}

# AGENTS.md — github-ui

Entry point for humans and agents. This repo is a **client-side GitHub review
dashboard**, and its work queue is **GitHub issues**, not Markdown spec files.

## What this is

Two views, both optimized for speed and low API spend:

1. **Needs my review** — open PRs where GitHub says a review is requested from
   me, oldest first, with CI, draft, team-review and conflict state.
2. **My pull requests** — open PRs I authored, with approval count, changes
   requested, CI state, merge conflicts, and comments/reviews since I last
   marked the PR seen.

Everything runs in the browser against the GitHub GraphQL API. The token is
stored in `localStorage`; responses are stored in IndexedDB and rendered before
the network answers.

## The issue-driven factory

The build loop is adapted from the dark-factory pattern in
`../fuckcarrentalcompanies`. The important change: **the work lives in GitHub
issues**.

| Store | What lives there |
| --- | --- |
| Issue labeled `factory:spec` | The spec. The issue body is the frozen prompt. |
| Issue labeled `factory:ready` | The go signal. No ready spec means the queue is empty. |
| Issue labeled `factory:holdout` | An acceptance scenario the coding agent must never read. |
| Issue labeled `factory:blocked` | The factory stopped; a human needs to look. |
| PR labeled `factory:automerge` | A green factory PR that may be squash-merged. |

There is no `specs/` directory and no `scenarios/` directory. If you find
yourself writing a Markdown file to describe work, stop and file an issue.

### The wall

The coding agent and the grader are isolated:

1. The agent is told not to read `factory:holdout` issues.
2. The agent runs with `GH_TOKEN`/`GITHUB_TOKEN` set to an invalid value and a
   throwaway `GH_CONFIG_DIR`, so `gh` cannot list the private holdout issues.
3. `factory/guards.ts` rejects any diff touching `factory/`, `.github/`,
   `vitest.holdout.config.ts`, `test/setup.ts`, or `*.heldout.tsx`.
4. `.github/workflows/holdout-wall.yml` rejects a `factory/*` PR that touches
   those paths.

The evaluator runs after the agent exits, with the real credentials. It writes
each holdout test into `test/`, runs it once, and deletes it. A failed holdout
gate labels the PR; it never feeds scenario text back into a retry.

### Run the factory

```bash
npm run factory -- doctor              # gh, repo, labels, counts
npm run factory -- labels              # create/refresh labels
npm run factory -- list                # specs and their state
npm run factory -- prompt --issue 12   # exact prompt the agent will get
npm run factory -- run --issue 12      # build one spec
npm run factory -- run                 # every ready spec
npm run factory -- run --dry-run       # render, touch nothing
npm run factory -- run --no-github     # local branch, no push/PR
npm run factory -- eval                # holdout gate against current tree
npm run factory -- holdout             # list scenario issues
```

A run: creates a worktree on `factory/issue-<n>-<slug>`, runs the coding agent,
runs `npm run check`, commits, evaluates the holdout gate, pushes, opens a PR
with `Closes #n`, and merges when the gate is green and auto-merge is enabled.
Failed worktrees are kept under `.factory/worktrees/` for inspection.

Emergency stop: `touch .factory/STOP` halts every run; delete it to resume.

## Start work in a worktree

Do not begin by editing the primary checkout.

- OpenCode: `worktree_create`, then `session_move` to its directory.
- Otherwise: `git worktree add .factory/worktrees/<name> -b <branch> main`, then
  `cd` there.

One worktree per task, on a task branch before the first commit. Remove it when
the work merges or is abandoned.

When `FACTORY_AGENT=1`, the factory has already created the task worktree and
started you inside it. Do not create another worktree, branch or commit; work
only in the current directory. The factory commits, pushes and opens the PR.

## Finish work in a pull request

A branch is not done. When `npm run check` is green:

1. Push the branch.
2. Open a PR against `main` with what changed and how it was verified.
3. Let CI and the holdout workflow run.
4. Merge, then remove the worktree.

## Run / verify

```bash
npm install
npm run dev        # Vite dev server
npm test           # Vitest unit + component tests
npm run typecheck  # app + factory
npm run build      # production bundle
npm run check      # typecheck + test + build — run before every push
```

## Deploy

Static build to **Cloudflare Pages** (project `github-ui`, output `dist`).
Cloudflare's GitHub integration watches `main` and owns build, deploy and preview;
do not add a GitHub Actions deploy or preview workflow. Build command is
`npm run check`, so only green builds publish. There are no Pages Functions,
Workers, or proxies; the token never reaches Cloudflare. `public/_headers` sets
the CSP and security headers. Do not add a server-side token exchange.

## Architecture

```
src/
  App.tsx                  token gate + shell
  components/
    Dashboard.tsx          tabs, polling, cache/rate-limit indicators
    PullRequestList.tsx    filters, sorting, keyboard navigation
    PullRequestRow.tsx     one PR
    TokenSetup.tsx         token entry + validation
    Bits.tsx               pills, empty states, relative time
  hooks/useCachedQuery.ts  cache-first fetch + stale-while-revalidate + polling
  lib/
    github.ts             GraphQL client, error taxonomy, conditional requests
    cache.ts              IndexedDB + memory fallback, ETag, prune
    queries.ts            GraphQL documents and search strings
    normalize.ts          pure derivations: approvals, checks, new activity
    settings.ts           token, refresh interval, last-seen map
    types.ts              shared shapes
test/                      unit + component tests
factory/                   issue-driven build loop
```

## Rules this codebase follows

1. **Cache first, network second.** A screen with cached data must render before
   a response arrives. A network failure must leave the last good screen in
   place, with a stale banner, not an empty page.
2. **Never destroy the cache on an auth or rate-limit error.** Those are
   temporary; the cache is the product.
3. **One GraphQL request per view.** Fetch the search result plus nested review,
   comment and check data in a single query. Do not fan out per PR.
4. **Derive, don't trust.** Approval counts, latest-review state, CI rollup and
   "new since last seen" are pure functions in `normalize.ts`, tested directly.
5. **Poll politely.** Respect `document.hidden`, `rateLimit.remaining`, reset
   time, and exponential backoff. Never tight-loop on errors.
6. **The token never leaves the browser.** It lives in `localStorage` and is sent
   only to the configured GitHub GraphQL host in the `Authorization` header. No
   cookie, URL, `sessionStorage`, log, analytics event or third-party request.
   No backend, no proxy. Signing out and replacing the token clear cached
   responses and last-seen marks, so a shared browser does not leak one user's
   data to the next. The factory's `gh` token is a build-time credential, not
   part of the web app.
7. **Test hooks are part of the UI contract.** Stable `data-testid` attributes
   let the holdout evaluator assert on behaviour without seeing implementation.

## Filing work

- Feature/bug spec: open an issue with the **Spec** template, add
  `factory:spec`; add `factory:ready` when it is concrete enough to build.
- Acceptance scenario: open an issue with the **Holdout scenario** template and
  add `factory:holdout`. It must contain a `## Machine` block.
- Bug report: use `[bug]` in the title (or the `type:bug` label) so the factory
  writes a bug prompt.

Do not paste a holdout scenario into a spec issue. That breaks the wall.

## Not included

No backend, no analytics, no accounts, no write mutations against GitHub. This is
a read-only dashboard with a local token.

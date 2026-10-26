# review-radar

Heads up: most of this is AI slop. I'm using this as a pilot to see how the software factory patten would work in practice.

A cache-first GitHub review dashboard. Two questions, one screen:

- **Needs my review** — open pull requests with an outstanding review request
  from me, oldest first, with whether you or someone else approved, CI, draft,
  team and conflict state.
- **My pull requests** — open PRs I authored, with whether you or someone else
  approved, changes requested, CI state, merge conflicts, and comments/reviews
  since I last marked the PR seen.

It is a static React app. It talks directly to the GitHub GraphQL API with a
token you paste in; there is no backend, no proxy and no analytics. Responses are
cached in IndexedDB and painted before the network answers, so a reload feels
instant and a network failure leaves the last good screen in place.

## Status

Walking skeleton on `main`:

- token entry and validation
- GraphQL search for review requests and authored PRs
- IndexedDB cache with ETag support, stale-while-revalidate and pruning
- approval / changes-requested / CI / conflict / new-activity derivations
- filters, sorting, keyboard navigation (`j`/`k`/`o`/`m`/`r`/`/`)
- light and dark themes, defaulting to the system preference
- error, rate-limit, offline, cached and empty states
- unit + component tests, production build

The rest of the work lives in **GitHub issues**, not Markdown files. See the
[epic](https://github.com/jdoconnor/review-radar/issues/17) and
[`AGENTS.md`](AGENTS.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest
npm run typecheck  # app + factory
npm run build      # production bundle
npm run check      # typecheck + test + build
```

### Token scopes

The dashboard is read-only. Use a fine-grained token scoped to the repositories
you want to watch.

Repository permissions:

| Permission | Access | Why |
| --- | --- | --- |
| Metadata | Read-only | Mandatory for every fine-grained token. |
| Pull requests | Read-only | PR search, reviews, review requests and mergeability. |
| Issues | Read-only | PR labels and issue comments. |
| Contents | Read-only | The commit behind each PR's CI rollup. |
| Checks | Read-only | Check runs in the CI rollup. |
| Commit statuses | Read-only | Legacy status contexts in the CI rollup. |

Organization permission:

| Permission | Access | Why |
| --- | --- | --- |
| Members | Read-only | Resolves team review requests to team names. |

If your organization uses SAML SSO, authorize the token for that organization.
Without `Contents: Read-only`, token validation still succeeds, but the commit
behind each PR's CI rollup is forbidden. Without `Checks: Read-only` and
`Commit statuses: Read-only`, the rollup state can load but the individual
contexts are forbidden. In either case the dashboard still renders every pull
request and shows a **Limited data.** warning that names the exact repository
permissions to add, instead of dropping the view.

For a classic token, use `repo` for private repositories (or `public_repo` for
public-only) and `read:org` for team review requests. The app never writes, so
fine-grained read-only permissions are preferred.

The token is stored in `localStorage` and sent only to
`https://api.github.com/graphql`.

## Deploy to Cloudflare Workers

The app is a static Vite build served by Cloudflare Workers Static Assets. There
is no Worker script, Pages Function, or proxy in this project, so the token
never reaches Cloudflare.

- Worker name: `review-radar`
- Production branch: `main`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`
- Non-production deploy command: `npx wrangler preview`
- Asset directory: `dist/`
- Node version: 24
- Wrangler config: `wrangler.jsonc`

Cloudflare Workers Builds watches `main` through its GitHub integration. It
builds, deploys and creates preview deployments on its own; there is no GitHub
Actions deploy or preview workflow. `wrangler.jsonc` runs `npm run check` as a
custom build before every upload, so the deploy always has a fresh `dist/` and
only publishes a green typecheck, test and build. Leave the dashboard build
command empty; setting it to `npm run check` as well runs the checks twice.

`wrangler.jsonc` declares the Worker, its `dist/` assets, SPA fallback routing
and an empty `previews` block. The block is required by `wrangler preview`; it is
empty because this static Worker has no preview-specific variables, secrets or
bindings. `public/_headers` is copied to `dist/_headers` and sets the CSP,
referrer policy, `nosniff`, permissions policy and COOP. The CSP allows network
traffic only to `https://api.github.com`; GitHub Enterprise users must add their
host to `connect-src` and `img-src`.

## Caching model

1. On mount, read the last response for the exact query + variables from
   IndexedDB and paint it immediately.
2. Revalidate in the background, sending `If-None-Match` when an ETag exists.
3. On a network, auth or rate-limit failure, keep the cached screen and show a
   banner instead of emptying the page.
4. Poll the active view politely: pause when the tab is hidden, back off on
   errors, and wait for the reset when the GraphQL budget is exhausted.
5. Prune entries that have not been used for 14 days.

## The factory

Specs are GitHub issues. Acceptance tests are files in `holdouts/`. The factory
turns a ready spec into a worktree, a coding-agent run, `npm run check`, a
holdout evaluation, and a PR that closes the issue.

```bash
npm run factory -- doctor
npm run factory -- list
npm run factory -- run --issue 8
npm run factory -- eval
npm run factory -- holdout
```

Holdout files are named `*.heldout.ts(x)`; a `p0-`, `p1-` or `p2-` prefix sets
the priority. The evaluator copies each test into `test/`, runs it after the
agent exits, and deletes the copy. The agent is instructed not to read
`holdouts/`, and the guards reject a PR that modifies it. The full design is in
[`factory/README.md`](factory/README.md).

## Security model: the token never leaves the browser

This is a static site. There is no server, no proxy, no function, and no
server-side session. Each person brings their own token, and it is stored only in
that browser's `localStorage`.

- The token is sent only to the GitHub GraphQL host you configure (default
  `https://api.github.com/graphql`), in the `Authorization` header.
- It is never put in a URL, cookie, `sessionStorage`, log line, analytics event,
  or HTML.
- There is no third-party script, font, image host, or analytics bundle.
- Signing out clears the token **and** the cached responses and last-seen marks.
  Replacing the token does the same, so a second person on the same browser
  cannot inherit the first person's data.
- Cached responses are in IndexedDB; the token is in `localStorage`. Clearing the
  local cache removes responses but keeps the token until you sign out.

The remaining exposure is the same as any browser-stored credential: someone
with access to the browser profile, or script injection on the site's origin,
can read it. We ship no third-party scripts and keep the dependency surface
small. Treat the token like a password and scope it to read-only repository
access.

The factory's GitHub token (used by `gh` to read spec issues during
development/CI) is a build-time credential. It is not part of the deployed app
and is never sent to the browser.

Not affiliated with GitHub.

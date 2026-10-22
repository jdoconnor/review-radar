# github-ui

A client-side GitHub review dashboard.

- **Needs my review** — PRs with an outstanding review request from me.
- **My pull requests** — open PRs I authored, with approval state, CI, and new
  activity since I last looked.

The app talks to the GitHub GraphQL API directly from the browser and keeps a
durable, stale-while-revalidate cache in IndexedDB so it opens instantly and
survives rate limits and offline periods.

Work is tracked in **GitHub issues**, not Markdown files. See `AGENTS.md`.

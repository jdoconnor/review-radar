# The issue-driven factory

Specs go in, tested PRs come out. The pattern is adapted from the dark factory in
`../fuckcarrentalcompanies`, with one structural change: **specs live in GitHub
issues**, not `specs/*.md`. Acceptance tests live on disk in `holdouts/`.

```
issue (factory:spec + factory:ready)
        │
        ▼
   coding agent ──▶ npm run check ──▶ commit ──▶ push ──▶ PR (Closes #n)
        ▲                                                     │
        │                                                     ▼
   feedback (build only)                          holdout gate from
                                                  holdouts/*.heldout.ts(x)
                                                          │
                                              pass ──▶ merge / review
                                              fail ──▶ label, keep PR
```

## Why issues for specs

- The issue is the lifecycle: open = wanted, closed = done. No archive directory.
- The issue body is the frozen prompt. Editing later changes the next run, not
  the one that already happened.
- Labels are the state machine (`factory:spec`, `factory:ready`,
  `factory:blocked`, `factory:automerge`).

## Why files for holdouts

- The test is the artifact. It is edited, reviewed and versioned like code.
- `npm run factory -- holdout` lists exactly what will grade the next PR.
- There is no Machine block to parse: the file is the vitest test.
- The evaluator can run the same suite locally, in CI, and in the factory run.

## The wall

The code-generation layer must not see or edit the acceptance tests. Enforced by:

1. `factory/spec.ts` — the prompt forbids reading `holdouts/` and using `gh`.
2. `factory/guards.ts` — rejects diffs touching the factory, workflows, holdout
   config, `test/setup.ts`, `holdouts/`, or any `*.heldout.ts(x)` file.
3. `.github/workflows/holdout-wall.yml` — repeats the path check in CI.
4. `factory/agent.ts` — invalid `GH_TOKEN`/`GITHUB_TOKEN` and a throwaway
   `GH_CONFIG_DIR`, so the agent cannot reach GitHub.
5. The evaluator loads the scenario from the primary checkout and materialises
   the test into `test/` only after the agent exits.

`holdouts/` is committed, so this is a guardrail, not a sandbox: an agent that
ignores its prompt could read the files. Keep the prompt free of holdout details
and treat the agent as untrusted. A failed holdout gate never feeds scenario text
back into a retry; it labels the PR for a human.

## The four phases, mapped

| Phase | Here |
| --- | --- |
| 1. Better context | `AGENTS.md`, `README.md`, `npm run check`, typed helpers |
| 2. Spec-driven | `factory/spec.ts`, `factory/holdout.ts`, `factory/evaluate.ts` |
| 3. Remove human gate | `factory/orchestrator.ts` merge decision, `.factory/ledger.jsonl` |
| 4. Full dark factory | `factory/cli.ts`, issue labels, the factory runs end-to-end |

## Labels

| Label | Meaning |
| --- | --- |
| `factory:spec` | The issue body is a spec. |
| `factory:ready` | The factory may pick it up. |
| `factory:blocked` | The run stopped; a human needs to look. |
| `factory:automerge` | Applied to factory PRs that may be auto-merged when green. |
| `factory:manual` | Needs a human decision. |

## Spec issue shape

The body is the agent's prompt; write it as a complete brief.

```markdown
## Goal
What a reviewer can do after this ships.

## Requirements
- Observable behaviour, not implementation.
- ...

## Constraints
- Follow AGENTS.md.
- npm run check must pass.
```

`[bug]` in the title (or `type:bug`) makes it a bug spec. The base branch
defaults to `main`; put a hidden `<!-- factory base: release -->` comment in the
body to override.

## Holdout file shape

Create `holdouts/<name>.heldout.ts` or `holdouts/<name>.heldout.tsx`. The file is
a normal vitest test; the evaluator copies it into `test/` for the run and
deletes the copy afterwards.

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "../src/App";

it("shows the review queue", () => {
  render(<App />);
  expect(screen.getByTestId("review-list")).toBeTruthy();
});
```

- The `p0-`, `p1-` and `p2-` filename prefixes set the priority. The default is
  `P1`; a failing `P0` always fails the gate. For example:
  `holdouts/p0-cache-survives-offline.heldout.tsx`.
- Subdirectories are allowed and mirrored under `test/` at run time.
- The holdout directory is configured by `holdouts.dir` in
  `factory.config.json` (default `holdouts`).
- An empty scenario set fails closed: a run with no grader is not evidence.

Holdout files are excluded from `npm test`, `tsconfig.json` and the production
build. They are only compiled when the evaluator runs them.

## Worktrees and cleanup

Each run gets `.factory/worktrees/issue-<n>` on `factory/issue-<n>-<slug>`
(gitignored). The agent is started inside that worktree and must not create
another worktree or commit; the factory owns the commit, push and PR.
`node_modules` is symlinked from the primary checkout unless the agent edits a
lockfile, in which case the worktree installs its own. The symlink is ignored and
never committed. Failed worktrees are kept; successful ones are removed when
`worktrees.cleanup` is true.

## Metrics

`.factory/ledger.jsonl` records every run: issue, branch, attempts, holdout pass
rate, PR, merge decision, reason. It is intentionally not committed; the issues
and PRs are the durable record.

## Emergency stop

```bash
touch .factory/STOP
rm .factory/STOP
```

Every run checks it before the first agent call and before each retry.

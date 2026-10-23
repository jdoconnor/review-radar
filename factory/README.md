# The issue-driven factory

Specs go in, tested PRs come out. The pattern is adapted from the dark factory in
`../fuckcarrentalcompanies`, with one structural change: **all work lives in
GitHub issues**, not `specs/*.md` and `scenarios/*.md`.

```
issue (factory:spec + factory:ready)
        │
        ▼
   coding agent ──▶ npm run check ──▶ commit ──▶ push ──▶ PR (Closes #n)
        ▲                                                     │
        │                                                     ▼
   feedback (build only)                          holdout gate from
                                                  factory:holdout issues
                                                          │
                                              pass ──▶ merge / review
                                              fail ──▶ label, keep PR
```

## Why issues

- The issue is the lifecycle: open = wanted, closed = done. No archive directory.
- The issue body is the frozen prompt. Editing later changes the next run, not
  the one that already happened.
- Labels are the state machine (`factory:spec`, `factory:ready`,
  `factory:blocked`, `factory:automerge`).
- Holdout scenarios are issues too, but in the same private repo and behind the
  wall. The agent runs with invalid GitHub credentials, so it cannot list them.

## The wall

The code-generation layer never sees the acceptance scenarios. Enforced by:

1. `factory/agent.ts` — invalid `GH_TOKEN`/`GITHUB_TOKEN`, throwaway
   `GH_CONFIG_DIR`.
2. `factory/spec.ts` — the prompt forbids `factory:holdout` and `gh`.
3. `factory/guards.ts` — rejects diffs touching the factory, workflows, holdout
   config, or `*.heldout.tsx`.
4. `.github/workflows/holdout-wall.yml` — repeats the path check in CI.
5. The repo is private, so an unauthenticated fetch cannot read the issues.

The evaluator (`factory/evaluate.ts`) runs in the parent process, after the agent
exits, with real credentials. It materializes each scenario's test into `test/`,
runs it, and deletes it. Holdout failures never feed back into a retry; they
label the PR for a human.

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
| `factory:holdout` | Acceptance scenario. Never shown to the agent. |
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

## Holdout issue shape

````markdown
## Scenario
Plain-English acceptance criteria.

## Machine
```json
{"kind":"vitest","file":"review-queue.heldout.tsx","priority":"P0"}
```

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
// ...
```
````

- `kind: "vitest"` writes the code block to `test/<file>` and runs it.
- `kind: "command"` runs the `bash`/`sh` block instead.
- `priority: P0` is a hard gate; P1/P2 are still part of the pass rate.
- A holdout issue without a parseable `## Machine` block is not counted, and an
  empty scenario set fails closed.

## Worktrees and cleanup

Each run gets `.factory/worktrees/issue-<n>` on `factory/issue-<n>-<slug>`
(gitignored). `node_modules` is symlinked from the primary checkout unless the
agent edits a lockfile, in which case the worktree installs its own. Failed
worktrees are kept; successful ones are removed when `worktrees.cleanup` is true.

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

import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FactoryConfig } from "./config";
import { factoryPath, repoRoot } from "./config";
import { runCodingAgent } from "./agent";
import { evaluateHoldout, formatReport, type EvalReport } from "./evaluate";
import { run } from "./exec";
import * as github from "./gh";
import { assertNoStop, assertWall, changedFiles } from "./guards";
import { loadScenarios } from "./holdout";
import { renderPrompt, type Spec } from "./spec";
import { commitAll, createWorktree, removeWorktree, type Worktree } from "./worktrees";

export interface RunOptions {
  dryRun: boolean;
  noGithub: boolean;
  keepWorktree: boolean;
}

export interface RunOutcome {
  ok: boolean;
  spec: Spec;
  worktree: Worktree | null;
  pr: github.PullRequestRef | null;
  report: EvalReport | null;
  attempts: number;
  reason: string;
  merged: boolean;
}

function tail(value: string, lines = 80): string {
  return value.split("\n").slice(-lines).join("\n");
}

async function ensureDependencies(worktree: Worktree, config: FactoryConfig): Promise<void> {
  if (config.worktrees.nodeModules !== "symlink") return;
  const status = await run("git", ["status", "--porcelain", "--", "package.json", "package-lock.json"], {
    cwd: worktree.path,
  });
  if (!status.stdout.trim()) return;
  const modules = join(worktree.path, "node_modules");
  if (existsSync(modules)) rmSync(modules, { recursive: true, force: true });
  const install = await run("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: worktree.path,
    timeoutMs: 10 * 60_000,
  });
  if (install.code !== 0) {
    throw new Error(`npm install failed after a dependency change:\n${tail(install.stdout + install.stderr)}`);
  }
}

async function buildWithAgent(
  config: FactoryConfig,
  spec: Spec,
  worktree: Worktree,
): Promise<{ ok: boolean; attempts: number; feedback: string; agentOutput: string }> {
  const maxAttempts = Math.min(config.codingAgent.maxAttempts, config.limits.maxAttemptsPerIssue);
  let feedback = "";
  let agentOutput = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    assertNoStop();
    const prompt = renderPrompt(spec, config, feedback);
    const result = await runCodingAgent(config, worktree.path, prompt, {
      issueNumber: spec.number,
      attempt,
    });
    agentOutput = `${result.stdout}\n${result.stderr}`.trim();

    if (result.timedOut) {
      feedback = `The agent timed out after ${config.codingAgent.timeoutMinutes} minutes.`;
      continue;
    }
    if (result.code !== 0) {
      feedback = `The agent exited ${result.code}.\n\n${tail(result.stdout + result.stderr, 60)}`;
      continue;
    }

    try {
      const changed = await changedFiles(worktree.path);
      assertWall(changed, config);
      if (changed.length === 0) {
        feedback = "The working tree is unchanged. Implement the issue; do not return a plan.";
        continue;
      }
      await ensureDependencies(worktree, config);
    } catch (error) {
      feedback = error instanceof Error ? error.message : String(error);
      continue;
    }

    const check = await run("npm", ["run", "check"], {
      cwd: worktree.path,
      timeoutMs: 12 * 60_000,
    });
    if (check.code === 0 && !check.timedOut) {
      return { ok: true, attempts: attempt, feedback: "", agentOutput };
    }
    feedback = `npm run check exited ${check.code}${check.timedOut ? " (timed out)" : ""}\n\n${tail(
      check.stdout + "\n" + check.stderr,
      80,
    )}`;
  }

  return { ok: false, attempts: maxAttempts, feedback, agentOutput };
}

function prBody(
  spec: Spec,
  report: EvalReport | null,
  agentOutput: string,
  config: FactoryConfig,
): string {
  const summary = agentOutput.trim().slice(-3_500) || "Implemented by the coding agent.";
  const gate = report
    ? `${report.passed}/${report.total} holdout scenarios passed (${Math.round(report.passRate * 100)}%)`
    : "Holdout evaluation did not run.";
  return [
    `Closes #${spec.number}`,
    "",
    "## What this is",
    spec.title,
    "",
    `Spec: ${spec.url}`,
    "",
    "## Agent summary",
    "```",
    summary,
    "```",
    "",
    "## Verification",
    "- `npm run check` passed before the branch was pushed.",
    `- ${gate}.`,
    "",
    "_Built by the issue-driven factory. The holdout scenarios live in",
    `\`${config.holdouts?.dir || "holdouts"}/\`, outside the coding agent's writable paths._`,
  ].join("\n");
}

async function pushBranch(worktree: Worktree): Promise<boolean> {
  const result = await run("git", ["push", "-u", "origin", worktree.branch], {
    cwd: worktree.path,
    timeoutMs: 120_000,
  });
  return result.code === 0;
}

function writeLedger(outcome: RunOutcome, config: FactoryConfig): void {
  mkdirSync(factoryPath(), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    repo: config.repo,
    issue: outcome.spec.number,
    issueUrl: outcome.spec.url,
    branch: outcome.worktree?.branch ?? null,
    pr: outcome.pr?.url ?? null,
    attempts: outcome.attempts,
    gatePassed: outcome.report?.gatePassed ?? false,
    passRate: outcome.report?.passRate ?? 0,
    merged: outcome.merged,
    ok: outcome.ok,
    reason: outcome.reason,
  });
  appendFileSync(factoryPath("ledger.jsonl"), `${line}\n`, "utf8");
}

export async function runSpec(
  config: FactoryConfig,
  spec: Spec,
  options: RunOptions,
): Promise<RunOutcome> {
  assertNoStop();

  if (options.dryRun) {
    const prompt = renderPrompt(spec, config);
    const scenarios = await loadScenarios(repoRoot(), config);
    console.log("── prompt ─────────────────────────────────────────────");
    console.log(prompt);
    console.log("───────────────────────────────────────────────────────");
    console.log(`${scenarios.length} holdout scenario(s) available to the evaluator.`);
    return {
      ok: true,
      spec,
      worktree: null,
      pr: null,
      report: null,
      attempts: 0,
      reason: "dry-run",
      merged: false,
    };
  }

  const worktree = await createWorktree(config, spec.slug, spec.number, spec.base);
  console.log(`Worktree: ${worktree.path}`);
  console.log(`Branch:   ${worktree.branch}`);

  const build = await buildWithAgent(config, spec, worktree);
  if (!build.ok) {
    const message = [
      `Factory run failed the build gate after ${build.attempts} attempt(s).`,
      "",
      "The worktree is kept for inspection:",
      `\`${worktree.path}\``,
      "",
      "Last output:",
      "```",
      tail(build.feedback, 40),
      "```",
    ].join("\n");
    await github.commentOnIssue(repoRoot(), spec.number, message);
    await github.removeIssueLabel(repoRoot(), spec.number, config.labels.ready);
    await github.addIssueLabels(repoRoot(), spec.number, [config.labels.blocked]);
    const outcome: RunOutcome = {
      ok: false,
      spec,
      worktree,
      pr: null,
      report: null,
      attempts: build.attempts,
      reason: "build-gate-failed",
      merged: false,
    };
    writeLedger(outcome, config);
    return outcome;
  }

  const committed = await commitAll(
    worktree,
    `spec: issue #${spec.number} ${spec.title}`,
    `Issue: ${spec.url}\n\nBuilt by the issue-driven factory.`,
  );
  if (!committed) {
    const outcome: RunOutcome = {
      ok: false,
      spec,
      worktree,
      pr: null,
      report: null,
      attempts: build.attempts,
      reason: "nothing-to-commit",
      merged: false,
    };
    writeLedger(outcome, config);
    return outcome;
  }

  const scenarios = await loadScenarios(repoRoot(), config);
  const report = await evaluateHoldout(worktree.path, scenarios, {
    runs: config.eval.runs,
    quorum: config.eval.passQuorum,
    gate: config.eval.gate,
  });
  console.log(formatReport(report));

  if (options.noGithub) {
    const outcome: RunOutcome = {
      ok: report.gatePassed,
      spec,
      worktree,
      pr: null,
      report,
      attempts: build.attempts,
      reason: report.gatePassed ? "local-only" : "holdout-gate-failed",
      merged: false,
    };
    writeLedger(outcome, config);
    return outcome;
  }

  const pushed = await pushBranch(worktree);
  if (!pushed) {
    await github.removeIssueLabel(repoRoot(), spec.number, config.labels.ready);
    await github.addIssueLabels(repoRoot(), spec.number, [config.labels.blocked]);
    const outcome: RunOutcome = {
      ok: false,
      spec,
      worktree,
      pr: null,
      report,
      attempts: build.attempts,
      reason: "push-failed",
      merged: false,
    };
    writeLedger(outcome, config);
    return outcome;
  }

  const body = prBody(spec, report, build.agentOutput, config);
  let pr = await github.createPullRequest(repoRoot(), {
    title: `spec #${spec.number}: ${spec.title}`,
    body,
    base: spec.base,
    head: worktree.branch,
    label: config.labels.automerge,
  });
  if (!pr) pr = await github.pullRequestForBranch(repoRoot(), worktree.branch);

  let merged = false;
  if (pr && report.gatePassed && config.autoMerge.enabled && !config.autoMerge.dryRun) {
    merged = await github.mergePullRequest(repoRoot(), pr.number, config.autoMerge.mergeMethod);
  }

  const gateLine = formatReport(report);
  if (pr) {
    await github.commentOnIssue(
      repoRoot(),
      spec.number,
      [
        `Factory opened ${pr.url}.`,
        "",
        "```",
        gateLine,
        "```",
        "",
        merged
          ? "The holdout gate passed and the PR was squash-merged."
          : report.gatePassed
            ? "The holdout gate passed; the PR is waiting for review/merge."
            : "The holdout gate failed; the PR is labeled for human review, not merged.",
      ].join("\n"),
    );
  }
  if (!report.gatePassed) {
    await github.removeIssueLabel(repoRoot(), spec.number, config.labels.ready);
    await github.addIssueLabels(repoRoot(), spec.number, [config.labels.blocked]);
  }

  const outcome: RunOutcome = {
    ok: report.gatePassed,
    spec,
    worktree,
    pr,
    report,
    attempts: build.attempts,
    reason: merged ? "merged" : report.gatePassed ? "pr-open" : "holdout-gate-failed",
    merged,
  };
  writeLedger(outcome, config);

  if (config.worktrees.cleanup && !options.keepWorktree) {
    await removeWorktree(worktree.path, true);
  }

  return outcome;
}

export function writeRunReport(outcome: RunOutcome): string {
  const path = factoryPath("reports", `run-issue-${outcome.spec.number}-${Date.now()}.json`);
  mkdirSync(factoryPath("reports"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        issue: outcome.spec.number,
        issueUrl: outcome.spec.url,
        branch: outcome.worktree?.branch ?? null,
        attempts: outcome.attempts,
        pr: outcome.pr?.url ?? null,
        merged: outcome.merged,
        reason: outcome.reason,
        report: outcome.report,
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

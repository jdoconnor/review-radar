import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, repoRoot, type FactoryConfig } from "./config";
import { evaluateHoldout, formatReport } from "./evaluate";
import { run } from "./exec";
import * as github from "./gh";
import { loadScenarios } from "./holdout";
import { runSpec, writeRunReport, type RunOptions } from "./orchestrator";
import { loadSpec, loadSpecIssues, renderPrompt } from "./spec";

const argv = process.argv.slice(2);
const command = argv[0] ?? "help";

function option(name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function hasFlag(name: string): boolean {
  return argv.includes(name);
}

function repoConfig(): FactoryConfig {
  return loadConfig();
}

const LABELS: Array<{ name: keyof FactoryConfig["labels"]; color: string; description: string }> = [
  { name: "spec", color: "6ea8fe", description: "A factory spec. The issue body is the frozen prompt." },
  { name: "ready", color: "3fb950", description: "Ready for the factory to pick up." },
  { name: "holdout", color: "bc8cff", description: "Holdout acceptance scenario. The coding agent must never read this." },
  { name: "blocked", color: "f85149", description: "The factory stopped on this issue and needs a human." },
  { name: "automerge", color: "d29922", description: "Marks a factory PR that may be auto-merged when green." },
  { name: "manual", color: "8d9aae", description: "Needs a human decision before continuing." },
];

async function doctor(config: FactoryConfig): Promise<void> {
  const root = repoRoot();
  const checks: Array<[string, boolean, string]> = [];
  const ghOk = await github.ghAvailable(root);
  const authOk = ghOk ? await github.ghAuthenticated(root) : false;
  const repo = ghOk ? await github.repoView(root, config.repo) : null;
  const user = authOk ? await github.currentUser(root) : null;
  const specs = ghOk ? await loadSpecIssues(root, config, { readyOnly: false }) : [];
  const scenarios = ghOk ? await loadScenarios(root, config) : [];
  const branch = await run("git", ["branch", "--show-current"], { cwd: root });
  const status = await run("git", ["status", "--porcelain"], { cwd: root });
  const packageJson = existsSync(join(root, "package.json"))
    ? (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> })
    : null;

  checks.push(["gh CLI", ghOk, ghOk ? "installed" : "install gh"]);
  checks.push(["gh auth", authOk, authOk ? `signed in as ${user ?? "unknown"}` : "run gh auth login"]);
  checks.push(["repository", Boolean(repo), repo ? `${repo.nameWithOwner} (${repo.visibility})` : "not found"]);
  checks.push(["check script", Boolean(packageJson?.scripts?.check), packageJson?.scripts?.check ?? "missing"]);
  checks.push([
    "holdout config",
    existsSync(join(root, "vitest.holdout.config.ts")),
    "vitest.holdout.config.ts",
  ]);
  checks.push(["holdout scenarios", scenarios.length > 0, `${scenarios.length} issue(s) labeled ${config.labels.holdout}`]);
  checks.push(["specs", true, `${specs.length} issue(s) labeled ${config.labels.spec}`]);
  checks.push(["branch", branch.stdout.trim() === config.worktrees.base, branch.stdout.trim() || "(detached)"]);
  checks.push(["clean tree", status.stdout.trim() === "", status.stdout.trim() ? "dirty" : "clean"]);

  console.log(`Factory doctor — ${config.repo}`);
  for (const [name, ok, detail] of checks) console.log(`  ${ok ? "✓" : "✗"} ${name}: ${detail}`);
  console.log("");
  console.log(`Coding agent: ${config.codingAgent.adapter}${config.codingAgent.model ? ` (${config.codingAgent.model})` : ""}`);
  console.log(`Auto-merge:  ${config.autoMerge.enabled ? "enabled" : "disabled"}${config.autoMerge.dryRun ? " (dry-run)" : ""}`);
  console.log(`Eval gate:   ${config.eval.runs} run(s), quorum ${config.eval.passQuorum}, gate ${config.eval.gate * 100}%`);
}

async function labels(config: FactoryConfig): Promise<void> {
  const root = repoRoot();
  for (const label of LABELS) {
    const ok = await github.ensureLabel(root, config.labels[label.name], label.color, label.description);
    console.log(`${ok ? "✓" : "✗"} ${config.labels[label.name]}`);
  }
}

async function list(config: FactoryConfig): Promise<void> {
  const specs = await loadSpecIssues(repoRoot(), config, { readyOnly: false });
  if (specs.length === 0) {
    console.log(`No specs. File an issue labeled ${config.labels.spec}.`);
    return;
  }
  for (const spec of specs) {
    const ready = spec.labels.includes(config.labels.ready) ? "ready" : "not-ready";
    const blocked = spec.labels.includes(config.labels.blocked) ? " blocked" : "";
    console.log(`#${spec.number} [${spec.type}/${ready}${blocked}] ${spec.title}`);
  }
}

async function prompt(config: FactoryConfig): Promise<void> {
  const number = Number(option("--issue"));
  if (!Number.isFinite(number)) throw new Error("Usage: factory prompt --issue <number>");
  const spec = await loadSpec(repoRoot(), config, number);
  if (!spec) throw new Error(`Issue #${number} not found.`);
  console.log(renderPrompt(spec, config));
}

async function runCommand(config: FactoryConfig): Promise<void> {
  const options: RunOptions = {
    dryRun: hasFlag("--dry-run"),
    noGithub: hasFlag("--no-github"),
    keepWorktree: hasFlag("--keep-worktree"),
  };
  const number = option("--issue");

  const runOne = async (spec: Awaited<ReturnType<typeof loadSpec>>): Promise<boolean> => {
    if (!spec) return false;
    console.log(`\n=== #${spec.number} ${spec.title} ===`);
    const outcome = await runSpec(config, spec, options);
    const report = writeRunReport(outcome);
    console.log(`Outcome: ${outcome.reason}${outcome.pr ? ` — ${outcome.pr.url}` : ""}`);
    console.log(`Report:  ${report}`);
    return outcome.ok;
  };

  let ok = true;
  if (number) {
    ok = await runOne(await loadSpec(repoRoot(), config, Number(number)));
  } else {
    const specs = await loadSpecIssues(repoRoot(), config, { readyOnly: true });
    if (specs.length === 0) {
      console.log(`No ready specs. A clean queue is a healthy queue. Add ${config.labels.ready} when one is ready.`);
      return;
    }
    for (const spec of specs) {
      ok = (await runOne(spec)) && ok;
      if (!ok) break;
    }
  }
  if (!ok) process.exitCode = 1;
}

async function evalCommand(config: FactoryConfig): Promise<void> {
  const worktree = option("--worktree") ?? repoRoot();
  const scenarios = await loadScenarios(worktree, config);
  if (scenarios.length === 0) {
    console.error(`No holdout scenarios found. Add issues labeled ${config.labels.holdout}.`);
    process.exitCode = 1;
    return;
  }
  const report = await evaluateHoldout(worktree, scenarios, {
    runs: config.eval.runs,
    quorum: config.eval.passQuorum,
    gate: config.eval.gate,
  });
  console.log(formatReport(report));
  if (!report.gatePassed) {
    for (const result of report.results.filter((item) => !item.passed)) {
      console.log(`\n── #${result.number} ${result.title} ──\n${result.detail.slice(-4_000)}`);
    }
    process.exitCode = 1;
  }
}

async function holdout(config: FactoryConfig): Promise<void> {
  const scenarios = await loadScenarios(repoRoot(), config);
  if (scenarios.length === 0) {
    console.log(`No holdout scenarios. Add issues labeled ${config.labels.holdout}.`);
    return;
  }
  for (const scenario of scenarios) {
    console.log(`#${scenario.number} [${scenario.priority}] ${scenario.title} (${scenario.kind})`);
  }
}

function help(): void {
  console.log(`github-ui factory — issues in, tested PRs out

Usage:
  npm run factory -- doctor              Health check: gh, repo, labels, counts
  npm run factory -- labels              Create/refresh the factory labels
  npm run factory -- list                List spec issues and their state
  npm run factory -- prompt --issue N    Render the exact coding prompt
  npm run factory -- run                 Run every ready spec
  npm run factory -- run --issue N       Run one spec
  npm run factory -- run --dry-run       Render the prompt, touch nothing
  npm run factory -- run --no-github     Local branch only; no push or PR
  npm run factory -- eval                Run the holdout gate against the current tree
  npm run factory -- eval --worktree P   Run the holdout gate against a worktree
  npm run factory -- holdout             List holdout scenario issues

The work queue is GitHub issues:
  ${"factory:spec"}     the spec (the issue body is the frozen prompt)
  ${"factory:ready"}    the go signal
  ${"factory:holdout"}  acceptance scenario; never shown to the coding agent
  ${"factory:blocked"}  needs a human
`);
}

async function main(): Promise<void> {
  const config = repoConfig();
  switch (command) {
    case "doctor":
      await doctor(config);
      break;
    case "labels":
      await labels(config);
      break;
    case "list":
      await list(config);
      break;
    case "prompt":
      await prompt(config);
      break;
    case "run":
      await runCommand(config);
      break;
    case "eval":
      await evalCommand(config);
      break;
    case "holdout":
      await holdout(config);
      break;
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      help();
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

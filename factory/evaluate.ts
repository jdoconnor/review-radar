import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FactoryConfig } from "./config";
import { factoryPath } from "./config";
import { run } from "./exec";
import type { Scenario } from "./holdout";

export interface ScenarioResult {
  title: string;
  priority: Scenario["priority"];
  runs: number;
  passes: number;
  passed: boolean;
  skipped: boolean;
  detail: string;
}

export interface EvalReport {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  gatePassed: boolean;
  results: ScenarioResult[];
}

export interface EvaluateOptions {
  runs: number;
  quorum: number;
  gate: number;
  timeoutMs?: number;
}

async function runVitest(
  worktree: string,
  scenario: Scenario,
  timeoutMs: number,
): Promise<{ ok: boolean; output: string }> {
  if (!scenario.code.trim()) {
    return { ok: false, output: `holdout test is empty: ${scenario.file}` };
  }

  // The grader is copied into the worktree at run time and removed afterwards.
  // The source file in holdouts/ is never mutated.
  const tempTarget = join(worktree, scenario.testFile);
  if (existsSync(tempTarget)) {
    return { ok: false, output: `refusing to overwrite existing ${scenario.testFile}` };
  }

  mkdirSync(dirname(tempTarget), { recursive: true });
  writeFileSync(tempTarget, scenario.code, "utf8");

  try {
    const result = await run(
      "npx",
      [
        "--no-install",
        "vitest",
        "run",
        "--config",
        "vitest.holdout.config.ts",
        scenario.testFile,
        "--reporter=dot",
      ],
      { cwd: worktree, timeoutMs },
    );
    return {
      ok: result.code === 0 && !result.timedOut,
      output: `${result.stdout}\n${result.stderr}`.trim(),
    };
  } finally {
    rmSync(tempTarget, { force: true });
  }
}

export async function evaluateHoldout(
  worktree: string,
  scenarios: Scenario[],
  options: EvaluateOptions,
): Promise<EvalReport> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    const details: string[] = [];
    let passes = 0;
    for (let attempt = 1; attempt <= options.runs; attempt += 1) {
      const result = await runVitest(worktree, scenario, timeoutMs);
      if (result.ok) passes += 1;
      else details.push(`run ${attempt}: ${result.output.slice(-2_500)}`);
    }
    const passed = passes >= options.quorum;
    results.push({
      title: scenario.title,
      priority: scenario.priority,
      runs: options.runs,
      passes,
      passed,
      skipped: false,
      detail: passed ? "all runs passed" : details.join("\n\n"),
    });
  }

  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const p0Failed = results.filter((result) => result.priority === "P0" && !result.passed);
  const passRate = total === 0 ? 0 : passed / total;
  const gatePassed = total > 0 && passRate >= options.gate && p0Failed.length === 0;

  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    total,
    passed,
    failed: total - passed,
    skipped: 0,
    passRate,
    gatePassed,
    results,
  };

  mkdirSync(factoryPath("reports"), { recursive: true });
  writeFileSync(
    factoryPath("reports", `eval-${report.generatedAt.replace(/[:.]/g, "-")}.json`),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  return report;
}

export function formatReport(report: EvalReport): string {
  if (report.total === 0) {
    return "No holdout scenarios found. Failing closed: a run with no grader is not evidence.";
  }
  const lines = [
    `Holdout gate: ${report.passed}/${report.total} passed (${Math.round(report.passRate * 100)}%), ${report.gatePassed ? "PASS" : "FAIL"}`,
  ];
  for (const result of report.results) {
    lines.push(
      `  ${result.passed ? "✓" : "✗"} [${result.priority}] ${result.title} (${result.passes}/${result.runs})`,
    );
  }
  return lines.join("\n");
}

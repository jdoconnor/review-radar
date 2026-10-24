import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface FactoryConfig {
  repo: string;
  labels: {
    spec: string;
    ready: string;
    blocked: string;
    automerge: string;
    manual: string;
  };
  holdouts: {
    dir: string;
  };
  codingAgent: {
    adapter: string;
    command?: string[];
    model?: string;
    agent?: string;
    maxAttempts: number;
    timeoutMinutes: number;
  };
  eval: {
    runs: number;
    passQuorum: number;
    gate: number;
  };
  autoMerge: {
    enabled: boolean;
    dryRun: boolean;
    mergeMethod: "squash" | "merge" | "rebase";
    label: string;
  };
  worktrees: {
    dir: string;
    nodeModules: "symlink" | "install";
    cleanup: boolean;
    fetch: boolean;
    base: string;
  };
  limits: {
    maxAttemptsPerIssue: number;
  };
}

export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function loadConfig(): FactoryConfig {
  const path = resolve(repoRoot(), "factory.config.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as FactoryConfig;
  const config: FactoryConfig = {
    ...raw,
    repo: process.env.FACTORY_REPO ?? raw.repo,
    codingAgent: {
      ...raw.codingAgent,
      adapter: process.env.FACTORY_AGENT ?? raw.codingAgent.adapter,
      maxAttempts: Number(process.env.FACTORY_MAX_ATTEMPTS ?? raw.codingAgent.maxAttempts),
    },
    eval: {
      ...raw.eval,
      runs: Number(process.env.FACTORY_EVAL_RUNS ?? raw.eval.runs),
      passQuorum: Number(process.env.FACTORY_EVAL_QUORUM ?? raw.eval.passQuorum),
    },
    autoMerge: {
      ...raw.autoMerge,
      dryRun: process.env.FACTORY_AUTOMERGE_DRY_RUN === "1" ? true : raw.autoMerge.dryRun,
    },
  };
  if (process.env.FACTORY_NO_AUTOMERGE === "1") config.autoMerge.enabled = false;
  return config;
}

export function factoryPath(...parts: string[]): string {
  return resolve(repoRoot(), ".factory", ...parts);
}

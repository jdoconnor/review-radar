import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { FactoryConfig } from "./config";

export type ScenarioPriority = "P0" | "P1" | "P2";

export interface Scenario {
  /** Repo-relative path of the holdout file, also used as the display title. */
  title: string;
  /** Repo-relative path of the holdout file. */
  file: string;
  /** Repo-relative path the evaluator materialises under test/ before running. */
  testFile: string;
  priority: ScenarioPriority;
  code: string;
}

const HOLDOUT_FILE = /^[a-z0-9][a-z0-9-]*\.heldout\.tsx?$/i;
const PRIORITY_RANK: Record<ScenarioPriority, number> = { P0: 0, P1: 1, P2: 2 };

function fencedCode(body: string): string | null {
  const match = body.match(/```(?:tsx|ts|typescript)\s*\n([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}

/** Optional `p0-`/`p1-`/`p2-` prefix; anything else defaults to P1. */
function priorityFromName(fileName: string): ScenarioPriority {
  const match = fileName.match(/^p([0-2])-/i);
  return match ? (`P${match[1]}` as ScenarioPriority) : "P1";
}

/**
 * Parse a vitest holdout scenario from a .heldout.ts(x) file.
 * The file content is test code, optionally wrapped in a fenced code block.
 */
export function parseHeldoutFile(file: string, testFile: string, content: string): Scenario | null {
  const fileName = file.split("/").pop() ?? "";
  if (!HOLDOUT_FILE.test(fileName)) return null;

  const code = (fencedCode(content) ?? content).trim();
  if (!code) return null;

  return {
    title: file,
    file,
    testFile,
    priority: priorityFromName(fileName),
    code,
  };
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

/**
 * Load holdout scenarios from the vault directory (default `holdouts/`).
 * Only files named `<name>.heldout.ts` or `<name>.heldout.tsx` are read; the
 * `p0-`, `p1-` and `p2-` filename prefixes set the priority.
 */
export function loadScenarios(cwd: string, config: FactoryConfig): Promise<Scenario[]> {
  const dirName = config.holdouts?.dir || "holdouts";
  const dir = join(cwd, dirName);
  if (!existsSync(dir)) return Promise.resolve([]);

  const scenarios: Scenario[] = [];
  for (const fullPath of walk(dir)) {
    const file = relative(cwd, fullPath).replace(/\\/g, "/");
    const within = relative(dir, fullPath).replace(/\\/g, "/");
    const scenario = parseHeldoutFile(file, `test/${within}`, readFileSync(fullPath, "utf8"));
    if (scenario) scenarios.push(scenario);
  }

  return Promise.resolve(
    scenarios.sort(
      (left, right) =>
        PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
        left.title.localeCompare(right.title),
    ),
  );
}

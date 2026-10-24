import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FactoryConfig } from "./config";
import { factoryPath, repoRoot } from "./config";
import { run } from "./exec";

const PROTECTED_PREFIXES = ["factory/", ".github/", ".factory/", "holdouts/"];
const PROTECTED_FILES = new Set(["vitest.holdout.config.ts", "test/setup.ts", "AGENTS.md"]);

export function assertNoStop(): void {
  if (existsSync(factoryPath("STOP"))) {
    throw new Error("Emergency stop is engaged (.factory/STOP). Delete it to resume.");
  }
}

export async function changedFiles(cwd: string): Promise<string[]> {
  const result = await run("git", ["status", "--porcelain=v1"], { cwd });
  if (result.code !== 0) throw new Error(`git status failed: ${result.stderr.trim()}`);
  const files: string[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    let path = line.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ").pop() ?? path;
    path = path.replace(/^"|"$/g, "");
    // The factory symlinks the primary checkout's dependencies into the
    // worktree. That link is setup, not agent work; never let it count as a
    // change or reach a commit.
    if (path === "node_modules" || path.startsWith("node_modules/")) continue;
    files.push(path);
  }
  return files;
}

export function protectedViolations(files: string[]): string[] {
  return files.filter((file) => {
    const normalised = file.replace(/\\/g, "/").replace(/^\.\//, "");
    if (PROTECTED_FILES.has(normalised)) return true;
    if (normalised.endsWith(".heldout.ts") || normalised.endsWith(".heldout.tsx")) return true;
    return PROTECTED_PREFIXES.some((prefix) => normalised.startsWith(prefix));
  });
}

export function assertWall(files: string[], config: FactoryConfig): void {
  const violations = protectedViolations(files);
  if (violations.length > 0) {
    throw new Error(
      `Holdout wall breached: the change touches protected paths: ${violations.join(", ")}. ` +
        `The code-generation layer cannot edit its own grader or the factory. Revert those files.`,
    );
  }
  if (config.repo.length === 0) return;
  const root = repoRoot();
  if (!existsSync(join(root, ".git"))) throw new Error("Not a git repository.");
}

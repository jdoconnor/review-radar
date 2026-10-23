import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { FactoryConfig } from "./config";
import { factoryPath, repoRoot } from "./config";
import { run } from "./exec";

export interface Worktree {
  path: string;
  branch: string;
}

export async function createWorktree(
  config: FactoryConfig,
  slug: string,
  issueNumber: number,
  base: string,
): Promise<Worktree> {
  const root = repoRoot();
  const branch = `factory/issue-${issueNumber}-${slug}`;
  const path = factoryPath("worktrees", `issue-${issueNumber}`);

  await removeWorktree(path, true);

  if (config.worktrees.fetch) {
    await run("git", ["fetch", "origin", base], { cwd: root, timeoutMs: 60_000 });
  }

  const result = await run("git", ["worktree", "add", path, "-b", branch, base], { cwd: root });
  if (result.code !== 0) {
    throw new Error(`git worktree add failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  const modules = join(root, "node_modules");
  const target = join(path, "node_modules");
  if (config.worktrees.nodeModules === "symlink" && existsSync(modules) && !existsSync(target)) {
    symlinkSync(modules, target, "dir");
  }

  mkdirSync(factoryPath("logs"), { recursive: true });
  return { path, branch };
}

export async function removeWorktree(path: string, force = false): Promise<void> {
  if (!existsSync(path)) return;
  const args = ["worktree", "remove", path];
  if (force) args.push("--force");
  const result = await run("git", args, { cwd: repoRoot() });
  if (result.code !== 0) {
    try {
      rmSync(path, { recursive: true, force: true });
      await run("git", ["worktree", "prune"], { cwd: repoRoot() });
    } catch {
      // Leave it for inspection.
    }
  }
}

export async function commitAll(worktree: Worktree, message: string, body: string): Promise<boolean> {
  const add = await run("git", ["add", "-A"], { cwd: worktree.path });
  if (add.code !== 0) return false;
  const status = await run("git", ["status", "--porcelain"], { cwd: worktree.path });
  if (!status.stdout.trim()) return false;
  const commit = await run("git", ["commit", "-m", message, "-m", body], { cwd: worktree.path });
  return commit.code === 0;
}

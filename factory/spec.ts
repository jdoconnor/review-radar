import type { FactoryConfig } from "./config";
import * as github from "./gh";

export type SpecType = "feature" | "bug-fix";

export interface Spec {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  type: SpecType;
  base: string;
  slug: string;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

function metadata(body: string): Record<string, string> {
  const match = body.match(/<!--\s*factory\s*\n([\s\S]*?)-->/i);
  if (!match?.[1]) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^\s*([a-z_]+)\s*:\s*(.+?)\s*$/i);
    if (pair?.[1] && pair[2]) result[pair[1].toLowerCase()] = pair[2];
  }
  return result;
}

export function isReady(issue: github.IssueRef, config: FactoryConfig): boolean {
  return issue.labels.includes(config.labels.ready);
}

export function specFromIssue(issue: github.IssueRef): Spec {
  const meta = metadata(issue.body);
  const type: SpecType =
    meta.type === "bug-fix" || issue.labels.includes("type:bug") || /^\[bug\]/i.test(issue.title)
      ? "bug-fix"
      : "feature";
  return {
    number: issue.number,
    title: issue.title.replace(/^\[(spec|bug|feature)\]\s*/i, "").trim(),
    body: issue.body,
    url: issue.url,
    labels: issue.labels,
    type,
    base: meta.base || "main",
    slug: slugify(issue.title.replace(/^\[(spec|bug|feature)\]\s*/i, "")),
  };
}

export async function loadSpecIssues(
  cwd: string,
  config: FactoryConfig,
  options: { readyOnly: boolean },
): Promise<Spec[]> {
  const labels = options.readyOnly
    ? [config.labels.spec, config.labels.ready]
    : [config.labels.spec];
  const issues = await github.listIssues(cwd, labels);
  return issues
    .filter((issue) => !issue.labels.includes(config.labels.holdout))
    .map(specFromIssue)
    .sort((left, right) => left.number - right.number);
}

export async function loadSpec(cwd: string, config: FactoryConfig, number: number): Promise<Spec | null> {
  const issue = await github.viewIssue(cwd, number);
  if (!issue) return null;
  if (!issue.labels.includes(config.labels.spec)) {
    throw new Error(`Issue #${number} is not labeled ${config.labels.spec}.`);
  }
  if (issue.labels.includes(config.labels.holdout)) {
    throw new Error(`Issue #${number} is a holdout scenario, not a spec. The wall says no.`);
  }
  return specFromIssue(issue);
}

export function renderPrompt(spec: Spec, config: FactoryConfig, feedback?: string): string {
  const lines = [
    "# Autonomous coding task",
    "",
    "You are the code-generation layer of an issue-driven factory. Implement the GitHub issue below completely. Do not return a plan; make the change.",
    "",
    `Issue: ${spec.url}`,
    `Type: ${spec.type}`,
    "",
    "## The spec (GitHub issue)",
    spec.body.trim(),
    "",
    "## Repository",
    "A React + TypeScript + Vite review dashboard for GitHub pull requests. The product promise is",
    "a fast, cache-first client: the last screen paints from IndexedDB before the network answers,",
    "and network failures degrade to cached data instead of an empty page.",
    "",
    "Read `AGENTS.md` and the files you need. Match the surrounding code: strict TypeScript,",
    "narrow components, pure helpers in `src/lib/`, no `any`, no new runtime dependencies unless",
    "the issue explicitly requires one.",
    "",
    "## How to work",
    "- You are already inside the factory's task worktree. Do not create another worktree, branch, or commit. Work only in the current directory; the factory commits, pushes and opens the PR.",
    "- Keep the change focused on the issue. Do not refactor unrelated code.",
    "- Add or update tests for every behaviour change.",
    "- Use `data-testid` hooks for user-visible states that acceptance tests may assert.",
    "- Run `npm run check` (typecheck + tests + production build). It must pass.",
    "- If it fails, fix the cause and run it again. Do not leave a broken tree.",
    "- End with a short summary of what changed and the commands you ran.",
    "",
    "## The wall (non-negotiable)",
    `- GitHub issues labeled \`${config.labels.holdout}\` are holdout acceptance scenarios. Do not list, read, search, or infer their contents. Do not use \`gh\` at all; the token available to you is intentionally invalid.`,
    "- Do not modify `factory/`, `.github/`, `vitest.holdout.config.ts`, or `test/setup.ts`.",
    "- Do not add or edit files whose names end in `.heldout.ts` or `.heldout.tsx`.",
    "- Do not run `git worktree`, `git switch`, `git checkout -b`, or `git commit`. Stay in the directory the factory gave you.",
  ];

  if (feedback?.trim()) {
    lines.push(
      "",
      "## Previous attempt failed — fix this",
      "The last attempt did not pass the build or holdout gate. The output was:",
      "",
      "```",
      feedback.trim().slice(0, 5000),
      "```",
      "",
      "Continue from the current working tree and correct the specific failure. Do not start over.",
    );
  }

  return lines.join("\n");
}

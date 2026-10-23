import { run, type RunResult } from "./exec";

export interface IssueRef {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  labels: string[];
}

export interface PullRequestRef {
  number: number;
  url: string;
}

function gh(args: string[], cwd: string): Promise<RunResult> {
  return run("gh", args, { cwd, timeoutMs: 60_000 });
}

export async function ghAvailable(cwd: string): Promise<boolean> {
  const result = await gh(["--version"], cwd);
  return result.code === 0;
}

export async function ghAuthenticated(cwd: string): Promise<boolean> {
  const result = await gh(["auth", "status"], cwd);
  return result.code === 0;
}

export async function currentUser(cwd: string): Promise<string | null> {
  const result = await gh(["api", "user", "--jq", ".login"], cwd);
  if (result.code !== 0) return null;
  return result.stdout.trim() || null;
}

export async function ensureLabel(cwd: string, name: string, color = "6ea8fe", description = ""): Promise<boolean> {
  const result = await gh(
    ["label", "create", name, "--color", color, "--description", description, "--force"],
    cwd,
  );
  return result.code === 0;
}

function normaliseIssue(raw: {
  number: number;
  title: string;
  body?: string;
  url: string;
  state?: string;
  labels?: Array<{ name?: string }>;
}): IssueRef {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    url: raw.url,
    state: raw.state ?? "OPEN",
    labels: (raw.labels ?? []).map((label) => label.name ?? "").filter(Boolean),
  };
}

const ISSUE_FIELDS = "number,title,body,url,state,labels";

export async function listIssues(cwd: string, labels: string[]): Promise<IssueRef[]> {
  const args = ["issue", "list", "--state", "open", "--json", ISSUE_FIELDS, "--limit", "100"];
  for (const label of labels) args.push("--label", label);
  const result = await gh(args, cwd);
  if (result.code !== 0) throw new Error(`gh issue list failed: ${result.stderr.trim()}`);
  try {
    return (JSON.parse(result.stdout) as Array<Parameters<typeof normaliseIssue>[0]>).map(normaliseIssue);
  } catch {
    return [];
  }
}

export async function viewIssue(cwd: string, number: number): Promise<IssueRef | null> {
  const result = await gh(["issue", "view", String(number), "--json", ISSUE_FIELDS], cwd);
  if (result.code !== 0) return null;
  try {
    return normaliseIssue(JSON.parse(result.stdout) as Parameters<typeof normaliseIssue>[0]);
  } catch {
    return null;
  }
}

export async function commentOnIssue(cwd: string, number: number, body: string): Promise<void> {
  await gh(["issue", "comment", String(number), "--body", body], cwd);
}

export async function addIssueLabels(cwd: string, number: number, labels: string[]): Promise<void> {
  if (labels.length === 0) return;
  const args = ["issue", "edit", String(number)];
  for (const label of labels) args.push("--add-label", label);
  await gh(args, cwd);
}

export async function removeIssueLabel(cwd: string, number: number, label: string): Promise<void> {
  await gh(["issue", "edit", String(number), "--remove-label", label], cwd);
}

export async function createPullRequest(
  cwd: string,
  options: { title: string; body: string; base: string; head: string; label?: string },
): Promise<PullRequestRef | null> {
  const args = [
    "pr",
    "create",
    "--title",
    options.title,
    "--body",
    options.body,
    "--base",
    options.base,
    "--head",
    options.head,
  ];
  if (options.label) args.push("--label", options.label);
  const result = await gh(args, cwd);
  if (result.code !== 0) return null;
  const url = result.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  const match = url.match(/\/pull\/(\d+)/);
  return match?.[1] ? { number: Number(match[1]), url } : null;
}

export async function pullRequestForBranch(cwd: string, branch: string): Promise<PullRequestRef | null> {
  const result = await gh(
    ["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"],
    cwd,
  );
  if (result.code !== 0) return null;
  try {
    const list = JSON.parse(result.stdout) as PullRequestRef[];
    return list[0] ?? null;
  } catch {
    return null;
  }
}

export async function mergePullRequest(
  cwd: string,
  number: number,
  method: "squash" | "merge" | "rebase",
): Promise<boolean> {
  const result = await gh(["pr", "merge", String(number), `--${method}`, "--delete-branch"], cwd);
  return result.code === 0;
}

export async function repoView(
  cwd: string,
  repo: string,
): Promise<{ nameWithOwner: string; visibility: string } | null> {
  const result = await gh(["repo", "view", repo, "--json", "nameWithOwner,visibility"], cwd);
  if (result.code !== 0) return null;
  try {
    return JSON.parse(result.stdout) as { nameWithOwner: string; visibility: string };
  } catch {
    return null;
  }
}

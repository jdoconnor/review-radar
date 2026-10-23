import type { FactoryConfig } from "./config";
import * as github from "./gh";

export type ScenarioKind = "vitest" | "command";

export interface Scenario {
  number: number;
  title: string;
  url: string;
  priority: "P0" | "P1" | "P2";
  narrative: string;
  kind: ScenarioKind;
  file: string | null;
  code: string | null;
  command: string | null;
}

function fence(body: string, language: string, from = 0): { code: string; start: number; end: number } | null {
  const pattern = new RegExp("```" + language + "\\s*\\n([\\s\\S]*?)```", "i");
  const slice = body.slice(from);
  const match = slice.match(pattern);
  if (!match?.[1]) return null;
  const start = from + (match.index ?? 0);
  return { code: match[1].trim(), start, end: start + match[0].length };
}

export function parseScenario(
  issue: github.IssueRef,
  meta: { priority?: string } = {},
): Scenario | null {
  const marker = issue.body.search(/^##\s+Machine\s*$/im);
  if (marker === -1) return null;

  const json = fence(issue.body, "json", marker);
  if (!json) return null;
  let config: { kind?: string; file?: string; priority?: string };
  try {
    config = JSON.parse(json.code) as typeof config;
  } catch {
    return null;
  }

  const priorityValue = (config.priority ?? meta.priority ?? "P1").toUpperCase();
  const priority: Scenario["priority"] =
    priorityValue === "P0" || priorityValue === "P2" ? priorityValue : "P1";

  const kind: ScenarioKind = config.kind === "command" ? "command" : "vitest";
  if (kind === "vitest") {
    const codeBlock = fence(issue.body, "(?:tsx|ts|typescript)", json.end) ?? fence(issue.body, "", json.end);
    if (!config.file || !codeBlock) return null;
    if (!/^[a-z0-9][a-z0-9-]*\.heldout\.tsx?$/.test(config.file)) {
      throw new Error(`Scenario #${issue.number} has an unsafe file name: ${config.file}`);
    }
    return {
      number: issue.number,
      title: issue.title,
      url: issue.url,
      priority,
      narrative: issue.body.slice(0, marker).trim(),
      kind,
      file: config.file,
      code: codeBlock.code,
      command: null,
    };
  }

  const commandBlock = fence(issue.body, "(?:bash|sh)", json.end);
  const command = commandBlock?.code ?? null;
  if (!command) return null;
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    priority,
    narrative: issue.body.slice(0, marker).trim(),
    kind,
    file: null,
    code: commandBlock?.code ?? null,
    command,
  };
}

export async function loadScenarios(cwd: string, config: FactoryConfig): Promise<Scenario[]> {
  const issues = await github.listIssues(cwd, [config.labels.holdout]);
  const scenarios: Scenario[] = [];
  for (const issue of issues) {
    const scenario = parseScenario(issue);
    if (scenario) scenarios.push(scenario);
  }
  return scenarios.sort((left, right) => left.number - right.number);
}

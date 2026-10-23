import type { FactoryConfig } from "./config";
import * as github from "./gh";
import * as fs from "node:fs";
import * as path from "node:path";

function fence(body: string, language: string, from = 0): { code: string; start: number; end: number } | null {
  const pattern = new RegExp("```" + language + "\\s*\\n([\\s\\S]*?)```", "i");
  const slice = body.slice(from);
  const match = slice.match(pattern);
  if (!match?.[1]) return null;
  const start = from + (match.index ?? 0);
  return { code: match[1].trim(), start, end: start + match[0].length };
}

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

/**
 * Parse a vitest holdout scenario from a .heldout.tsx file.
 * The file name must match: test/<name>.heldout.tsx/ts
 * The file content is vitest test code (with or without markdown fences).
 */
export function parseHeldoutFile(filePath: string, content: string): Scenario | null {
  const relative = filePath.replace(/\\/g, "/");
  // Extract just the filename portion for pattern matching
  const fileName = relative.split("/").pop() || "";
  const nameMatch = fileName.match(/^[a-z0-9][a-z0-9-]*\.heldout\.tsx?$/i);
  if (!nameMatch) return null;

  const priority: Scenario["priority"] = "P1"; // default priority for code-based scenarios

  // Extract vitest test code - the whole file content if no fences,
  // otherwise the content inside fenced code blocks
  // Try to extract from fenced blocks first, fall back to full content
  let codeBlock = fence(content, "(?:tsx|ts|typescript)", 0);
  if (!codeBlock) {
    // No fenced block found; use the entire content as the code
    codeBlock = { code: content.trim(), start: 0, end: content.length };
  }

  if (!codeBlock.code) return null;

  return {
    number: 0, // code-based scenarios don't have issue numbers
    title: relative,
    url: "",
    priority,
    narrative: "Code-based holdout scenario from " + relative,
    kind: "vitest",
    file: relative,
    code: codeBlock.code,
    command: null,
  };
}

/**
 * Load holdout scenarios from local test/ directory files.
 * Reads all test/ directory files matching *.heldout.ts or *.heldout.tsx.
 */
export function loadScenariosFromCode(
  cwd: string,
  config: FactoryConfig,
): Promise<Scenario[]> {
  console.log("DEBUG: loadScenariosFromCode cwd =", cwd);
  // Walk the test directory and find all .heldout.ts and .heldout.tsx files
  const heldoutDir = path.join(cwd, "test");
  console.log("DEBUG: heldoutDir =", heldoutDir, "exists:", fs.existsSync(heldoutDir));
  
  const walkDir = (dir: string): string[] => {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    console.log("DEBUG: walkDir entries count =", entries.length);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath));
      } else if (entry.isFile()) {
        const rel = path.relative(cwd, fullPath);
        const matches = /\.heldout\.(tsx?)$/i.test(rel);
        console.log("DEBUG: file", rel, "matches=", matches);
        if (matches) {
          results.push(rel);
        }
      }
    }
    return results;
  };
  
  const files = walkDir(heldoutDir);
  console.log("DEBUG: walkDir returned", files.length, "files:", files);
  
  const scenarios: Scenario[] = [];
  for (const file of files) {
    try {
      const filePath = path.join(cwd, file);
      console.log("DEBUG: processing file", filePath);
      const content = fs.readFileSync(filePath, "utf8");
      console.log("DEBUG: content length =", content.length);
      const scenario = parseHeldoutFile(file, content);
      console.log("DEBUG: parseHeldoutFile returned:", scenario ? "scenario" : "null");
      if (scenario) {
        scenarios.push(scenario);
        console.log("DEBUG: scenario priority =", scenario.priority, "file =", scenario.file);
      }
    } catch (e) {
      console.error("DEBUG: error processing file", file, e);
    }
  }
  console.log("DEBUG: total scenarios =", scenarios.length);

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(cwd, file), "utf8");
      const scenario = parseHeldoutFile(file, content);
      if (scenario) scenarios.push(scenario);
    } catch (e) {
      // Skip files that can't be read
    }
  }
  return Promise.resolve(
    scenarios.sort((left, right) => left.priority === "P0" ? -1 : right.priority === "P0" ? 1 : left.title.localeCompare(right.title))
  );
}

/**
 * Legacy: load holdout scenarios from GitHub issues.
 * Kept for backward compatibility; typically not used when code-based scenarios exist.
 */
export async function loadScenariosFromGithub(
  cwd: string,
  config: FactoryConfig,
): Promise<Scenario[]> {
  const issues = await github.listIssues(cwd, [config.labels.holdout]);
  const scenarios: Scenario[] = [];
  for (const issue of issues) {
    // Use the existing parseScenario logic - but we'll skip it for now
    // and rely on code-based scenarios instead
    scenarios.push({
      number: 0,
      title: issue.title,
      url: issue.url,
      priority: "P1",
      narrative: "GitHub issue-based scenario (deprecated).",
      kind: "vitest",
      file: null,
      code: null,
      command: null,
    } as Scenario);
  }
  return scenarios;
}

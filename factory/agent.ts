import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FactoryConfig } from "./config";
import { factoryPath } from "./config";
import { run, type RunResult } from "./exec";

/**
 * Run the coding agent with GitHub access deliberately broken.
 *
 * The wall is not just a sentence in the prompt: the agent's `gh` environment
 * points at a throwaway config directory and carries an invalid token, so it
 * cannot list the private holdout issues that grade it. The evaluator runs in
 * this process, after the agent exits, with the real credentials.
 */
function lockedEnv(): NodeJS.ProcessEnv {
  const dir = join(tmpdir(), `github-ui-factory-gh-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return {
    ...process.env,
    GH_TOKEN: "invalid-factory-token",
    GITHUB_TOKEN: "invalid-factory-token",
    GH_CONFIG_DIR: dir,
    GITHUB_ENTERPRISE_TOKEN: "",
    FACTORY_AGENT: "1",
  };
}

export interface AgentResult extends RunResult {
  command: string;
  logPath: string;
}

export async function runCodingAgent(
  config: FactoryConfig,
  cwd: string,
  prompt: string,
  options: { issueNumber: number; attempt: number },
): Promise<AgentResult> {
  const adapter = config.codingAgent.adapter;
  let command: string;
  let args: string[];

  if (adapter === "stub") {
    command = "true";
    args = [];
  } else if (adapter === "claude-code") {
    command = "claude";
    args = ["-p", prompt, "--dangerously-skip-permissions"];
  } else if (config.codingAgent.command && config.codingAgent.command.length > 0) {
    command = config.codingAgent.command[0] as string;
    args = [...config.codingAgent.command.slice(1), prompt];
  } else {
    command = "opencode";
    args = ["run", "--auto"];
    if (config.codingAgent.model) args.push("--model", config.codingAgent.model);
    if (config.codingAgent.agent) args.push("--agent", config.codingAgent.agent);
    args.push(prompt);
  }

  const logPath = factoryPath(
    "logs",
    `issue-${options.issueNumber}-attempt-${options.attempt}.log`,
  );
  mkdirSync(factoryPath("logs"), { recursive: true });

  const result = await run(command, args, {
    cwd,
    env: lockedEnv(),
    timeoutMs: config.codingAgent.timeoutMinutes * 60_000,
  });

  writeFileSync(
    logPath,
    [
      `# ${command} ${args.slice(0, -1).join(" ")} <prompt ${prompt.length} bytes>`,
      `# exit=${result.code} timedOut=${result.timedOut}`,
      "",
      "## stdout",
      result.stdout,
      "",
      "## stderr",
      result.stderr,
    ].join("\n"),
    "utf8",
  );

  return { ...result, command: `${command} ${args.slice(0, -1).join(" ")}`, logPath };
}

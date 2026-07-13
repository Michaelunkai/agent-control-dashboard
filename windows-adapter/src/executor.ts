import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { launchPinnedDesktopTask } from "./desktop-launcher.js";
import type { ClaimedTask } from "./sync.js";

export interface ExecutionResult {
  exitCode: number;
  summary: string;
  outputPath: string;
  sessionId: string;
}

function safeDirectoryName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export function executionTimeoutMs(value = process.env.AgentControl__ExecutionTimeoutMs): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 7_200_000;
}

export async function executeTask(task: ClaimedTask, taskRoot: string): Promise<ExecutionResult> {
  const workspace = join(taskRoot, safeDirectoryName(task.id));
  const outputPath = join(workspace, "codex-session.txt");
  const resultPath = join(workspace, "execution-result.json");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "AGENTS.md"), [
    "# Agent Control Managed Mission",
    "",
    `Dashboard task: ${task.id}`,
    "",
    "Continue the mission from the submitted prompt, report meaningful progress, verify the result, and finish clearly."
  ].join("\n"), "utf8");

  const launched = await launchPinnedDesktopTask(task, workspace);
  const summary = `Started and pinned Codex session: ${launched.title} (${launched.marker})`;
  const result = { exitCode: 0, summary, outputPath, session: launched };
  writeFileSync(outputPath, `${summary}\n`, "utf8");
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  return { exitCode: 0, summary, outputPath, sessionId: launched.sessionId };
}

export function evidenceReference(outputPath: string): string {
  return `windows-local:${basename(outputPath)}`;
}

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ClaimedTask } from "./sync.js";

export interface ExecutionResult {
  exitCode: number;
  summary: string;
  outputPath: string;
}

function safeDirectoryName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function codexPath(): string {
  if (process.env.AgentControl__CodexPath) return process.env.AgentControl__CodexPath;
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const installed = join(localAppData, "OpenAI", "Codex", "bin", "codex.exe");
  return existsSync(installed) ? installed : "codex";
}

export function executionTimeoutMs(value = process.env.AgentControl__ExecutionTimeoutMs): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 7_200_000;
}

export async function executeTask(task: ClaimedTask, taskRoot: string): Promise<ExecutionResult> {
  const workspace = join(taskRoot, safeDirectoryName(task.id));
  const outputPath = join(workspace, "codex-final.txt");
  const resultPath = join(workspace, "execution-result.json");
  const stderrPath = join(workspace, "codex-stderr.log");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "AGENTS.md"), [
    "# Agent Control Managed Task",
    "",
    "- Execute only the queued task in the prompt and then exit.",
    "- Do not create or continue goals, use multi-agent delegation, or wait for user input.",
    "- Do not run vault, Todoist, `done`, or other conversation-closeout workflows.",
    "- Keep all task-created files inside this workspace unless the prompt explicitly names another path.",
    "- Verify the requested result and end with a concise final summary."
  ].join("\n"), "utf8");

  const prompt = [
    `Complete this Agent Control task: ${task.title}`,
    "",
    task.description,
    "",
    "Work autonomously in this workspace. Implement and verify the requested result.",
    "Do not ask the user questions. End with a concise summary of changes and verification."
  ].join("\n");
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--dangerously-bypass-approvals-and-sandbox",
    "--output-last-message",
    outputPath,
    "--cd",
    workspace,
    prompt
  ];

  const exitCode = await new Promise<number>((resolve, reject) => {
    const stderrLog = createWriteStream(stderrPath, { flags: "w" });
    const child = spawn(codexPath(), args, {
      cwd: workspace,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      env: { ...process.env, AGENT_CONTROL_MANAGED_TASK_ID: task.id }
    });
    let errorText = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, executionTimeoutMs());
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrLog.write(chunk);
      errorText = `${errorText}${chunk}`.slice(-8_000);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      stderrLog.end();
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      stderrLog.end();
      if (code !== 0 && !existsSync(outputPath)) {
        writeFileSync(
          outputPath,
          timedOut ? `Codex exceeded the ${executionTimeoutMs()} ms execution limit.` :
            errorText || `Codex exited with code ${code ?? -1}.`,
          "utf8"
        );
      }
      resolve(timedOut ? 124 : code ?? -1);
    });
  });
  const summary = readFileSync(outputPath, "utf8").trim() || `Codex exited with code ${exitCode}.`;
  const result = { exitCode, summary, outputPath };
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  return result;
}

export function evidenceReference(outputPath: string): string {
  return `windows-local:${basename(outputPath)}`;
}

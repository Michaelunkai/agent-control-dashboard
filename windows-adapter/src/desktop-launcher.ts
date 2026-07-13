import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaimedTask } from "./sync.js";

export interface DesktopLaunchResult {
  accepted: boolean;
  marker: string;
  sessionId: string;
  title: string;
  pinned: boolean;
}

export function desktopMissionPrompt(task: ClaimedTask): string {
  const marker = `AC-${task.id.slice(0, 8)}`;
  return `${task.title} [${marker}]\n\nAgent Control mission:\n${task.description}`;
}

export async function launchPinnedDesktopTask(task: ClaimedTask, workspace: string): Promise<DesktopLaunchResult> {
  const moduleRoot = dirname(fileURLToPath(import.meta.url));
  const script = join(moduleRoot, "..", "scripts", "Start-CodexDesktopTask.ps1");
  const args = [
    "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", script,
    "-Workspace", workspace, "-TaskId", task.id
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, {
      windowsHide: true,
      env: {
        ...process.env,
        AGENT_CONTROL_TASK_TITLE: task.title,
        AGENT_CONTROL_TASK_DESCRIPTION: task.description,
        AGENT_CONTROL_MANAGED_TASK_ID: task.id
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_000); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `desktop_launcher_failed:${code ?? -1}`));
        return;
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      try {
        const parsed = JSON.parse(line ?? "") as DesktopLaunchResult;
        if (!parsed.accepted || !parsed.pinned || !parsed.sessionId) throw new Error("desktop_launch_not_verified");
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    });
  });
}

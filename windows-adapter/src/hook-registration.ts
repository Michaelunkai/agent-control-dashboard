import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const lifecycleEvents = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"] as const;

interface HookDocument {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

function isAgentControlEntry(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const entry = value as { hooks?: unknown };
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook) => {
    if (!hook || typeof hook !== "object") return false;
    const command = hook as Record<string, unknown>;
    return [command.commandWindows, command.command_windows, command.command]
      .some((candidate) => typeof candidate === "string" && candidate.includes("Invoke-AgentControlHook.ps1"));
  });
}

export function repairHookRegistration(hooksPath: string, hookScriptPath: string): boolean {
  const document: HookDocument = existsSync(hooksPath)
    ? JSON.parse(readFileSync(hooksPath, "utf8")) as HookDocument
    : {};
  const hooks = document.hooks && typeof document.hooks === "object" && !Array.isArray(document.hooks)
    ? document.hooks
    : {};
  document.hooks = hooks;
  const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${hookScriptPath}"`;
  let changed = false;

  for (const eventName of lifecycleEvents) {
    const current = Array.isArray(hooks[eventName]) ? hooks[eventName] as unknown[] : [];
    const unrelated = current.filter((entry) => !isAgentControlEntry(entry));
    const canonical = {
      hooks: [{
        type: "command",
        // Codex Desktop 0.144.3 requires `command` for command handlers.
        // Keep recognizing legacy Windows aliases above so prior installs repair in place.
        command,
        timeout: 5,
        statusMessage: "Updating Agent Control"
      }]
    };
    const replacement = [...unrelated, canonical];
    if (JSON.stringify(current) !== JSON.stringify(replacement)) {
      hooks[eventName] = replacement;
      changed = true;
    }
  }

  if (!changed && existsSync(hooksPath)) return false;
  mkdirSync(dirname(hooksPath), { recursive: true });
  const temporary = `${hooksPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  renameSync(temporary, hooksPath);
  return true;
}

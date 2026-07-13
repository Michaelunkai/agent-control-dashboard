import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repairHookRegistration } from "./hook-registration.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("hook registration self-repair", () => {
  it("repairs all lifecycle hooks while preserving unrelated entries and root settings", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-hooks-"));
    roots.push(root);
    const hooksPath = join(root, "hooks.json");
    const hookScript = "C:\\AgentControl\\hooks\\Invoke-AgentControlHook.ps1";
    const unrelated = { hooks: [{ type: "command", command: "other-tool.exe" }] };
    writeFileSync(hooksPath, JSON.stringify({ version: 7, hooks: {
      Stop: [unrelated, { hooks: [{ type: "command", commandWindows: `powershell -File \"${hookScript}\"` }] }],
      Notification: [unrelated]
    } }), "utf8");

    expect(repairHookRegistration(hooksPath, hookScript)).toBe(true);
    const repaired = JSON.parse(readFileSync(hooksPath, "utf8")) as {
      version: number; hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>>;
    };
    expect(repaired.version).toBe(7);
    expect(repaired.hooks.Notification).toEqual([unrelated]);
    for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"]) {
      expect(repaired.hooks[event]).toHaveLength(event === "Stop" ? 2 : 1);
      expect(JSON.stringify(repaired.hooks[event])).toContain("Invoke-AgentControlHook.ps1");
      const adapterEntry = repaired.hooks[event].at(-1)?.hooks[0];
      expect(adapterEntry?.command).toContain("Invoke-AgentControlHook.ps1");
      expect(adapterEntry?.commandWindows).toBeUndefined();
    }
    expect(repairHookRegistration(hooksPath, hookScript)).toBe(false);
  });

  it("recreates registrations after another tool overwrites them", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-hooks-"));
    roots.push(root);
    const hooksPath = join(root, "hooks.json");
    writeFileSync(hooksPath, JSON.stringify({ hooks: { Stop: [] } }), "utf8");
    expect(repairHookRegistration(hooksPath, "C:\\AgentControl\\Invoke-AgentControlHook.ps1")).toBe(true);
    const hooks = (JSON.parse(readFileSync(hooksPath, "utf8")) as { hooks: Record<string, unknown[]> }).hooks;
    expect(Object.keys(hooks)).toEqual(expect.arrayContaining([
      "SessionStart", "UserPromptSubmit", "PostToolUse", "Stop", "SessionEnd"
    ]));
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { desktopMissionPrompt } from "./desktop-launcher.js";

describe("desktopMissionPrompt", () => {
  it("keeps an understandable title, a trace marker, and the full mission", () => {
    const prompt = desktopMissionPrompt({
      id: "12345678-abcd", title: "Repair synchronization", description: "Fix offline retry behavior",
      status: "IN_PROGRESS", version: 3
    });
    expect(prompt).toContain("Repair synchronization [AC-12345678]");
    expect(prompt).toContain("Agent Control mission:\nFix offline retry behavior");
  });

  it("opens and verifies the requested workspace before creating a task", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const script = readFileSync(join(root, "..", "scripts", "Start-CodexDesktopTask.ps1"), "utf8");
    expect(script).toContain("Start-Process -FilePath $codexCommand -ArgumentList @('app', $Workspace)");
    expect(script).toContain("Wait-Until { Get-CodexWindowForWorkspace }");
    expect(script).toContain("Codex Desktop did not open the required workspace");
  });
});

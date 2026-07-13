import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importHookFallback } from "./fallback.js";
import { AdapterStore } from "./store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("importHookFallback", () => {
  it("atomically imports valid hook events into the durable outbox", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-fallback-"));
    roots.push(root);
    const path = join(root, "hook-fallback.jsonl");
    writeFileSync(path, `${JSON.stringify({
      event_id: "fallback-1",
      hook_event_name: "SessionStart",
      session_id: "session-1"
    })}\n`, "utf8");
    const store = new AdapterStore(join(root, "adapter.db"));

    expect(importHookFallback(store, path)).toEqual({ imported: 1, invalid: 0 });
    expect(store.pending()[0].envelope.id).toBe("fallback-1");
    expect(store.activeTaskId()).toBe("codex:session-1");
    expect(existsSync(path)).toBe(false);
    store.close();
  });

  it("retains malformed lines as evidence without blocking valid events", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-fallback-"));
    roots.push(root);
    const path = join(root, "hook-fallback.jsonl");
    writeFileSync(path, `not-json\n${JSON.stringify({
      hook_event_name: "Stop",
      session_id: "session-2"
    })}\n`, "utf8");
    const store = new AdapterStore(join(root, "adapter.db"));

    expect(importHookFallback(store, path)).toEqual({ imported: 1, invalid: 1 });
    const invalid = findFile(root, ".invalid");
    expect(readFileSync(invalid, "utf8")).toContain("not-json");
    store.close();
  });
});

function findFile(root: string, suffix: string): string {
  const match = readdirSync(root).find((name) => name.endsWith(suffix));
  if (!match) throw new Error(`No ${suffix} file found`);
  return join(root, match);
}

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AdapterStore } from "./store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AdapterStore", () => {
  it("persists hook events idempotently", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-"));
    roots.push(root);
    const path = join(root, "adapter.db");
    const first = new AdapterStore(path);
    const envelope = {
      id: "event-1",
      eventName: "SessionStart",
      sessionId: "session-1",
      occurredAt: new Date().toISOString(),
      payload: { session_id: "session-1" }
    };
    first.enqueue(envelope);
    first.enqueue(envelope);
    first.close();
    const reopened = new AdapterStore(path);
    expect(reopened.pending()).toHaveLength(1);
    expect(reopened.pending()[0].envelope.sessionId).toBe("session-1");
    reopened.close();
  });

  it("retains failures until completion", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-"));
    roots.push(root);
    const store = new AdapterStore(join(root, "adapter.db"));
    store.enqueue({
      id: "event-2",
      eventName: "Stop",
      sessionId: "session-2",
      occurredAt: new Date().toISOString(),
      payload: {}
    });
    const item = store.pending()[0];
    store.fail(item.sequence, "offline");
    expect(store.pending()[0].attempts).toBe(1);
    store.complete(item.sequence);
    expect(store.pending()).toHaveLength(0);
    store.close();
  });

  it("tracks the active Codex task across process restarts", () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-"));
    roots.push(root);
    const path = join(root, "adapter.db");
    const store = new AdapterStore(path);
    store.enqueue({
      id: "start-1", eventName: "UserPromptSubmit", sessionId: "session-9",
      occurredAt: new Date().toISOString(), payload: {}
    });
    expect(store.activeTaskId()).toBe("codex:session-9");
    store.close();
    const reopened = new AdapterStore(path);
    expect(reopened.activeTaskId()).toBe("codex:session-9");
    reopened.enqueue({
      id: "stop-1", eventName: "Stop", sessionId: "session-9",
      occurredAt: new Date().toISOString(), payload: {}
    });
    expect(reopened.activeTaskId()).toBeUndefined();
    reopened.close();
  });
});

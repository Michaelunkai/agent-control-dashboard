import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AdapterStore } from "./store.js";
import {
  claimTask,
  completeTask,
  failTask,
  flushOutbox,
  registerAgent,
  sendHeartbeat,
  updateTaskStage
} from "./sync.js";

afterEach(() => vi.unstubAllGlobals());

describe("agent presence", () => {
  it("registers the Windows Codex executor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await registerAgent("https://control.example", "owner", "desktop-1", "Workstation")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://control.example/v1/agents/desktop-1",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("reports the active task in heartbeats", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendHeartbeat("https://control.example/", "owner", "desktop-1", "codex:session-7")).toBe(true);
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      availability: "busy",
      currentTaskId: "codex:session-7"
    });
  });

  it("reports idle state without a stale task id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendHeartbeat("https://control.example", "owner", "desktop-1")).toBe(true);
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({ availability: "online" });
  });

  it("flushes successful hooks and retains retryable failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-sync-"));
    const store = new AdapterStore(join(root, "adapter.db"));
    store.enqueue({
      id: "one", eventName: "SessionStart", sessionId: "session-1",
      occurredAt: new Date().toISOString(), payload: {}
    });
    store.enqueue({
      id: "two", eventName: "Stop", sessionId: "session-1",
      occurredAt: new Date().toISOString(), payload: {}
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 202 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushOutbox(store, "https://control.example", "owner")).toBe(1);
    expect(store.pending()).toHaveLength(1);
    expect(store.pending()[0].attempts).toBe(1);
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("records network failures and stops the flush cycle", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-sync-"));
    const store = new AdapterStore(join(root, "adapter.db"));
    store.enqueue({
      id: "network", eventName: "SessionStart", sessionId: "session-2",
      occurredAt: new Date().toISOString(), payload: {}
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    expect(await flushOutbox(store, "https://control.example", "owner")).toBe(0);
    expect(store.pending()[0].lastError).toBe("TypeError");
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("clears a managed binding only after the control plane reports a terminal state", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-control-sync-"));
    const store = new AdapterStore(join(root, "adapter.db"));
    store.bindManagedSession("task-managed", "session-managed");
    store.enqueue({
      id: "managed-stop", eventName: "SessionEnd", sessionId: "session-managed",
      occurredAt: new Date().toISOString(), payload: {}
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "DONE" }), {
      status: 200, headers: { "content-type": "application/json" }
    })));
    expect(await flushOutbox(store, "https://control.example", "owner")).toBe(1);
    expect(store.managedTaskId()).toBeUndefined();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("claims compatible work and handles an empty queue", async () => {
    const task = { id: "task-1", title: "Test task", description: "Run it", status: "IN_PROGRESS", version: 3 };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ task }), {
        status: 200, headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await claimTask("https://control.example", "owner", "desktop-1")).toEqual(task);
    expect(await claimTask("https://control.example", "owner", "desktop-1")).toBeUndefined();
  });

  it("reports managed executor stages and returns the updated task version", async () => {
    const changed = {
      id: "task-1", title: "Test", description: "Run it", status: "IN_PROGRESS", version: 4,
      progressPercent: 15, currentStep: "Preparing"
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(changed), {
      status: 200, headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await updateTaskStage(
      "https://control.example", "owner",
      { id: "task-1", title: "Test", description: "Run it", status: "IN_PROGRESS", version: 3 },
      "Preparing", 15
    );
    expect(result).toEqual(changed);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      currentStep: "Preparing",
      progressPercent: 15,
      expectedVersion: 3
    });
  });

  it("uploads evidence, verifies, and completes successful work", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 4 }), {
        status: 200, headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 5 }), {
        status: 200, headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await completeTask(
      "https://control.example",
      "owner",
      { id: "task-1", title: "Test", description: "Test", status: "IN_PROGRESS", version: 3 },
      "All checks passed",
      "windows-local:codex-final.txt"
    );
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://control.example/v1/tasks/task-1/evidence",
      "https://control.example/v1/tasks/task-1/transition",
      "https://control.example/v1/tasks/task-1/progress",
      "https://control.example/v1/tasks/task-1/complete"
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toEqual({
      currentStep: "Complete",
      progressPercent: 100,
      expectedVersion: 4
    });
  });

  it("still completes after a non-authoritative final progress failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 4 }), {
        status: 200, headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response("progress failed", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await completeTask(
      "https://control.example", "owner",
      { id: "task-1", title: "Test", description: "Test", status: "IN_PROGRESS", version: 3 },
      "Session started", "windows-local:session.txt"
    );
    expect(String(fetchMock.mock.calls[3][0])).toBe("https://control.example/v1/tasks/task-1/complete");
  });

  it("reports failed Codex execution", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await failTask(
      "https://control.example",
      "owner",
      { id: "task-1", title: "Test", description: "Test", status: "IN_PROGRESS", version: 3 },
      "Codex exited with code 1"
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      to: "FAILED",
      reason: "Codex exited with code 1",
      expectedVersion: 3
    });
  });
});

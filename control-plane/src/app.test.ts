import { describe, expect, it } from "vitest";
import { TaskStatus } from "@agent-control/protocol";
import { createApp, InMemoryStore } from "./control-app.js";

describe("control plane API", () => {
  it("creates a task and returns it through incremental sync", async () => {
    const app = createApp(new InMemoryStore(), "test-owner");
    const created = await app.request("/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-owner" },
      body: JSON.stringify({
        clientId: "offline-task-1",
        description: "Fix the login redirect in the Android application",
        priority: 4,
        requiredCapabilities: ["coding"]
      })
    });
    expect(created.status).toBe(201);
    const task = await created.json() as { id: string; status: string; title: string };
    expect(task.id).toBe("offline-task-1");
    expect(task.status).toBe("READY");
    expect(task.title).toBe("Fix login redirect in Android application");

    const sync = await app.request("/v1/sync?cursor=0", {
      headers: { authorization: "Bearer test-owner" }
    });
    expect(sync.status).toBe(200);
    const body = await sync.json() as { cursor: number; tasks: Array<{ id: string }> };
    expect(body.cursor).toBeGreaterThan(0);
    expect(body.tasks.map((item) => item.id)).toContain(task.id);
  });

  it("treats a repeated offline create as idempotent", async () => {
    const app = createApp(new InMemoryStore(), "test-owner");
    const request = () => app.request("/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-owner" },
      body: JSON.stringify({ clientId: "stable-id", description: "Add offline sync", priority: 3 })
    });
    expect((await request()).status).toBe(201);
    expect((await request()).status).toBe(200);
    const sync = await app.request("/v1/sync?cursor=0", {
      headers: { authorization: "Bearer test-owner" }
    });
    const body = await sync.json() as { tasks: Array<{ id: string }> };
    expect(body.tasks.filter((task) => task.id === "stable-id")).toHaveLength(1);
  });

  it("rejects unauthenticated requests", async () => {
    const app = createApp(new InMemoryStore(), "test-owner");
    const response = await app.request("/v1/sync?cursor=0");
    expect(response.status).toBe(401);
  });

  it("fails closed when the owner token is not configured", async () => {
    const app = createApp(new InMemoryStore());
    const response = await app.request("/v1/sync?cursor=0", {
      headers: { authorization: "Bearer anything" }
    });
    expect(response.status).toBe(503);
  });

  it("moves unavailable cloud work to an explicit waiting state", async () => {
    const store = new InMemoryStore();
    const app = createApp(store, "test-owner");
    const created = await app.request("/v1/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-owner" },
      body: JSON.stringify({
        description: "Upgrade the dashboard accessibility",
        requiredCapabilities: ["coding"]
      })
    });
    const task = await created.json() as { id: string };
    const dispatch = await app.request(`/v1/tasks/${task.id}/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-owner" },
      body: JSON.stringify({
        preferredExecutor: "cloud",
        availability: { network: true, pc: false, android: true, quota: false }
      })
    });
    expect(dispatch.status).toBe(200);
    expect((await dispatch.json() as { status: string }).status).toBe("WAITING_QUOTA");
  });

  it("turns Codex lifecycle hooks into one durable task", async () => {
    const app = createApp(new InMemoryStore(), "test-owner");
    const postHook = (eventName: string, payload: Record<string, unknown>) => app.request("/v1/hooks/codex", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-owner" },
      body: JSON.stringify({
        id: `event-${eventName}`,
        eventName,
        sessionId: "session-42",
        occurredAt: "2026-07-12T10:00:00.000Z",
        payload
      })
    });
    expect((await postHook("UserPromptSubmit", {
      prompt: "Fix the offline dashboard synchronization",
      cwd: "C:\\repo"
    })).status).toBe(200);
    const stopped = await postHook("Stop", { reason: "completed" });
    expect(stopped.status).toBe(200);
    expect((await stopped.json() as { status: string }).status).toBe("VERIFYING");
    const sync = await app.request("/v1/sync?cursor=0", {
      headers: { authorization: "Bearer test-owner" }
    });
    const body = await sync.json() as { tasks: Array<{ id: string; status: string }> };
    expect(body.tasks.filter((task) => task.id === "codex:session-42")).toHaveLength(1);
  });

  it("registers agents and updates heartbeats", async () => {
    const app = createApp(new InMemoryStore(), "test-owner");
    const headers = { "content-type": "application/json", authorization: "Bearer test-owner" };
    expect((await app.request("/v1/agents/desktop-1", {
      method: "PUT", headers, body: JSON.stringify({
        name: "Windows Codex", kind: "windows", capabilities: ["coding"], availability: "online"
      })
    })).status).toBe(200);
    expect((await app.request("/v1/agents/desktop-1/heartbeat", {
      method: "POST", headers, body: JSON.stringify({ availability: "busy", currentTaskId: "task-42" })
    })).status).toBe(200);
    expect((await app.request("/v1/agents/desktop-1/heartbeat", {
      method: "POST", headers, body: JSON.stringify({ availability: "online" })
    })).status).toBe(200);
    const response = await app.request("/v1/agents", { headers });
    const body = await response.json() as { agents: Array<Record<string, unknown>> };
    expect(body.agents).toEqual([
      expect.objectContaining({
        id: "desktop-1",
        availability: "online"
      })
    ]);
    expect(body.agents[0]).not.toHaveProperty("currentTaskId");
  });

  it("claims only Windows-dispatched work with matching capabilities", async () => {
    const store = new InMemoryStore();
    const app = createApp(store, "test-owner");
    const headers = { "content-type": "application/json", authorization: "Bearer test-owner" };
    const task = await store.createTask({
      description: "Run the autonomous Windows Codex task",
      priority: 5,
      requiredCapabilities: ["coding", "codex"]
    });
    await store.queue(task.id, "windows", task.version);
    const missing = await app.request("/v1/agents/desktop-1/claim", {
      method: "POST", headers, body: JSON.stringify({ capabilities: ["coding"] })
    });
    expect(missing.status).toBe(204);
    const claimed = await app.request("/v1/agents/desktop-1/claim", {
      method: "POST", headers, body: JSON.stringify({ capabilities: ["coding", "codex"] })
    });
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({
      task: expect.objectContaining({
        id: task.id,
        status: "IN_PROGRESS",
        assignedAgentId: "desktop-1"
      })
    });
  });

  it("requires evidence before completion", async () => {
    const store = new InMemoryStore();
    const app = createApp(store, "test-owner");
    const headers = { "content-type": "application/json", authorization: "Bearer test-owner" };
    const task = await store.createTask({ description: "Verify dashboard sync", priority: 3, requiredCapabilities: ["coding"] });
    await store.transition(task.id, TaskStatus.QUEUED, "test");
    await store.transition(task.id, TaskStatus.IN_PROGRESS, "test");
    await store.transition(task.id, TaskStatus.VERIFYING, "test");
    expect((await app.request(`/v1/tasks/${task.id}/complete`, {
      method: "POST", headers, body: "{}"
    })).status).toBe(409);
    expect((await app.request(`/v1/tasks/${task.id}/evidence`, {
      method: "POST", headers,
      body: JSON.stringify({ kind: "test", summary: "Synchronization tests passed", reference: "run-42" })
    })).status).toBe(201);
    const completed = await app.request(`/v1/tasks/${task.id}/complete`, {
      method: "POST", headers, body: "{}"
    });
    expect((await completed.json() as { status: string }).status).toBe("DONE");
  });

  it("rejects stale task controls and supports cancellation", async () => {
    const store = new InMemoryStore();
    const app = createApp(store, "test-owner");
    const headers = { "content-type": "application/json", authorization: "Bearer test-owner" };
    const task = await store.createTask({ description: "Run the release build", priority: 4, requiredCapabilities: ["coding"] });
    const stale = await app.request(`/v1/tasks/${task.id}/transition`, {
      method: "POST", headers,
      body: JSON.stringify({ to: "QUEUED", reason: "owner_start", expectedVersion: 99 })
    });
    expect(stale.status).toBe(409);
    const cancelled = await app.request(`/v1/tasks/${task.id}/cancel`, {
      method: "POST", headers, body: JSON.stringify({ expectedVersion: 1, reason: "owner_cancelled" })
    });
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json() as { status: string }).status).toBe("CANCELLED");
  });

  it("records and resolves an approval request", async () => {
    const store = new InMemoryStore();
    const app = createApp(store, "test-owner");
    const headers = { "content-type": "application/json", authorization: "Bearer test-owner" };
    const task = await store.createTask({ description: "Deploy the control plane", priority: 5, requiredCapabilities: ["coding"] });
    await store.transition(task.id, TaskStatus.QUEUED, "test");
    await store.transition(task.id, TaskStatus.IN_PROGRESS, "test");
    const requested = await app.request(`/v1/tasks/${task.id}/approval`, {
      method: "POST", headers,
      body: JSON.stringify({ question: "Deploy this release?", risk: "Creates a production deployment" })
    });
    expect(requested.status).toBe(201);
    expect((await requested.json() as { task: { status: string } }).task.status).toBe("WAITING_APPROVAL");
    const approvalId = (await store.listApprovals(task.id))[0].id;
    const decided = await app.request(`/v1/approvals/${approvalId}/decision`, {
      method: "POST", headers, body: JSON.stringify({ decision: "approved" })
    });
    expect(decided.status).toBe(200);
    expect((await decided.json() as { task: { status: string } }).task.status).toBe("QUEUED");
  });
});

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { TaskStatus, type Agent } from "@agent-control/protocol";
import { PostgresTaskStore } from "./postgres-store.js";

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
const describeDatabase = connectionString ? describe : describe.skip;

describeDatabase("PostgresTaskStore", () => {
  const namespace = `integration-${randomUUID()}`;
  const taskIds: string[] = [];
  const agentIds: string[] = [];
  let pool: Pool;
  let store: PostgresTaskStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 3 });
    const migration = await readFile(new URL("../migrations/0002_postgres.sql", import.meta.url), "utf8");
    await pool.query(migration);
    const executorMigration = await readFile(new URL("../migrations/0003_task_executor.sql", import.meta.url), "utf8");
    await pool.query(executorMigration);
    const activityMigration = await readFile(
      new URL("../migrations/0004_task_activity_postgres.sql", import.meta.url), "utf8"
    );
    await pool.query(activityMigration);
    store = new PostgresTaskStore(pool);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query("DELETE FROM approvals WHERE task_id=ANY($1::text[])", [taskIds]);
      await pool.query("DELETE FROM task_evidence WHERE task_id=ANY($1::text[])", [taskIds]);
      await pool.query("DELETE FROM task_events WHERE task_id=ANY($1::text[])", [taskIds]);
      await pool.query("DELETE FROM tasks WHERE id=ANY($1::text[])", [taskIds]);
      await pool.query("DELETE FROM agents WHERE id=ANY($1::text[])", [agentIds]);
    } finally {
      await pool.end();
    }
  });

  it("persists tasks and serializes optimistic transitions", async () => {
    const id = `${namespace}-task`;
    taskIds.push(id);
    const created = await store.createTask({
      id,
      description: "Verify durable PostgreSQL task transitions",
      priority: 5,
      requiredCapabilities: ["coding", "postgres"]
    });
    const results = await Promise.allSettled([
      store.transition(id, TaskStatus.QUEUED, "first", created.version),
      store.transition(id, TaskStatus.QUEUED, "second", created.version)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await store.getTask(id)).toEqual(expect.objectContaining({ status: TaskStatus.QUEUED, version: 2 }));
    expect((await store.sync(0)).events.filter((event) => event.taskId === id)).toHaveLength(2);
  });

  it("persists task details, progress, and lifecycle timestamps", async () => {
    const id = `${namespace}-lifecycle`;
    taskIds.push(id);
    const created = await store.createTask({
      id,
      title: "Pinned PostgreSQL task",
      description: "Original description",
      priority: 4,
      requiredCapabilities: []
    });
    const detailed = await store.updateDetails(id, "Replacement description", "Generated title", created.version);
    expect(detailed.title).toBe("Pinned PostgreSQL task");
    const progressed = await store.updateProgress(id, {
      progressPercent: 65,
      currentStep: "Running integration checks"
    }, detailed.version);
    const queued = await store.transition(id, TaskStatus.QUEUED, "test", progressed.version);
    const active = await store.transition(id, TaskStatus.IN_PROGRESS, "test", queued.version);
    expect(await store.getTask(id)).toEqual(expect.objectContaining({
      progressPercent: 65,
      currentStep: "Running integration checks",
      startedAt: active.startedAt
    }));
    expect((await store.sync(0)).events.filter((event) => event.taskId === id).map((event) => event.type))
      .toEqual(["task_created", "details_updated", "progress", "status_changed", "status_changed"]);
  });

  it("persists agents, approvals, and evidence", async () => {
    const agentId = `${namespace}-agent`;
    agentIds.push(agentId);
    const agent: Agent = {
      id: agentId,
      name: "Integration Agent",
      kind: "windows",
      capabilities: ["coding"],
      availability: "online",
      lastHeartbeatAt: new Date().toISOString(),
      version: 0
    };
    expect((await store.upsertAgent(agent)).version).toBe(1);
    expect((await store.upsertAgent(agent)).version).toBe(2);

    const taskId = `${namespace}-approval`;
    taskIds.push(taskId);
    await store.createTask({
      id: taskId,
      description: "Verify durable approval and evidence storage",
      priority: 4,
      requiredCapabilities: ["verification"]
    });
    const approval = await store.createApproval(taskId, "Proceed?", "Integration test");
    expect((await store.decideApproval(approval.id, "approved")).status).toBe("approved");
    await expect(store.decideApproval(approval.id, "rejected")).rejects.toThrow("approval_already_decided");
    await store.addEvidence(taskId, { kind: "test", summary: "Neon integration passed" });
    expect(await store.hasEvidence(taskId)).toBe(true);
    expect((await store.sync(0)).events).toContainEqual(expect.objectContaining({
      taskId,
      type: "evidence_added",
      payload: expect.objectContaining({ summary: "Neon integration passed" })
    }));
  });

  it("atomically assigns Windows work to only one agent", async () => {
    const id = `${namespace}-claim`;
    const isolatedCapability = `${namespace}-claim-capability`;
    taskIds.push(id);
    const created = await store.createTask({
      id,
      description: "Implement the claimed dashboard task",
      priority: 5,
      requiredCapabilities: [isolatedCapability]
    });
    await store.queue(id, "windows", created.version);
    const claims = await Promise.all([
      store.claim(`${namespace}-agent-a`, [isolatedCapability]),
      store.claim(`${namespace}-agent-b`, [isolatedCapability])
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toEqual(expect.objectContaining({
      id,
      status: TaskStatus.IN_PROGRESS
    }));
  });
});

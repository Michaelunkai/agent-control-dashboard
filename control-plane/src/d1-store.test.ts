import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { TaskStatus, type Agent } from "@agent-control/protocol";
import { D1TaskStore } from "./d1-store.js";

let miniflare: Miniflare;
let store: D1TaskStore;

beforeAll(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-12",
    d1Databases: ["DB"]
  });
  const db = await miniflare.getD1Database("DB");
  const migration = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
  for (const statement of migration.split(";").map((item) => item.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
  store = new D1TaskStore(db);
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("D1TaskStore", () => {
  it("persists tasks, transitions, and incremental events", async () => {
    const created = await store.createTask({
      id: "d1-task-1",
      description: "Verify D1 persistence",
      priority: 4,
      requiredCapabilities: ["coding"]
    });
    const queued = await store.transition(created.id, TaskStatus.QUEUED, "test", 1);
    expect(queued.version).toBe(2);
    await expect(store.transition(created.id, TaskStatus.IN_PROGRESS, "stale", 1))
      .rejects.toThrow("version_conflict");
    const page = await store.sync(0);
    expect(page.tasks).toEqual([expect.objectContaining({ id: created.id, status: TaskStatus.QUEUED })]);
    expect(page.events).toHaveLength(2);
  });

  it("persists agents, approvals, and evidence", async () => {
    const agent: Agent = {
      id: "desktop-d1", name: "Windows Codex", kind: "windows",
      capabilities: ["coding"], availability: "online",
      lastHeartbeatAt: new Date().toISOString(), version: 0
    };
    expect((await store.upsertAgent(agent)).version).toBe(1);
    expect(await store.listAgents()).toEqual([expect.objectContaining({ id: agent.id })]);

    const task = await store.createTask({
      id: "approval-task", description: "Deploy a verified build",
      priority: 5, requiredCapabilities: ["coding"]
    });
    const approval = await store.createApproval(task.id, "Deploy?", "Production change");
    expect((await store.decideApproval(approval.id, "approved")).status).toBe("approved");
    await store.addEvidence(task.id, { kind: "test", summary: "Release tests passed" });
    expect(await store.hasEvidence(task.id)).toBe(true);
  });
});

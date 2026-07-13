import { createTaskTitle, TaskStatus, canTransition, type Agent } from "@agent-control/protocol";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  Approval, CreateTaskInput, Evidence, LifecycleEvent, LifecycleTask, ProgressUpdate, SyncPage, TaskStore
} from "./control-app.js";

interface TaskRow extends QueryResultRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  version: number;
  pinned_title: number;
  required_capabilities: string[];
  dependencies: string[];
  assigned_agent_id: string | null;
  progress_percent: number | null;
  current_step: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapTask(row: TaskRow): LifecycleTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    version: row.version,
    pinnedTitle: row.pinned_title === 1,
    requiredCapabilities: row.required_capabilities,
    dependencies: row.dependencies,
    assignedAgentId: row.assigned_agent_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    progressPercent: row.progress_percent,
    currentStep: row.current_step,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresTaskStore implements TaskStore {
  constructor(private readonly pool: Pool) {}

  async createTask(input: CreateTaskInput): Promise<LifecycleTask> {
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const manualTitle = input.title?.replace(/\s+/g, " ").trim();
    const task: LifecycleTask = {
      id,
      title: manualTitle || input.generatedTitle || createTaskTitle(input.description),
      description: input.description,
      status: TaskStatus.READY,
      priority: input.priority,
      version: 1,
      pinnedTitle: Boolean(manualTitle),
      requiredCapabilities: input.requiredCapabilities,
      dependencies: [],
      createdAt: now,
      updatedAt: now,
      progressPercent: null,
      currentStep: null,
      startedAt: null,
      completedAt: null
    };
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO tasks
         (id,title,description,status,priority,version,pinned_title,required_capabilities,dependencies,
          progress_percent,current_step,started_at,completed_at,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15)`,
        [id, task.title, task.description, task.status, task.priority, 1, task.pinnedTitle ? 1 : 0,
          JSON.stringify(task.requiredCapabilities), "[]", null, null, null, null, now, now]
      );
      await client.query(
        `INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [crypto.randomUUID(), id, "task_created", now, `create:${id}`, JSON.stringify({ status: task.status })]
      );
    });
    return task;
  }

  async getTask(id: string): Promise<LifecycleTask | undefined> {
    const result = await this.pool.query<TaskRow>("SELECT * FROM tasks WHERE id=$1", [id]);
    return result.rows[0] ? mapTask(result.rows[0]) : undefined;
  }

  async updateDetails(id: string, description: string, title?: string, expectedVersion?: number): Promise<LifecycleTask> {
    return await inTransaction(this.pool, async (client) => {
      const result = await client.query<TaskRow>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [id]);
      if (!result.rows[0]) throw new Error("task_not_found");
      const current = mapTask(result.rows[0]);
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error("version_conflict");
      const now = new Date().toISOString();
      const version = current.version + 1;
      const nextTitle = current.pinnedTitle ? current.title : createTaskTitle(title ?? description);
      await client.query("UPDATE tasks SET title=$1,description=$2,version=$3,updated_at=$4 WHERE id=$5",
        [nextTitle, description, version, now, id]);
      await client.query(`INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [crypto.randomUUID(), id, "details_updated", now,
        `details:${id}:${version}`, JSON.stringify({ title: nextTitle, description })]);
      return { ...current, title: nextTitle, description, version, updatedAt: now };
    });
  }

  async updateProgress(id: string, update: ProgressUpdate, expectedVersion?: number): Promise<LifecycleTask> {
    return await inTransaction(this.pool, async (client) => {
      const result = await client.query<TaskRow>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [id]);
      if (!result.rows[0]) throw new Error("task_not_found");
      const current = mapTask(result.rows[0]);
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error("version_conflict");
      const now = new Date().toISOString();
      const version = current.version + 1;
      await client.query(
        "UPDATE tasks SET progress_percent=$1,current_step=$2,version=$3,updated_at=$4 WHERE id=$5",
        [update.progressPercent, update.currentStep, version, now, id]
      );
      await client.query(`INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [crypto.randomUUID(), id, "progress", now,
        `progress:${id}:${version}`, JSON.stringify(update)]);
      return { ...current, ...update, version, updatedAt: now };
    });
  }

  async transition(id: string, to: TaskStatus, reason: string, expectedVersion?: number): Promise<LifecycleTask> {
    return await inTransaction(this.pool, async (client) => {
      const result = await client.query<TaskRow>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [id]);
      const row = result.rows[0];
      if (!row) throw new Error("task_not_found");
      const current = mapTask(row);
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error("version_conflict");
      if (!canTransition(current.status, to)) throw new Error("invalid_status_transition");
      const now = new Date().toISOString();
      const version = current.version + 1;
      const startedAt = to === TaskStatus.IN_PROGRESS && !current.startedAt ? now : current.startedAt;
      const completedAt = to === TaskStatus.DONE ? now : current.completedAt;
      await client.query(
        "UPDATE tasks SET status=$1,version=$2,updated_at=$3,started_at=$4,completed_at=$5 WHERE id=$6",
        [to, version, now, startedAt, completedAt, id]
      );
      await client.query(
        `INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [crypto.randomUUID(), id, "status_changed", now, `status:${id}:${version}`,
          JSON.stringify({ from: current.status, to, reason })]
      );
      return { ...current, status: to, version, updatedAt: now, startedAt, completedAt };
    });
  }

  async queue(id: string, executor: "cloud" | "android" | "windows" | "future", expectedVersion?: number): Promise<LifecycleTask> {
    return await inTransaction(this.pool, async (client) => {
      const result = await client.query<TaskRow>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [id]);
      const row = result.rows[0];
      if (!row) throw new Error("task_not_found");
      const current = mapTask(row);
      if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error("version_conflict");
      if (!canTransition(current.status, TaskStatus.QUEUED)) throw new Error("invalid_status_transition");
      const now = new Date().toISOString();
      const version = current.version + 1;
      await client.query(
        "UPDATE tasks SET status=$1,preferred_executor=$2,version=$3,updated_at=$4 WHERE id=$5",
        [TaskStatus.QUEUED, executor, version, now, id]
      );
      await client.query(
        `INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [crypto.randomUUID(), id, "status_changed", now, `status:${id}:${version}`,
          JSON.stringify({ from: current.status, to: TaskStatus.QUEUED, reason: `dispatch:${executor}` })]
      );
      return { ...current, status: TaskStatus.QUEUED, version, updatedAt: now };
    });
  }

  async claim(agentId: string, capabilities: string[]): Promise<LifecycleTask | undefined> {
    return await inTransaction(this.pool, async (client) => {
      const resumed = await client.query<TaskRow>(
        "SELECT * FROM tasks WHERE assigned_agent_id=$1 AND status=$2 ORDER BY updated_at LIMIT 1 FOR UPDATE",
        [agentId, TaskStatus.IN_PROGRESS]
      );
      if (resumed.rows[0]) return mapTask(resumed.rows[0]);
      const result = await client.query<TaskRow>(
        `SELECT * FROM tasks
         WHERE status=$1 AND preferred_executor='windows'
           AND required_capabilities <@ $2::jsonb
         ORDER BY priority DESC, created_at
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [TaskStatus.QUEUED, JSON.stringify(capabilities)]
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const current = mapTask(row);
      const now = new Date().toISOString();
      const version = current.version + 1;
      await client.query(
        "UPDATE tasks SET status=$1,assigned_agent_id=$2,version=$3,updated_at=$4,started_at=$5 WHERE id=$6",
        [TaskStatus.IN_PROGRESS, agentId, version, now, current.startedAt ?? now, current.id]
      );
      await client.query(
        `INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [crypto.randomUUID(), current.id, "status_changed", now, `status:${current.id}:${version}`,
          JSON.stringify({ from: current.status, to: TaskStatus.IN_PROGRESS, reason: `claimed:${agentId}` })]
      );
      return {
        ...current, status: TaskStatus.IN_PROGRESS, assignedAgentId: agentId, version,
        updatedAt: now, startedAt: current.startedAt ?? now
      };
    });
  }

  async sync(cursor: number): Promise<SyncPage> {
    const eventResult = await this.pool.query<{
      sequence: string;
      id: string;
      task_id: string;
      type: LifecycleEvent["type"];
      occurred_at: string;
      idempotency_key: string;
      payload: Record<string, unknown>;
    }>(
      "SELECT sequence,id,task_id,type,occurred_at,idempotency_key,payload FROM task_events WHERE sequence>$1 ORDER BY sequence",
      [cursor]
    );
    const events: LifecycleEvent[] = eventResult.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      sequence: Number(row.sequence),
      occurredAt: row.occurred_at,
      idempotencyKey: row.idempotency_key,
      payload: row.payload
    }));
    const ids = [...new Set(events.map((event) => event.taskId))];
    const tasks = ids.length === 0
      ? []
      : (await this.pool.query<TaskRow>("SELECT * FROM tasks WHERE id=ANY($1::text[])", [ids])).rows.map(mapTask);
    return { cursor: events.at(-1)?.sequence ?? cursor, tasks, events };
  }

  async upsertAgent(agent: Agent): Promise<Agent> {
    const result = await this.pool.query<{ version: number }>(
      `INSERT INTO agents
       (id,name,kind,capabilities,availability,current_task_id,last_heartbeat_at,version)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,1)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,kind=EXCLUDED.kind,
       capabilities=EXCLUDED.capabilities,availability=EXCLUDED.availability,
       current_task_id=EXCLUDED.current_task_id,last_heartbeat_at=EXCLUDED.last_heartbeat_at,
       version=agents.version+1 RETURNING version`,
      [agent.id, agent.name, agent.kind, JSON.stringify(agent.capabilities), agent.availability,
        agent.currentTaskId ?? null, agent.lastHeartbeatAt]
    );
    return { ...agent, version: result.rows[0].version };
  }

  async listAgents(): Promise<Agent[]> {
    const result = await this.pool.query<{
      id: string;
      name: string;
      kind: Agent["kind"];
      capabilities: string[];
      availability: Agent["availability"];
      current_task_id: string | null;
      last_heartbeat_at: string;
      version: number;
    }>("SELECT * FROM agents ORDER BY name");
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      capabilities: row.capabilities,
      availability: row.availability,
      currentTaskId: row.current_task_id ?? undefined,
      lastHeartbeatAt: row.last_heartbeat_at,
      version: row.version
    }));
  }

  async addEvidence(taskId: string, evidence: Evidence): Promise<void> {
    if (!await this.getTask(taskId)) throw new Error("task_not_found");
    const now = new Date().toISOString();
    const evidenceId = crypto.randomUUID();
    await inTransaction(this.pool, async (client) => {
      await client.query(
        "INSERT INTO task_evidence (id,task_id,kind,summary,reference,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [evidenceId, taskId, evidence.kind, evidence.summary, evidence.reference ?? null, now]
      );
      await client.query(
        `INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [crypto.randomUUID(), taskId, "evidence_added", now, `evidence:${taskId}:${evidenceId}`,
          JSON.stringify({ kind: evidence.kind, summary: evidence.summary, reference: evidence.reference })]
      );
    });
  }

  async hasEvidence(taskId: string): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM task_evidence WHERE task_id=$1) AS exists",
      [taskId]
    );
    return result.rows[0]?.exists ?? false;
  }

  async createApproval(taskId: string, question: string, risk: string): Promise<Approval> {
    if (!await this.getTask(taskId)) throw new Error("task_not_found");
    const approval: Approval = {
      id: crypto.randomUUID(),
      taskId,
      question,
      risk,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    await this.pool.query(
      "INSERT INTO approvals (id,task_id,question,risk,status,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [approval.id, taskId, question, risk, approval.status, approval.createdAt]
    );
    return approval;
  }

  async listApprovals(taskId?: string): Promise<Approval[]> {
    const result = taskId
      ? await this.pool.query("SELECT * FROM approvals WHERE task_id=$1 ORDER BY created_at DESC", [taskId])
      : await this.pool.query("SELECT * FROM approvals ORDER BY created_at DESC");
    return result.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      question: row.question,
      risk: row.risk,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.decided_at ?? undefined
    }));
  }

  async decideApproval(id: string, decision: "approved" | "rejected"): Promise<Approval> {
    const decidedAt = new Date().toISOString();
    const result = await this.pool.query(
      `UPDATE approvals SET status=$1,decided_at=$2
       WHERE id=$3 AND status='pending'
       RETURNING id,task_id,question,risk,status,created_at,decided_at`,
      [decision, decidedAt, id]
    );
    const row = result.rows[0];
    if (!row) {
      const existing = await this.pool.query<{ status: Approval["status"] }>("SELECT status FROM approvals WHERE id=$1", [id]);
      if (existing.rowCount === 0) throw new Error("approval_not_found");
      throw new Error("approval_already_decided");
    }
    return {
      id: row.id,
      taskId: row.task_id,
      question: row.question,
      risk: row.risk,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.decided_at
    };
  }
}

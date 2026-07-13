import { createTaskTitle, TaskStatus, type Agent, type Task, type TaskEvent } from "@agent-control/protocol";
import type { Approval, Evidence, SyncPage, TaskStore } from "./control-app.js";

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  version: number;
  pinned_title: number;
  required_capabilities: string;
  dependencies: string;
  assigned_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    version: row.version,
    pinnedTitle: row.pinned_title === 1,
    requiredCapabilities: JSON.parse(row.required_capabilities) as string[],
    dependencies: JSON.parse(row.dependencies) as string[],
    assignedAgentId: row.assigned_agent_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class D1TaskStore implements TaskStore {
  constructor(private readonly db: D1Database) {}

  async createTask(input: Pick<Task, "description" | "priority" | "requiredCapabilities"> & { id?: string }): Promise<Task> {
    const id = input.id ?? crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const task: Task = {
      id,
      title: createTaskTitle(input.description),
      description: input.description,
      status: TaskStatus.READY,
      priority: input.priority,
      version: 1,
      pinnedTitle: false,
      requiredCapabilities: input.requiredCapabilities,
      dependencies: [],
      createdAt: now,
      updatedAt: now
    };
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO tasks
         (id,title,description,status,priority,version,pinned_title,required_capabilities,dependencies,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(id, task.title, task.description, task.status, task.priority, 1, 0,
        JSON.stringify(task.requiredCapabilities), "[]", now, now),
      this.db.prepare(
        `INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
         VALUES (?,?,?,?,?,?)`
      ).bind(eventId, id, "task_created", now, `create:${id}`, JSON.stringify({ status: task.status }))
    ]);
    return task;
  }

  async getTask(id: string): Promise<Task | undefined> {
    const row = await this.db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>();
    return row ? mapTask(row) : undefined;
  }

  async transition(id: string, to: TaskStatus, reason: string, expectedVersion?: number): Promise<Task> {
    const current = await this.getTask(id);
    if (!current) throw new Error("task_not_found");
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error("version_conflict");
    const { canTransition } = await import("@agent-control/protocol");
    if (!canTransition(current.status, to)) throw new Error("invalid_status_transition");
    const now = new Date().toISOString();
    const version = current.version + 1;
    await this.db.batch([
      this.db.prepare("UPDATE tasks SET status=?, version=?, updated_at=? WHERE id=? AND version=?")
        .bind(to, version, now, id, current.version),
      this.db.prepare(
        `INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
         VALUES (?,?,?,?,?,?)`
      ).bind(crypto.randomUUID(), id, "status_changed", now, `status:${id}:${version}`,
        JSON.stringify({ from: current.status, to, reason }))
    ]);
    return { ...current, status: to, version, updatedAt: now };
  }

  async queue(id: string, executor: "cloud" | "android" | "windows" | "future", expectedVersion?: number): Promise<Task> {
    const task = await this.transition(id, TaskStatus.QUEUED, `dispatch:${executor}`, expectedVersion);
    await this.db.prepare("UPDATE tasks SET preferred_executor=? WHERE id=?").bind(executor, id).run();
    return task;
  }

  async claim(agentId: string, capabilities: string[]): Promise<Task | undefined> {
    const resumed = await this.db.prepare(
      "SELECT * FROM tasks WHERE assigned_agent_id=? AND status=? ORDER BY updated_at LIMIT 1"
    ).bind(agentId, TaskStatus.IN_PROGRESS).first<TaskRow>();
    if (resumed) return mapTask(resumed);
    const rows = await this.db.prepare(
      "SELECT * FROM tasks WHERE status=? AND preferred_executor='windows' ORDER BY priority DESC,created_at"
    ).bind(TaskStatus.QUEUED).all<TaskRow>();
    const row = rows.results.find((candidate) =>
      (JSON.parse(candidate.required_capabilities) as string[]).every((item) => capabilities.includes(item))
    );
    if (!row) return undefined;
    const current = mapTask(row);
    const now = new Date().toISOString();
    const version = current.version + 1;
    const results = await this.db.batch([
      this.db.prepare(
        "UPDATE tasks SET status=?,assigned_agent_id=?,version=?,updated_at=? WHERE id=? AND status=? AND version=?"
      ).bind(TaskStatus.IN_PROGRESS, agentId, version, now, current.id, TaskStatus.QUEUED, current.version),
      this.db.prepare(
        `INSERT INTO task_events (id,task_id,type,occurred_at,idempotency_key,payload)
         SELECT ?,?,?,?,?,? WHERE changes()=1`
      ).bind(
        crypto.randomUUID(),
        current.id,
        "status_changed",
        now,
        `status:${current.id}:${version}`,
        JSON.stringify({
          from: current.status,
          to: TaskStatus.IN_PROGRESS,
          reason: `claimed:${agentId}`
        })
      )
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return undefined;
    return {
      ...current,
      status: TaskStatus.IN_PROGRESS,
      version,
      updatedAt: now,
      assignedAgentId: agentId
    };
  }

  async sync(cursor: number): Promise<SyncPage> {
    const eventResult = await this.db.prepare(
      "SELECT sequence,id,task_id,type,occurred_at,idempotency_key,payload FROM task_events WHERE sequence > ? ORDER BY sequence"
    ).bind(cursor).all<{
      sequence: number; id: string; task_id: string; type: TaskEvent["type"];
      occurred_at: string; idempotency_key: string; payload: string;
    }>();
    const events: TaskEvent[] = eventResult.results.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      sequence: row.sequence,
      occurredAt: row.occurred_at,
      idempotencyKey: row.idempotency_key,
      payload: JSON.parse(row.payload) as Record<string, unknown>
    }));
    const ids = [...new Set(events.map((event) => event.taskId))];
    const tasks = ids.length === 0
      ? []
      : (await this.db.prepare(`SELECT * FROM tasks WHERE id IN (${ids.map(() => "?").join(",")})`)
        .bind(...ids).all<TaskRow>()).results.map(mapTask);
    return { cursor: events.at(-1)?.sequence ?? cursor, tasks, events };
  }

  async upsertAgent(agent: Agent): Promise<Agent> {
    const current = await this.db.prepare("SELECT version FROM agents WHERE id=?").bind(agent.id)
      .first<{ version: number }>();
    const changed = { ...agent, version: (current?.version ?? 0) + 1 };
    await this.db.prepare(`INSERT INTO agents
      (id,name,kind,capabilities,availability,current_task_id,last_heartbeat_at,version)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,
      capabilities=excluded.capabilities,availability=excluded.availability,
      current_task_id=excluded.current_task_id,last_heartbeat_at=excluded.last_heartbeat_at,
      version=excluded.version`)
      .bind(changed.id, changed.name, changed.kind, JSON.stringify(changed.capabilities),
        changed.availability, changed.currentTaskId ?? null, changed.lastHeartbeatAt, changed.version).run();
    return changed;
  }

  async listAgents(): Promise<Agent[]> {
    const result = await this.db.prepare("SELECT * FROM agents ORDER BY name").all<{
      id: string; name: string; kind: Agent["kind"]; capabilities: string;
      availability: Agent["availability"]; current_task_id: string | null;
      last_heartbeat_at: string; version: number;
    }>();
    return result.results.map((row) => ({
      id: row.id, name: row.name, kind: row.kind,
      capabilities: JSON.parse(row.capabilities) as string[],
      availability: row.availability, currentTaskId: row.current_task_id ?? undefined,
      lastHeartbeatAt: row.last_heartbeat_at, version: row.version
    }));
  }

  async addEvidence(taskId: string, evidence: Evidence): Promise<void> {
    if (!await this.getTask(taskId)) throw new Error("task_not_found");
    await this.db.prepare(
      "INSERT INTO task_evidence (id,task_id,kind,summary,reference,created_at) VALUES (?,?,?,?,?,?)"
    ).bind(crypto.randomUUID(), taskId, evidence.kind, evidence.summary,
      evidence.reference ?? null, new Date().toISOString()).run();
  }

  async hasEvidence(taskId: string): Promise<boolean> {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM task_evidence WHERE task_id=?")
      .bind(taskId).first<{ count: number }>();
    return (row?.count ?? 0) > 0;
  }

  async createApproval(taskId: string, question: string, risk: string): Promise<Approval> {
    if (!await this.getTask(taskId)) throw new Error("task_not_found");
    const approval: Approval = {
      id: crypto.randomUUID(), taskId, question, risk, status: "pending",
      createdAt: new Date().toISOString()
    };
    await this.db.prepare(
      "INSERT INTO approvals (id,task_id,question,risk,status,created_at) VALUES (?,?,?,?,?,?)"
    ).bind(approval.id, taskId, question, risk, approval.status, approval.createdAt).run();
    return approval;
  }

  async listApprovals(taskId?: string): Promise<Approval[]> {
    const query = taskId
      ? this.db.prepare("SELECT * FROM approvals WHERE task_id=? ORDER BY created_at DESC").bind(taskId)
      : this.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC");
    const result = await query.all<{
      id: string; task_id: string; question: string; risk: string;
      status: Approval["status"]; created_at: string; decided_at: string | null;
    }>();
    return result.results.map((row) => ({
      id: row.id, taskId: row.task_id, question: row.question, risk: row.risk,
      status: row.status, createdAt: row.created_at, decidedAt: row.decided_at ?? undefined
    }));
  }

  async decideApproval(id: string, decision: "approved" | "rejected"): Promise<Approval> {
    const row = await this.db.prepare("SELECT * FROM approvals WHERE id=?").bind(id).first<{
      id: string; task_id: string; question: string; risk: string;
      status: Approval["status"]; created_at: string; decided_at: string | null;
    }>();
    if (!row) throw new Error("approval_not_found");
    if (row.status !== "pending") throw new Error("approval_already_decided");
    const decidedAt = new Date().toISOString();
    await this.db.prepare("UPDATE approvals SET status=?,decided_at=? WHERE id=? AND status='pending'")
      .bind(decision, decidedAt, id).run();
    return {
      id: row.id, taskId: row.task_id, question: row.question, risk: row.risk,
      status: decision, createdAt: row.created_at, decidedAt
    };
  }
}

import { Hono } from "hono";
import { z } from "zod";
import {
  TaskStatus,
  canTransition,
  createTaskTitle,
  nextWaitingStatus,
  type Agent,
  type Availability,
  type ExecutorKind,
  type Task,
  type TaskEvent
} from "@agent-control/protocol";

export interface SyncPage {
  cursor: number;
  tasks: LifecycleTask[];
  events: LifecycleEvent[];
}

export type LifecycleTask = Task & {
  progressPercent?: number | null;
  currentStep?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type LifecycleEvent = Omit<TaskEvent, "type"> & {
  type: TaskEvent["type"] | "details_updated";
};

export interface CreateTaskInput extends Pick<Task, "description" | "priority" | "requiredCapabilities"> {
  id?: string;
  title?: string;
  generatedTitle?: string;
}

export interface ProgressUpdate {
  progressPercent: number | null;
  currentStep: string;
}

export interface TaskStore {
  createTask(input: CreateTaskInput): Promise<LifecycleTask>;
  getTask(id: string): Promise<LifecycleTask | undefined>;
  updateDetails(id: string, description: string, title?: string, expectedVersion?: number): Promise<LifecycleTask>;
  updateProgress(id: string, update: ProgressUpdate, expectedVersion?: number): Promise<LifecycleTask>;
  transition(id: string, to: TaskStatus, reason: string, expectedVersion?: number): Promise<LifecycleTask>;
  queue(id: string, executor: ExecutorKind, expectedVersion?: number): Promise<LifecycleTask>;
  claim(agentId: string, capabilities: string[]): Promise<LifecycleTask | undefined>;
  sync(cursor: number): Promise<SyncPage>;
  upsertAgent(agent: Agent): Promise<Agent>;
  listAgents(): Promise<Agent[]>;
  addEvidence(taskId: string, evidence: Evidence): Promise<void>;
  hasEvidence(taskId: string): Promise<boolean>;
  createApproval(taskId: string, question: string, risk: string): Promise<Approval>;
  listApprovals(taskId?: string): Promise<Approval[]>;
  decideApproval(id: string, decision: "approved" | "rejected"): Promise<Approval>;
}

export interface Evidence {
  kind: "test" | "artifact" | "inspection" | "log";
  summary: string;
  reference?: string;
}

export interface Approval {
  id: string;
  taskId: string;
  question: string;
  risk: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
}

export class InMemoryStore implements TaskStore {
  private readonly tasks = new Map<string, LifecycleTask>();
  private readonly events: LifecycleEvent[] = [];
  private sequence = 0;
  private readonly agents = new Map<string, Agent>();
  private readonly evidence = new Map<string, Evidence[]>();
  private readonly approvals = new Map<string, Approval>();
  private readonly executors = new Map<string, ExecutorKind>();

  async createTask(input: CreateTaskInput): Promise<LifecycleTask> {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const manualTitle = input.title?.replace(/\s+/g, " ").trim();
    const task: LifecycleTask = {
      id,
      title: manualTitle || input.generatedTitle || createTaskTitle(input.description),
      description: input.description,
      status: TaskStatus.READY,
      priority: input.priority,
      version: 1,
      createdAt: now,
      updatedAt: now,
      pinnedTitle: Boolean(manualTitle),
      requiredCapabilities: input.requiredCapabilities,
      dependencies: [],
      progressPercent: null,
      currentStep: null,
      startedAt: null,
      completedAt: null
    };
    this.tasks.set(id, task);
    this.events.push({
      id: crypto.randomUUID(),
      taskId: id,
      type: "task_created",
      sequence: ++this.sequence,
      occurredAt: now,
      idempotencyKey: `create:${id}`,
      payload: { status: task.status }
    });
    return task;
  }

  async getTask(id: string): Promise<LifecycleTask | undefined> {
    return this.tasks.get(id);
  }

  async updateDetails(id: string, description: string, title?: string, expectedVersion?: number): Promise<LifecycleTask> {
    const current = this.tasks.get(id);
    if (!current) throw new Error("task_not_found");
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error("version_conflict");
    const now = new Date().toISOString();
    const changed: LifecycleTask = {
      ...current,
      description,
      title: current.pinnedTitle ? current.title : createTaskTitle(title ?? description),
      version: current.version + 1,
      updatedAt: now
    };
    this.tasks.set(id, changed);
    this.events.push({
      id: crypto.randomUUID(), taskId: id, type: "details_updated", sequence: ++this.sequence,
      occurredAt: now, idempotencyKey: `details:${id}:${changed.version}`,
      payload: { title: changed.title, description: changed.description }
    });
    return changed;
  }

  async updateProgress(id: string, update: ProgressUpdate, expectedVersion?: number): Promise<LifecycleTask> {
    const current = this.tasks.get(id);
    if (!current) throw new Error("task_not_found");
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error("version_conflict");
    const now = new Date().toISOString();
    const changed: LifecycleTask = {
      ...current, ...update, version: current.version + 1, updatedAt: now
    };
    this.tasks.set(id, changed);
    this.events.push({
      id: crypto.randomUUID(), taskId: id, type: "progress", sequence: ++this.sequence,
      occurredAt: now, idempotencyKey: `progress:${id}:${changed.version}`, payload: { ...update }
    });
    return changed;
  }

  async transition(id: string, to: TaskStatus, reason: string, expectedVersion?: number): Promise<LifecycleTask> {
    const current = this.tasks.get(id);
    if (!current) throw new Error("task_not_found");
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new Error("version_conflict");
    if (!canTransition(current.status, to)) throw new Error("invalid_status_transition");
    const now = new Date().toISOString();
    const changed: LifecycleTask = {
      ...current,
      status: to,
      version: current.version + 1,
      updatedAt: now,
      startedAt: to === TaskStatus.IN_PROGRESS && !current.startedAt ? now : current.startedAt,
      completedAt: to === TaskStatus.DONE ? now : current.completedAt
    };
    this.tasks.set(id, changed);
    this.events.push({
      id: crypto.randomUUID(),
      taskId: id,
      type: "status_changed",
      sequence: ++this.sequence,
      occurredAt: now,
      idempotencyKey: `status:${id}:${changed.version}`,
      payload: { from: current.status, to, reason }
    });
    return changed;
  }

  async queue(id: string, executor: ExecutorKind, expectedVersion?: number): Promise<LifecycleTask> {
    const task = await this.transition(id, TaskStatus.QUEUED, `dispatch:${executor}`, expectedVersion);
    this.executors.set(id, executor);
    return task;
  }

  async claim(agentId: string, capabilities: string[]): Promise<LifecycleTask | undefined> {
    const resumed = [...this.tasks.values()].find(
      (task) => task.assignedAgentId === agentId && task.status === TaskStatus.IN_PROGRESS
    );
    if (resumed) return resumed;
    const task = [...this.tasks.values()]
      .filter((candidate) =>
        candidate.status === TaskStatus.QUEUED &&
        this.executors.get(candidate.id) === "windows" &&
        candidate.requiredCapabilities.every((capability) => capabilities.includes(capability))
      )
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))[0];
    if (!task) return undefined;
    const changed = await this.transition(task.id, TaskStatus.IN_PROGRESS, `claimed:${agentId}`, task.version);
    const assigned = { ...changed, assignedAgentId: agentId };
    this.tasks.set(task.id, assigned);
    return assigned;
  }

  async sync(cursor: number): Promise<SyncPage> {
    const events = this.events.slice(cursor);
    const changedIds = new Set(events.map((event) => event.taskId));
    return {
      cursor: this.events.length,
      tasks: [...this.tasks.values()].filter((task) => cursor === 0 || changedIds.has(task.id)),
      events
    };
  }

  async upsertAgent(agent: Agent): Promise<Agent> {
    const changed = { ...agent, version: (this.agents.get(agent.id)?.version ?? 0) + 1 };
    this.agents.set(agent.id, changed);
    return changed;
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()];
  }

  async addEvidence(taskId: string, evidence: Evidence): Promise<void> {
    if (!this.tasks.has(taskId)) throw new Error("task_not_found");
    this.evidence.set(taskId, [...(this.evidence.get(taskId) ?? []), evidence]);
    const now = new Date().toISOString();
    this.events.push({
      id: crypto.randomUUID(), taskId, type: "evidence_added", sequence: ++this.sequence,
      occurredAt: now, idempotencyKey: `evidence:${taskId}:${this.sequence}`,
      payload: { kind: evidence.kind, summary: evidence.summary, reference: evidence.reference }
    });
  }

  async hasEvidence(taskId: string): Promise<boolean> {
    return (this.evidence.get(taskId)?.length ?? 0) > 0;
  }

  async createApproval(taskId: string, question: string, risk: string): Promise<Approval> {
    if (!this.tasks.has(taskId)) throw new Error("task_not_found");
    const approval = {
      id: crypto.randomUUID(), taskId, question, risk, status: "pending" as const,
      createdAt: new Date().toISOString()
    };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  async listApprovals(taskId?: string): Promise<Approval[]> {
    return [...this.approvals.values()].filter((item) => !taskId || item.taskId === taskId);
  }

  async decideApproval(id: string, decision: "approved" | "rejected"): Promise<Approval> {
    const current = this.approvals.get(id);
    if (!current) throw new Error("approval_not_found");
    if (current.status !== "pending") throw new Error("approval_already_decided");
    const changed = { ...current, status: decision, decidedAt: new Date().toISOString() };
    this.approvals.set(id, changed);
    return changed;
  }
}

const createTaskSchema = z.object({
  clientId: z.string().trim().min(8).max(100).optional(),
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(3).max(20_000),
  priority: z.number().int().min(1).max(5).default(3),
  requiredCapabilities: z.array(z.string().trim().min(1)).max(20).default(["coding"])
});

const dispatchSchema = z.object({
  preferredExecutor: z.enum(["cloud", "android", "windows", "future"]),
  expectedVersion: z.number().int().positive().optional(),
  availability: z.object({
    network: z.boolean(),
    pc: z.boolean(),
    android: z.boolean(),
    quota: z.boolean()
  }).optional()
});

const codexHookSchema = z.object({
  id: z.string().min(1).max(200),
  eventName: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(150),
  taskId: z.string().min(1).max(200).optional(),
  occurredAt: z.string().min(1).max(100),
  payload: z.record(z.unknown())
});
const agentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["cloud", "android", "windows", "future"]),
  capabilities: z.array(z.string().trim().min(1)).max(50),
  availability: z.enum(["online", "offline", "busy", "quota_limited"])
});
const heartbeatSchema = z.object({
  availability: z.enum(["online", "offline", "busy", "quota_limited"]),
  currentTaskId: z.string().max(200).optional()
});
const claimSchema = z.object({
  capabilities: z.array(z.string().trim().min(1)).min(1).max(50)
});
const evidenceSchema = z.object({
  kind: z.enum(["test", "artifact", "inspection", "log"]),
  summary: z.string().trim().min(3).max(2_000),
  reference: z.string().trim().max(2_000).optional()
});
const transitionSchema = z.object({
  to: z.nativeEnum(TaskStatus),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive()
});
const cancelSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500).default("owner_cancelled")
});
const approvalSchema = z.object({
  question: z.string().trim().min(3).max(2_000),
  risk: z.string().trim().min(3).max(2_000)
});
const decisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) });
const detailsSchema = z.object({
  description: z.string().trim().min(3).max(20_000),
  title: z.string().trim().min(1).max(80).optional(),
  expectedVersion: z.number().int().positive().optional()
});
const progressSchema = z.object({
  progressPercent: z.number().int().min(0).max(100).nullable(),
  currentStep: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive().optional()
});

function workspaceTitle(cwd: string): string {
  const folder = cwd.trim().replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1);
  const readable = folder
    ?.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return `Codex session - ${readable || "Unknown workspace"}`;
}

function toolActivity(payload: Record<string, unknown>): string {
  const tool = String(payload.tool_name ?? payload.toolName ?? "tool")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `Used ${tool || "tool"}`;
}

async function tokensMatch(authorization: string | undefined, ownerToken: string): Promise<boolean> {
  if (!authorization?.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(authorization.slice(7))),
    crypto.subtle.digest("SHA-256", encoder.encode(ownerToken))
  ]);
  const left = new Uint8Array(provided);
  const right = new Uint8Array(expected);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function createApp(store: TaskStore, ownerToken?: string): Hono {
  const app = new Hono();
  app.use("/v1/*", async (context, next) => {
    if (!ownerToken) return context.json({ error: "owner_token_not_configured" }, 503);
    const authorization = context.req.header("authorization");
    if (!await tokensMatch(authorization, ownerToken)) {
      return context.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
  app.onError((error, context) => {
    if (error.message === "task_not_found") return context.json({ error: error.message }, 404);
    if (error.message === "invalid_status_transition") return context.json({ error: error.message }, 409);
    if (error.message === "version_conflict") return context.json({ error: error.message }, 409);
    if (error.message === "approval_not_found") return context.json({ error: error.message }, 404);
    if (error.message === "approval_already_decided") return context.json({ error: error.message }, 409);
    return context.json({ error: "internal_error" }, 500);
  });
  app.get("/health", (context) => context.json({ status: "ok" }));
  app.get("/v1/sync", async (context) => {
    const cursor = Math.max(0, Number.parseInt(context.req.query("cursor") ?? "0", 10) || 0);
    return context.json(await store.sync(cursor));
  });
  app.get("/v1/agents", async (context) => context.json({ agents: await store.listAgents() }));
  app.put("/v1/agents/:id", async (context) => {
    const parsed = agentSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_agent" }, 400);
    return context.json(await store.upsertAgent({
      id: context.req.param("id"), ...parsed.data,
      lastHeartbeatAt: new Date().toISOString(), version: 0
    }));
  });
  app.post("/v1/agents/:id/heartbeat", async (context) => {
    const parsed = heartbeatSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_heartbeat" }, 400);
    const current = (await store.listAgents()).find((agent) => agent.id === context.req.param("id"));
    if (!current) return context.json({ error: "agent_not_found" }, 404);
    return context.json(await store.upsertAgent({
      ...current,
      ...parsed.data,
      currentTaskId: parsed.data.currentTaskId,
      lastHeartbeatAt: new Date().toISOString()
    }));
  });
  app.post("/v1/agents/:id/claim", async (context) => {
    const parsed = claimSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_claim" }, 400);
    const task = await store.claim(context.req.param("id"), parsed.data.capabilities);
    return task ? context.json({ task }) : context.body(null, 204);
  });
  app.post("/v1/tasks", async (context) => {
    const parsed = createTaskSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_task", details: parsed.error.flatten() }, 400);
    if (parsed.data.clientId) {
      const existing = await store.getTask(parsed.data.clientId);
      if (existing) return context.json(existing, 200);
    }
    return context.json(await store.createTask({
      id: parsed.data.clientId,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      requiredCapabilities: parsed.data.requiredCapabilities
    }), 201);
  });
  app.post("/v1/tasks/:id/details", async (context) => {
    const parsed = detailsSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_details" }, 400);
    return context.json(await store.updateDetails(
      context.req.param("id"), parsed.data.description, parsed.data.title, parsed.data.expectedVersion
    ));
  });
  app.post("/v1/tasks/:id/progress", async (context) => {
    const parsed = progressSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_progress" }, 400);
    return context.json(await store.updateProgress(context.req.param("id"), {
      progressPercent: parsed.data.progressPercent,
      currentStep: parsed.data.currentStep
    }, parsed.data.expectedVersion));
  });
  app.post("/v1/tasks/:id/dispatch", async (context) => {
    const parsed = dispatchSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_dispatch", details: parsed.error.flatten() }, 400);
    const task = await store.getTask(context.req.param("id"));
    if (!task) return context.json({ error: "task_not_found" }, 404);
    const agents = await store.listAgents();
    const fresh = agents.filter((agent) =>
      Date.now() - Date.parse(agent.lastHeartbeatAt) < 90_000 &&
      agent.availability !== "offline"
    );
    const availability: Availability = {
      network: true,
      pc: fresh.some((agent) => agent.kind === "windows"),
      android: fresh.some((agent) => agent.kind === "android"),
      quota: fresh.some((agent) => agent.kind === "cloud" && agent.availability !== "quota_limited")
    };
    const executor = parsed.data.preferredExecutor as ExecutorKind;
    const waiting = nextWaitingStatus(availability, executor);
    if (waiting) return context.json(await store.transition(
      task.id, waiting, "executor_unavailable", parsed.data.expectedVersion
    ));
    return context.json(await store.queue(task.id, executor, parsed.data.expectedVersion));
  });
  app.post("/v1/tasks/:id/transition", async (context) => {
    const parsed = transitionSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_transition" }, 400);
    return context.json(await store.transition(
      context.req.param("id"), parsed.data.to, parsed.data.reason, parsed.data.expectedVersion
    ));
  });
  app.post("/v1/tasks/:id/cancel", async (context) => {
    const parsed = cancelSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_cancel" }, 400);
    return context.json(await store.transition(
      context.req.param("id"), TaskStatus.CANCELLED, parsed.data.reason, parsed.data.expectedVersion
    ));
  });
  app.get("/v1/approvals", async (context) =>
    context.json({ approvals: await store.listApprovals(context.req.query("taskId")) }));
  app.post("/v1/tasks/:id/approval", async (context) => {
    const parsed = approvalSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_approval" }, 400);
    const task = await store.getTask(context.req.param("id"));
    if (!task) return context.json({ error: "task_not_found" }, 404);
    const approval = await store.createApproval(task.id, parsed.data.question, parsed.data.risk);
    const changed = await store.transition(task.id, TaskStatus.WAITING_APPROVAL, "approval_requested");
    return context.json({ approval, task: changed }, 201);
  });
  app.post("/v1/approvals/:id/decision", async (context) => {
    const parsed = decisionSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_decision" }, 400);
    const approval = await store.decideApproval(context.req.param("id"), parsed.data.decision);
    const task = await store.getTask(approval.taskId);
    if (!task) return context.json({ error: "task_not_found" }, 404);
    const target = parsed.data.decision === "approved" ? TaskStatus.QUEUED : TaskStatus.CANCELLED;
    return context.json({
      approval,
      task: await store.transition(task.id, target, `approval_${parsed.data.decision}`)
    });
  });
  app.post("/v1/tasks/:id/evidence", async (context) => {
    const parsed = evidenceSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_evidence" }, 400);
    await store.addEvidence(context.req.param("id"), parsed.data);
    return context.json({ accepted: true }, 201);
  });
  app.post("/v1/tasks/:id/complete", async (context) => {
    const task = await store.getTask(context.req.param("id"));
    if (!task) return context.json({ error: "task_not_found" }, 404);
    if (task.status !== TaskStatus.VERIFYING && task.status !== TaskStatus.REVIEW) {
      return context.json({ error: "task_not_verifying" }, 409);
    }
    if (!await store.hasEvidence(task.id)) return context.json({ error: "evidence_required" }, 409);
    return context.json(await store.transition(task.id, TaskStatus.DONE, "evidence_verified"));
  });
  app.post("/v1/hooks/codex", async (context) => {
    const parsed = codexHookSchema.safeParse(await context.req.json());
    if (!parsed.success) return context.json({ error: "invalid_hook", details: parsed.error.flatten() }, 400);
    const input = parsed.data;
    const taskId = input.taskId ?? `codex:${input.sessionId}`;
    let task = await store.getTask(taskId);
    if (!task) {
      const prompt = typeof input.payload.prompt === "string" ? input.payload.prompt : "";
      const cwd = typeof input.payload.cwd === "string" ? input.payload.cwd : "";
      const description = prompt.trim() || `Codex session${cwd ? ` in ${cwd}` : ""}`;
      task = await store.createTask({
        id: taskId,
        generatedTitle: prompt.trim() ? undefined : workspaceTitle(cwd),
        description,
        priority: 3,
        requiredCapabilities: ["coding", "codex"]
      });
    }
    if ([TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(task.status)) {
      return context.json(task);
    }
    const activeEvent = input.eventName === "SessionStart" ||
      input.eventName === "UserPromptSubmit" || input.eventName === "PostToolUse";
    const completionEvent = input.eventName === "Stop" || input.eventName === "SessionEnd";
    if (activeEvent || completionEvent) {
      if (task.status === TaskStatus.READY) task = await store.transition(task.id, TaskStatus.QUEUED, "codex_hook");
      if (task.status === TaskStatus.QUEUED) task = await store.transition(task.id, TaskStatus.IN_PROGRESS, "codex_active");
    }
    if (input.eventName === "SessionStart") {
      task = await store.updateProgress(task.id, { progressPercent: null, currentStep: "Session started" });
    }
    if (input.eventName === "UserPromptSubmit") {
      const prompt = typeof input.payload.prompt === "string" ? input.payload.prompt.trim() : "";
      if (prompt) task = await store.updateDetails(task.id, prompt, prompt);
      task = await store.updateProgress(task.id, { progressPercent: null, currentStep: "Working on request" });
    }
    if (input.eventName === "PostToolUse") {
      task = await store.updateProgress(task.id, {
        progressPercent: null,
        currentStep: toolActivity(input.payload)
      });
    }
    if (completionEvent && task.status === TaskStatus.IN_PROGRESS) {
      task = await store.updateProgress(task.id, { progressPercent: null, currentStep: "Verifying results" });
      task = await store.transition(task.id, TaskStatus.VERIFYING, "codex_stop");
    }
    if (completionEvent && task.status === TaskStatus.VERIFYING) {
      task = await store.updateProgress(task.id, { progressPercent: 100, currentStep: "Completed" });
      task = await store.transition(task.id, TaskStatus.DONE, "codex_completed");
    }
    return context.json(task);
  });
  return app;
}

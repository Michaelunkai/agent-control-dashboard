export enum TaskStatus {
  INBOX = "INBOX",
  READY = "READY",
  QUEUED = "QUEUED",
  DISPATCHING = "DISPATCHING",
  IN_PROGRESS = "IN_PROGRESS",
  WAITING_NETWORK = "WAITING_NETWORK",
  WAITING_PC = "WAITING_PC",
  WAITING_ANDROID = "WAITING_ANDROID",
  WAITING_QUOTA = "WAITING_QUOTA",
  WAITING_APPROVAL = "WAITING_APPROVAL",
  BLOCKED = "BLOCKED",
  VERIFYING = "VERIFYING",
  REVIEW = "REVIEW",
  DONE = "DONE",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED"
}

export type ExecutorKind = "cloud" | "android" | "windows" | "future";

export interface Availability {
  network: boolean;
  pc: boolean;
  android: boolean;
  quota: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  pinnedTitle: boolean;
  requiredCapabilities: string[];
  dependencies: string[];
  assignedAgentId?: string;
}

export type TaskEventType =
  | "task_created"
  | "status_changed"
  | "progress"
  | "evidence_added"
  | "title_changed"
  | "agent_assigned";

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  sequence: number;
  occurredAt: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  kind: ExecutorKind;
  capabilities: string[];
  availability: "online" | "offline" | "busy" | "quota_limited";
  currentTaskId?: string;
  lastHeartbeatAt: string;
  version: number;
}

const transitions: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  [TaskStatus.INBOX]: new Set([TaskStatus.READY, TaskStatus.CANCELLED]),
  [TaskStatus.READY]: new Set([
    TaskStatus.QUEUED,
    TaskStatus.WAITING_NETWORK,
    TaskStatus.WAITING_PC,
    TaskStatus.WAITING_ANDROID,
    TaskStatus.WAITING_QUOTA,
    TaskStatus.BLOCKED,
    TaskStatus.CANCELLED
  ]),
  [TaskStatus.QUEUED]: new Set([
    TaskStatus.DISPATCHING,
    TaskStatus.IN_PROGRESS,
    TaskStatus.WAITING_NETWORK,
    TaskStatus.WAITING_PC,
    TaskStatus.WAITING_ANDROID,
    TaskStatus.WAITING_QUOTA,
    TaskStatus.CANCELLED
  ]),
  [TaskStatus.DISPATCHING]: new Set([
    TaskStatus.IN_PROGRESS,
    TaskStatus.WAITING_NETWORK,
    TaskStatus.WAITING_PC,
    TaskStatus.WAITING_ANDROID,
    TaskStatus.WAITING_QUOTA,
    TaskStatus.FAILED,
    TaskStatus.CANCELLED
  ]),
  [TaskStatus.IN_PROGRESS]: new Set([
    TaskStatus.VERIFYING,
    TaskStatus.WAITING_NETWORK,
    TaskStatus.WAITING_PC,
    TaskStatus.WAITING_ANDROID,
    TaskStatus.WAITING_QUOTA,
    TaskStatus.WAITING_APPROVAL,
    TaskStatus.BLOCKED,
    TaskStatus.FAILED,
    TaskStatus.CANCELLED
  ]),
  [TaskStatus.WAITING_NETWORK]: new Set([TaskStatus.QUEUED, TaskStatus.CANCELLED]),
  [TaskStatus.WAITING_PC]: new Set([TaskStatus.QUEUED, TaskStatus.CANCELLED]),
  [TaskStatus.WAITING_ANDROID]: new Set([TaskStatus.QUEUED, TaskStatus.CANCELLED]),
  [TaskStatus.WAITING_QUOTA]: new Set([TaskStatus.QUEUED, TaskStatus.CANCELLED]),
  [TaskStatus.WAITING_APPROVAL]: new Set([TaskStatus.QUEUED, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED]),
  [TaskStatus.BLOCKED]: new Set([TaskStatus.READY, TaskStatus.QUEUED, TaskStatus.CANCELLED]),
  [TaskStatus.VERIFYING]: new Set([TaskStatus.REVIEW, TaskStatus.DONE, TaskStatus.IN_PROGRESS, TaskStatus.FAILED]),
  [TaskStatus.REVIEW]: new Set([TaskStatus.DONE, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED]),
  [TaskStatus.DONE]: new Set(),
  [TaskStatus.FAILED]: new Set([TaskStatus.QUEUED, TaskStatus.CANCELLED]),
  [TaskStatus.CANCELLED]: new Set()
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || transitions[from].has(to);
}

export function nextWaitingStatus(
  availability: Availability,
  executor: ExecutorKind = "cloud"
): TaskStatus | undefined {
  if (!availability.network) return TaskStatus.WAITING_NETWORK;
  if (executor === "cloud" && !availability.quota) return TaskStatus.WAITING_QUOTA;
  if (executor === "windows" && !availability.pc) return TaskStatus.WAITING_PC;
  if (executor === "android" && !availability.android) return TaskStatus.WAITING_ANDROID;
  return undefined;
}

export function reduceTaskEvent(task: Task, event: TaskEvent): Task {
  if (event.taskId !== task.id) throw new Error("event_task_mismatch");
  if (event.sequence <= task.version) return task;
  if (event.sequence !== task.version + 1) throw new Error("event_sequence_gap");

  if (event.type === "status_changed") {
    const from = event.payload.from as TaskStatus;
    const to = event.payload.to as TaskStatus;
    if (from !== task.status || !canTransition(from, to)) throw new Error("invalid_status_transition");
    return { ...task, status: to, version: event.sequence, updatedAt: event.occurredAt };
  }
  if (event.type === "title_changed" && !task.pinnedTitle) {
    return {
      ...task,
      title: createTaskTitle(String(event.payload.title ?? task.title)),
      version: event.sequence,
      updatedAt: event.occurredAt
    };
  }
  if (event.type === "agent_assigned") {
    return {
      ...task,
      assignedAgentId: String(event.payload.agentId),
      version: event.sequence,
      updatedAt: event.occurredAt
    };
  }
  return { ...task, version: event.sequence, updatedAt: event.occurredAt };
}

export function createTaskTitle(description: string): string {
  const cleaned = description
    .replace(/^(please|could you|can you|i want you to|i need you to)\s+/i, "")
    .replace(/\b(immediately|please|for me)\b/gi, "")
    .replace(/\bthe\s+(?=(android|windows|dashboard|login)\b)/gi, "")
    .replace(/\bapplication\b/gi, "application")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  if (!cleaned) return "Untitled task";
  const titled = cleaned[0].toUpperCase() + cleaned.slice(1);
  if (titled.length <= 80) return titled;
  const shortened = titled.slice(0, 77).replace(/\s+\S*$/, "").trimEnd();
  return `${shortened}...`;
}

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
  progressPercent?: number | null;
  currentStep?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export type TaskEventType =
  | "task_created"
  | "status_changed"
  | "progress"
  | "evidence_added"
  | "title_changed"
  | "details_updated"
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
  if (event.type === "progress") {
    const progress = event.payload.progressPercent;
    return {
      ...task,
      progressPercent: progress == null ? null : Math.max(0, Math.min(100, Number(progress))),
      currentStep: event.payload.currentStep == null ? task.currentStep : String(event.payload.currentStep),
      version: event.sequence,
      updatedAt: event.occurredAt
    };
  }
  if (event.type === "details_updated") {
    return {
      ...task,
      title: event.payload.title == null ? task.title : String(event.payload.title),
      description: event.payload.description == null ? task.description : String(event.payload.description),
      pinnedTitle: event.payload.pinnedTitle == null ? task.pinnedTitle : Boolean(event.payload.pinnedTitle),
      requiredCapabilities: Array.isArray(event.payload.requiredCapabilities)
        ? event.payload.requiredCapabilities.map(String)
        : task.requiredCapabilities,
      dependencies: Array.isArray(event.payload.dependencies)
        ? event.payload.dependencies.map(String)
        : task.dependencies,
      version: event.sequence,
      updatedAt: event.occurredAt
    };
  }
  return { ...task, version: event.sequence, updatedAt: event.occurredAt };
}

export function createTaskTitle(description: string): string {
  const cleaned = collapseAdjacentRepetitions(description)
    .replace(/^(?:(?:please|could you|can you|i want you to|i need you to)\s+)+/i, "")
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

function collapseAdjacentRepetitions(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < words.length && !changed; index += 1) {
      const maximum = Math.min(16, Math.floor((words.length - index) / 2));
      for (let length = 1; length <= maximum; length += 1) {
        const first = words.slice(index, index + length).join(" ").toLowerCase();
        const second = words.slice(index + length, index + length * 2).join(" ").toLowerCase();
        if (first === second) {
          words.splice(index + length, length);
          changed = true;
          break;
        }
      }
    }
  }
  return words.join(" ");
}

export function createWorkspaceTitle(workspace?: string): string {
  const normalized = workspace?.trim().replace(/[\\/]+$/, "");
  const folder = normalized?.split(/[\\/]/).filter(Boolean).at(-1);
  if (!folder) return "Codex session - Unknown workspace";
  const readable = folder
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return `Codex session - ${readable || "Unknown workspace"}`;
}

export function resolveTaskTitle(
  description: string,
  manualTitle?: string | null
): { title: string; pinnedTitle: boolean } {
  const supplied = manualTitle?.replace(/\s+/g, " ").trim();
  if (!supplied) return { title: createTaskTitle(description), pinnedTitle: false };
  const title = supplied.length <= 80
    ? supplied
    : `${supplied.slice(0, 77).replace(/\s+\S*$/, "").trimEnd()}...`;
  return { title, pinnedTitle: true };
}

export function validateProgressPercent(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("invalid_progress_percent");
  }
  return value;
}

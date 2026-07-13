CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL,
  version INTEGER NOT NULL,
  pinned_title INTEGER NOT NULL DEFAULT 0,
  required_capabilities TEXT NOT NULL,
  dependencies TEXT NOT NULL,
  assigned_agent_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE task_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE INDEX idx_task_events_task_sequence ON task_events(task_id, sequence);
CREATE INDEX idx_tasks_status_updated ON tasks(status, updated_at);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  availability TEXT NOT NULL,
  current_task_id TEXT,
  last_heartbeat_at TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE task_evidence (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  reference TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE INDEX idx_task_evidence_task_id ON task_evidence(task_id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  question TEXT NOT NULL,
  risk TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);

CREATE INDEX idx_approvals_task_status ON approvals(task_id, status);

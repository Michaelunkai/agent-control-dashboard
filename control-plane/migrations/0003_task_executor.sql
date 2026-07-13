ALTER TABLE tasks ADD COLUMN IF NOT EXISTS preferred_executor TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress_percent INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS current_step TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_executor_queue
  ON tasks(preferred_executor, status, priority DESC, created_at);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS preferred_executor TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_executor_queue
  ON tasks(preferred_executor, status, priority DESC, created_at);

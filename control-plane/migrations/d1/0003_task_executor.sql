ALTER TABLE tasks ADD COLUMN preferred_executor TEXT;
CREATE INDEX idx_tasks_executor_queue
  ON tasks(preferred_executor, status, priority DESC, created_at);

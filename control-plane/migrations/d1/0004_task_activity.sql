ALTER TABLE tasks ADD COLUMN progress_percent INTEGER
  CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100);
ALTER TABLE tasks ADD COLUMN current_step TEXT;
ALTER TABLE tasks ADD COLUMN started_at TEXT;
ALTER TABLE tasks ADD COLUMN completed_at TEXT;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress_percent INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS current_step TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TEXT;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_progress_percent_range;
ALTER TABLE tasks ADD CONSTRAINT tasks_progress_percent_range
  CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100);

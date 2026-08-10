ALTER TABLE test_drive_requests
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS test_drive_assignee_idx
  ON test_drive_requests (assigned_to, requested_date, requested_time);

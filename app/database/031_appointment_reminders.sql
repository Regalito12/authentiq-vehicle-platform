ALTER TABLE test_drive_requests
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS test_drive_reminders_idx
  ON test_drive_requests (status, requested_date, requested_time)
  WHERE status IN ('pending', 'confirmed');

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS appointment_capacity SMALLINT NOT NULL DEFAULT 1
    CHECK (appointment_capacity BETWEEN 1 AND 20);

ALTER TABLE test_drive_requests
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS test_drive_date_status_idx
  ON test_drive_requests (requested_date, requested_time, status);

CREATE INDEX IF NOT EXISTS test_drive_lead_idx
  ON test_drive_requests (lead_id);

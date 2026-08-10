ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS appointment_timezone VARCHAR(60) NOT NULL DEFAULT 'America/Santo_Domingo';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS appointment_start TIME NOT NULL DEFAULT '09:00';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS appointment_end TIME NOT NULL DEFAULT '18:00';
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS appointment_duration_minutes SMALLINT NOT NULL DEFAULT 60 CHECK (appointment_duration_minutes BETWEEN 15 AND 240);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS appointment_min_notice_hours SMALLINT NOT NULL DEFAULT 2 CHECK (appointment_min_notice_hours BETWEEN 0 AND 720);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS appointment_max_days_ahead SMALLINT NOT NULL DEFAULT 30 CHECK (appointment_max_days_ahead BETWEEN 1 AND 365);
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS appointment_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6]::SMALLINT[];

CREATE UNIQUE INDEX IF NOT EXISTS test_drive_vehicle_slot_unique_idx
  ON test_drive_requests (vehicle_id, requested_date, requested_time)
  WHERE status IN ('pending', 'confirmed');

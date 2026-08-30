-- Reconciliación idempotente: algunas bases históricas no recibieron 044_google_calendar.sql.
-- No edita la migración histórica; deja la columna y el índice listos para sincronización.
ALTER TABLE test_drive_requests ADD COLUMN IF NOT EXISTS google_event_id TEXT;
CREATE INDEX IF NOT EXISTS test_drive_google_event_idx ON test_drive_requests (organization_id, google_event_id) WHERE google_event_id IS NOT NULL;

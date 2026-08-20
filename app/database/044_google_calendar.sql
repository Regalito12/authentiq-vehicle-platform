-- OAuth de Google Calendar por dealer. El refresh token se guarda cifrado en
-- organization_integrations.config; nunca se devuelve al navegador.
ALTER TABLE test_drive_requests ADD COLUMN IF NOT EXISTS google_event_id TEXT;
CREATE INDEX IF NOT EXISTS test_drive_google_event_idx ON test_drive_requests (organization_id, google_event_id) WHERE google_event_id IS NOT NULL;

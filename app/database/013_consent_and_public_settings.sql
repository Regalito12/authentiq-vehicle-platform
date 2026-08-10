ALTER TABLE leads ADD COLUMN IF NOT EXISTS privacy_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS privacy_policy_version VARCHAR(40);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_source VARCHAR(40);

ALTER TABLE offers ADD COLUMN IF NOT EXISTS privacy_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMPTZ;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS privacy_policy_version VARCHAR(40);

ALTER TABLE test_drive_requests ADD COLUMN IF NOT EXISTS privacy_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE test_drive_requests ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMPTZ;
ALTER TABLE test_drive_requests ADD COLUMN IF NOT EXISTS privacy_policy_version VARCHAR(40);

CREATE INDEX IF NOT EXISTS leads_consent_audit_idx ON leads (privacy_consent, privacy_consent_at DESC);

-- Idempotency records for public form submissions.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public_request_idempotency (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route VARCHAR(80) NOT NULL,
  request_key VARCHAR(120) NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, route, request_key)
);

CREATE INDEX IF NOT EXISTS public_request_idempotency_expiry_idx
  ON public_request_idempotency (expires_at);

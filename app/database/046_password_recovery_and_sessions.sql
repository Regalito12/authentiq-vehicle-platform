-- Password recovery tokens and session revocation.
-- Safe to re-run.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customer_accounts
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type VARCHAR(20) NOT NULL,
  account_id UUID NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT password_reset_account_type_check CHECK (account_type IN ('admin', 'customer'))
);

CREATE INDEX IF NOT EXISTS password_reset_lookup_idx
  ON password_reset_tokens (account_type, account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_expiry_idx
  ON password_reset_tokens (expires_at)
  WHERE used_at IS NULL;

-- Billing webhook idempotency and delivery observability.
-- Safe to re-run.

ALTER TABLE billing_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS billing_stripe_subscription_idx
  ON billing_subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id VARCHAR(120) PRIMARY KEY,
  provider VARCHAR(30) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  recipient VARCHAR(240) NOT NULL,
  subject VARCHAR(240) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_delivery_status_check CHECK (status IN ('queued', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS email_delivery_retry_idx
  ON email_delivery_log (status, next_attempt_at)
  WHERE status IN ('queued', 'failed');

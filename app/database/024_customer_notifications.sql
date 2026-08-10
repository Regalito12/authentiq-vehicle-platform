-- Private notifications for buyer accounts.
CREATE TABLE IF NOT EXISTS customer_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  notification_type VARCHAR(40) NOT NULL DEFAULT 'activity',
  title VARCHAR(180) NOT NULL,
  body VARCHAR(320) NOT NULL,
  entity_type VARCHAR(40),
  entity_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_notifications_idx
  ON customer_notifications (customer_id, read_at, created_at DESC);

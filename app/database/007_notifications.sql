CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  notification_type VARCHAR(30) NOT NULL DEFAULT 'lead',
  title VARCHAR(180) NOT NULL,
  body VARCHAR(320) NOT NULL,
  entity_type VARCHAR(40),
  entity_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read_at, created_at DESC);

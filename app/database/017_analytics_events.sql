CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name VARCHAR(40) NOT NULL,
  path VARCHAR(240) NOT NULL DEFAULT '/',
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  source VARCHAR(80),
  session_id VARCHAR(80),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_idx ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_vehicle_idx ON analytics_events(vehicle_id, created_at DESC);

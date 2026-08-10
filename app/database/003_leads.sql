CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_type VARCHAR(30) NOT NULL DEFAULT 'contact',
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160),
  phone VARCHAR(40),
  message TEXT,
  source VARCHAR(40) NOT NULL DEFAULT 'website',
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  notes TEXT,
  assigned_to UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leads_type_check CHECK (lead_type IN ('contact', 'interest', 'offer', 'test_drive')),
  CONSTRAINT leads_status_check CHECK (status IN ('new', 'contacted', 'qualified', 'closed', 'lost'))
);

CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  event_type VARCHAR(30) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE offers ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE test_drive_requests ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_review_idx ON leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_vehicle_idx ON leads (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_events_timeline_idx ON lead_events (lead_id, created_at DESC);

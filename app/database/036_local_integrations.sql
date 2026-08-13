-- Integraciones por organización.
-- El modo local no guarda secretos externos ni intenta cobrar tarjetas.
CREATE TABLE IF NOT EXISTS organization_integrations (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  mode VARCHAR(24) NOT NULL DEFAULT 'local',
  status VARCHAR(32) NOT NULL DEFAULT 'not_connected',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, provider),
  CONSTRAINT organization_integrations_provider_check CHECK (provider IN ('google_calendar', 'meta_social', 'billing'))
);

CREATE TABLE IF NOT EXISTS social_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  platform VARCHAR(24) NOT NULL DEFAULT 'instagram',
  caption TEXT NOT NULL,
  hashtags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  media_url TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT social_drafts_platform_check CHECK (platform IN ('instagram', 'facebook', 'both')),
  CONSTRAINT social_drafts_status_check CHECK (status IN ('draft', 'ready', 'published'))
);

CREATE INDEX IF NOT EXISTS social_drafts_organization_idx ON social_drafts (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_drafts_vehicle_idx ON social_drafts (vehicle_id);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL DEFAULT 'local',
  mode VARCHAR(24) NOT NULL DEFAULT 'local_demo',
  plan_code VARCHAR(40) NOT NULL DEFAULT 'starter',
  status VARCHAR(24) NOT NULL DEFAULT 'trialing',
  monthly_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  current_period_end DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_subscriptions_status_check CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled'))
);

INSERT INTO organization_integrations (organization_id, provider, mode, status, config)
SELECT id, 'google_calendar', 'local', 'local_export_ready', '{"calendarName":"Agenda del showroom"}'::jsonb FROM organizations
ON CONFLICT (organization_id, provider) DO NOTHING;

INSERT INTO organization_integrations (organization_id, provider, mode, status, config)
SELECT id, 'meta_social', 'local', 'drafts_ready', '{"publishing":"manual"}'::jsonb FROM organizations
ON CONFLICT (organization_id, provider) DO NOTHING;

INSERT INTO organization_integrations (organization_id, provider, mode, status, config)
SELECT id, 'billing', 'local_demo', 'trialing', '{"checkout":"pending_provider"}'::jsonb FROM organizations
ON CONFLICT (organization_id, provider) DO NOTHING;

INSERT INTO billing_subscriptions (organization_id, provider, mode, plan_code, status, monthly_amount, currency, current_period_end)
SELECT id, 'local', 'local_demo', 'starter', 'trialing', 0, 'USD', CURRENT_DATE + 14 FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

ALTER TABLE organization_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;

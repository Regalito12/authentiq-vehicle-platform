-- Configuración verdaderamente aislada por organización.
-- business_settings queda como compatibilidad histórica; el runtime white-label
-- utiliza esta tabla y nunca depende de un singleton global.
CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  business_name VARCHAR(160) NOT NULL DEFAULT 'AUTHENTIQ',
  logo_url TEXT,
  phone VARCHAR(40),
  whatsapp VARCHAR(40),
  email VARCHAR(160),
  address VARCHAR(240),
  hours VARCHAR(240),
  instagram_url TEXT,
  facebook_url TEXT,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  privacy_text TEXT,
  terms_text TEXT,
  appointment_timezone VARCHAR(60) NOT NULL DEFAULT 'America/Santo_Domingo',
  appointment_start TIME NOT NULL DEFAULT '09:00',
  appointment_end TIME NOT NULL DEFAULT '18:00',
  appointment_duration_minutes SMALLINT NOT NULL DEFAULT 60 CHECK (appointment_duration_minutes BETWEEN 15 AND 240),
  appointment_min_notice_hours SMALLINT NOT NULL DEFAULT 2 CHECK (appointment_min_notice_hours BETWEEN 0 AND 720),
  appointment_max_days_ahead SMALLINT NOT NULL DEFAULT 30 CHECK (appointment_max_days_ahead BETWEEN 1 AND 365),
  appointment_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6]::SMALLINT[],
  appointment_capacity SMALLINT NOT NULL DEFAULT 1 CHECK (appointment_capacity BETWEEN 1 AND 20),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organization_settings (
  organization_id, business_name, logo_url, phone, whatsapp, email, address, hours,
  instagram_url, facebook_url, currency, privacy_text, terms_text,
  appointment_timezone, appointment_start, appointment_end, appointment_duration_minutes,
  appointment_min_notice_hours, appointment_max_days_ahead, appointment_days, appointment_capacity
)
SELECT o.id, COALESCE(bs.business_name, o.name), bs.logo_url, bs.phone, bs.whatsapp, bs.email,
       bs.address, bs.hours, bs.instagram_url, bs.facebook_url, bs.currency, bs.privacy_text,
       bs.terms_text, bs.appointment_timezone, bs.appointment_start, bs.appointment_end,
       bs.appointment_duration_minutes, bs.appointment_min_notice_hours, bs.appointment_max_days_ahead,
       bs.appointment_days, bs.appointment_capacity
FROM organizations o
LEFT JOIN business_settings bs ON bs.organization_id = o.id OR (bs.organization_id IS NULL AND o.slug = 'authentiq')
ON CONFLICT (organization_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS organization_settings_name_idx ON organization_settings (business_name);

ALTER TABLE appointment_blocks ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE appointment_blocks SET organization_id = (SELECT organization_id FROM admin_users WHERE admin_users.id = appointment_blocks.created_by) WHERE organization_id IS NULL;
CREATE INDEX IF NOT EXISTS appointment_blocks_organization_idx ON appointment_blocks (organization_id, block_date, start_time);

ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS analytics_events_organization_idx ON analytics_events (organization_id, created_at DESC);

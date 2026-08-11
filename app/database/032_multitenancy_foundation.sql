CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  logo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (slug, name)
SELECT 'authentiq', COALESCE((SELECT business_name FROM business_settings WHERE id=1), 'AUTHENTIQ')
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug='authentiq');

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  role VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, admin_user_id)
);

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE test_drive_requests ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE admin_users SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;
UPDATE business_settings SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;
UPDATE vehicles SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;
UPDATE leads SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;
UPDATE test_drive_requests SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;
UPDATE offers SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;
UPDATE quotes SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;
UPDATE blog_posts SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;

INSERT INTO organization_members (organization_id, admin_user_id, role)
SELECT organization_id, id, role FROM admin_users WHERE organization_id IS NOT NULL
ON CONFLICT (organization_id, admin_user_id) DO UPDATE SET role=EXCLUDED.role;

CREATE INDEX IF NOT EXISTS admin_users_organization_idx ON admin_users (organization_id, is_active);
CREATE INDEX IF NOT EXISTS vehicles_organization_idx ON vehicles (organization_id, status);
CREATE INDEX IF NOT EXISTS leads_organization_idx ON leads (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS appointments_organization_idx ON test_drive_requests (organization_id, requested_date, requested_time);
CREATE INDEX IF NOT EXISTS offers_organization_idx ON offers (organization_id, status);
CREATE INDEX IF NOT EXISTS quotes_organization_idx ON quotes (organization_id, status);
CREATE INDEX IF NOT EXISTS blog_organization_idx ON blog_posts (organization_id, status);

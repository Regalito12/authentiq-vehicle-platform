ALTER TABLE vehicle_brands ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE vehicle_brands SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;
UPDATE vehicle_categories SET organization_id=(SELECT id FROM organizations WHERE slug='authentiq') WHERE organization_id IS NULL;

ALTER TABLE vehicle_brands ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE vehicle_categories ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE vehicle_brands DROP CONSTRAINT IF EXISTS vehicle_brands_name_key;
ALTER TABLE vehicle_categories DROP CONSTRAINT IF EXISTS vehicle_categories_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_brands_organization_name_key ON vehicle_brands (organization_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_categories_organization_name_key ON vehicle_categories (organization_id, name);
CREATE INDEX IF NOT EXISTS vehicle_brands_organization_idx ON vehicle_brands (organization_id, is_active, name);
CREATE INDEX IF NOT EXISTS vehicle_categories_organization_idx ON vehicle_categories (organization_id, is_active, name);

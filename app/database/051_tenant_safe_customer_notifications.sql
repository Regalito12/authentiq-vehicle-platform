-- Tenant safety for buyer notifications.
-- Existing notifications are backfilled from their offer/quote entity when possible.
-- Orphaned legacy rows remain hidden by the organization-scoped API queries.

ALTER TABLE customer_notifications
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE customer_notifications cn
SET organization_id = o.organization_id
FROM offers o
WHERE cn.organization_id IS NULL
  AND cn.entity_type = 'offer'
  AND cn.entity_id = o.id;

UPDATE customer_notifications cn
SET organization_id = q.organization_id
FROM quotes q
WHERE cn.organization_id IS NULL
  AND cn.entity_type = 'quote'
  AND cn.entity_id = q.id;

CREATE INDEX IF NOT EXISTS customer_notifications_tenant_idx
  ON customer_notifications (organization_id, customer_id, read_at, created_at DESC);

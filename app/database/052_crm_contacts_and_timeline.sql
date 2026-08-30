-- CRM central por concesionario. Los contactos comerciales permanecen separados
-- de customer_accounts, que representa la cuenta pública del comprador.
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(200),
  phone VARCHAR(60),
  normalized_email VARCHAR(200),
  normalized_phone VARCHAR(60),
  notes TEXT,
  assigned_to UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crm_contacts_organization_idx ON crm_contacts (organization_id, last_activity_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_email_unique_idx ON crm_contacts (organization_id, normalized_email) WHERE normalized_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_phone_unique_idx ON crm_contacts (organization_id, normalized_phone) WHERE normalized_phone IS NOT NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL;
ALTER TABLE test_drive_requests ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS leads_contact_idx ON leads (organization_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS test_drive_requests_contact_idx ON test_drive_requests (organization_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotes_contact_idx ON quotes (organization_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS offers_contact_idx ON offers (organization_id, contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_contact_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  event_type VARCHAR(60) NOT NULL,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS crm_contact_events_timeline_idx ON crm_contact_events (organization_id, contact_id, created_at DESC);

ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contact_events ENABLE ROW LEVEL SECURITY;

-- El backend usa la conexión privada de PostgreSQL y aplica el tenant en cada
-- consulta. No se expone CRM directamente al Data API público.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON crm_contacts FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON crm_contacts FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON crm_contact_events FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON crm_contact_events FROM authenticated'; END IF;
END $$;

CREATE OR REPLACE FUNCTION zevroa_sync_lead_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  contact uuid;
  email_key text := NULLIF(lower(btrim(NEW.email)), '');
  phone_key text := NULLIF(regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]+', '', 'g'), '');
BEGIN
  IF NEW.organization_id IS NULL OR NEW.contact_id IS NOT NULL OR (email_key IS NULL AND phone_key IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO contact
  FROM crm_contacts
  WHERE organization_id = NEW.organization_id
    AND ((email_key IS NOT NULL AND normalized_email = email_key)
      OR (phone_key IS NOT NULL AND normalized_phone = phone_key))
  ORDER BY created_at ASC
  LIMIT 1;

  IF contact IS NULL THEN
    INSERT INTO crm_contacts (organization_id, full_name, email, phone, normalized_email, normalized_phone)
    VALUES (NEW.organization_id, COALESCE(NULLIF(btrim(NEW.name), ''), 'Contacto sin nombre'), NULLIF(btrim(NEW.email), ''), NULLIF(btrim(NEW.phone), ''), email_key, phone_key)
    RETURNING id INTO contact;
  ELSE
    UPDATE crm_contacts
    SET full_name = CASE WHEN full_name = 'Contacto sin nombre' AND NULLIF(btrim(NEW.name), '') IS NOT NULL THEN btrim(NEW.name) ELSE full_name END,
        email = COALESCE(email, NULLIF(btrim(NEW.email), '')),
        phone = COALESCE(phone, NULLIF(btrim(NEW.phone), '')),
        updated_at = NOW(), last_activity_at = NOW()
    WHERE id = contact;
  END IF;

  NEW.contact_id := contact;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_sync_crm_contact ON leads;
CREATE TRIGGER leads_sync_crm_contact
BEFORE INSERT OR UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION zevroa_sync_lead_contact();

-- Backfill seguro: el trigger agrupa por email/teléfono dentro del mismo dealer.
UPDATE leads SET updated_at = updated_at WHERE contact_id IS NULL;

INSERT INTO crm_contact_events (organization_id, contact_id, event_type, note, metadata, created_at)
SELECT l.organization_id, l.contact_id, 'lead_received', 'Lead histórico importado al CRM.', jsonb_build_object('leadId', l.id), l.created_at
FROM leads l
WHERE l.contact_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM crm_contact_events e
    WHERE e.contact_id = l.contact_id AND e.event_type = 'lead_received' AND e.metadata->>'leadId' = l.id::text
  );

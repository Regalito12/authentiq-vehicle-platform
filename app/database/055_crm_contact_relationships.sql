-- Cierra el CRM: una cita, oferta o cotización debe quedar en el mismo
-- contacto comercial que el lead del dealer. No fusiona perfiles cuando un
-- correo y un teléfono existentes pertenecen a personas distintas.

CREATE OR REPLACE FUNCTION zevroa_resolve_crm_contact(
  p_organization_id UUID,
  p_name TEXT,
  p_email TEXT,
  p_phone TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  email_key TEXT := NULLIF(lower(btrim(p_email)), '');
  phone_key TEXT := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]+', '', 'g'), '');
  email_contact UUID;
  phone_contact UUID;
  contact UUID;
BEGIN
  IF p_organization_id IS NULL OR (email_key IS NULL AND phone_key IS NULL) THEN
    RETURN NULL;
  END IF;

  -- Serializa solamente coincidencias equivalentes dentro de un dealer; evita
  -- que dos formularios simultáneos creen contactos duplicados.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || COALESCE(email_key, '') || ':' || COALESCE(phone_key, ''), 0));

  IF email_key IS NOT NULL THEN
    SELECT id INTO email_contact
    FROM crm_contacts
    WHERE organization_id = p_organization_id AND normalized_email = email_key
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF phone_key IS NOT NULL THEN
    SELECT id INTO phone_contact
    FROM crm_contacts
    WHERE organization_id = p_organization_id AND normalized_phone = phone_key
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- Dos claves que ya pertenecen a dos personas no se deben fusionar a ciegas.
  IF email_contact IS NOT NULL AND phone_contact IS NOT NULL AND email_contact <> phone_contact THEN
    RETURN NULL;
  END IF;

  contact := COALESCE(email_contact, phone_contact);
  IF contact IS NULL THEN
    INSERT INTO crm_contacts (organization_id, full_name, email, phone, normalized_email, normalized_phone)
    VALUES (
      p_organization_id,
      COALESCE(NULLIF(btrim(p_name), ''), 'Contacto sin nombre'),
      NULLIF(btrim(p_email), ''),
      NULLIF(btrim(p_phone), ''),
      email_key,
      phone_key
    )
    RETURNING id INTO contact;
  ELSE
    UPDATE crm_contacts
    SET full_name = CASE
          WHEN full_name = 'Contacto sin nombre' AND NULLIF(btrim(p_name), '') IS NOT NULL THEN btrim(p_name)
          ELSE full_name
        END,
        email = COALESCE(email, NULLIF(btrim(p_email), '')),
        phone = COALESCE(phone, NULLIF(btrim(p_phone), '')),
        normalized_email = COALESCE(normalized_email, email_key),
        normalized_phone = COALESCE(normalized_phone, phone_key),
        updated_at = NOW(),
        last_activity_at = NOW()
    WHERE id = contact AND organization_id = p_organization_id;
  END IF;

  RETURN contact;
END;
$$;

CREATE OR REPLACE FUNCTION zevroa_sync_lead_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NULL THEN
    NEW.contact_id := zevroa_resolve_crm_contact(NEW.organization_id, NEW.name, NEW.email, NEW.phone);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION zevroa_sync_appointment_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NULL THEN
    NEW.contact_id := zevroa_resolve_crm_contact(NEW.organization_id, NEW.customer_name, NEW.customer_email, NEW.customer_phone);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION zevroa_sync_offer_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NULL THEN
    NEW.contact_id := zevroa_resolve_crm_contact(NEW.organization_id, NEW.buyer_name, NEW.buyer_email, NEW.buyer_phone);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION zevroa_sync_quote_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_id IS NULL THEN
    NEW.contact_id := zevroa_resolve_crm_contact(NEW.organization_id, NEW.customer_name, NEW.customer_email, NEW.customer_phone);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_sync_crm_contact ON leads;
CREATE TRIGGER leads_sync_crm_contact
BEFORE INSERT OR UPDATE OF organization_id, name, email, phone, contact_id ON leads
FOR EACH ROW EXECUTE FUNCTION zevroa_sync_lead_contact();

DROP TRIGGER IF EXISTS appointments_sync_crm_contact ON test_drive_requests;
CREATE TRIGGER appointments_sync_crm_contact
BEFORE INSERT OR UPDATE OF organization_id, customer_name, customer_email, customer_phone, contact_id ON test_drive_requests
FOR EACH ROW EXECUTE FUNCTION zevroa_sync_appointment_contact();

DROP TRIGGER IF EXISTS offers_sync_crm_contact ON offers;
CREATE TRIGGER offers_sync_crm_contact
BEFORE INSERT OR UPDATE OF organization_id, buyer_name, buyer_email, buyer_phone, contact_id ON offers
FOR EACH ROW EXECUTE FUNCTION zevroa_sync_offer_contact();

DROP TRIGGER IF EXISTS quotes_sync_crm_contact ON quotes;
CREATE TRIGGER quotes_sync_crm_contact
BEFORE INSERT OR UPDATE OF organization_id, customer_name, customer_email, customer_phone, contact_id ON quotes
FOR EACH ROW EXECUTE FUNCTION zevroa_sync_quote_contact();

-- Backfill explícito para que el resultado sea auditable y no dependa de una
-- columna de updated_at que no existe en todas las tablas históricas.
UPDATE leads
SET contact_id = zevroa_resolve_crm_contact(organization_id, name, email, phone)
WHERE contact_id IS NULL;

UPDATE test_drive_requests
SET contact_id = zevroa_resolve_crm_contact(organization_id, customer_name, customer_email, customer_phone)
WHERE contact_id IS NULL;

UPDATE offers
SET contact_id = zevroa_resolve_crm_contact(organization_id, buyer_name, buyer_email, buyer_phone)
WHERE contact_id IS NULL;

UPDATE quotes
SET contact_id = zevroa_resolve_crm_contact(organization_id, customer_name, customer_email, customer_phone)
WHERE contact_id IS NULL;

UPDATE crm_contacts c
SET last_activity_at = activity.last_activity_at,
    updated_at = NOW()
FROM (
  SELECT organization_id, contact_id, MAX(created_at) AS last_activity_at
  FROM (
    SELECT organization_id, contact_id, created_at FROM leads WHERE contact_id IS NOT NULL
    UNION ALL
    SELECT organization_id, contact_id, created_at FROM test_drive_requests WHERE contact_id IS NOT NULL
    UNION ALL
    SELECT organization_id, contact_id, created_at FROM offers WHERE contact_id IS NOT NULL
    UNION ALL
    SELECT organization_id, contact_id, created_at FROM quotes WHERE contact_id IS NOT NULL
  ) activity_rows
  GROUP BY organization_id, contact_id
) activity
WHERE activity.organization_id = c.organization_id
  AND activity.contact_id = c.id
  AND activity.last_activity_at > c.last_activity_at;

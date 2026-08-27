-- Rebrand the platform home without touching individually branded dealer accounts.
-- The legacy slug is only migrated when the new slug is still available.
UPDATE organizations
SET slug = 'zevroa', name = 'ZEVROA', updated_at = NOW()
WHERE slug = 'authentiq'
  AND NOT EXISTS (SELECT 1 FROM organizations WHERE slug = 'zevroa');

UPDATE organizations
SET name = 'ZEVROA', updated_at = NOW()
WHERE slug = 'zevroa';

UPDATE organization_settings os
SET business_name = 'ZEVROA',
    privacy_text = REPLACE(REPLACE(privacy_text, 'AUTHENTIQ', 'ZEVROA'), 'Authentiq', 'Zevroa'),
    terms_text = REPLACE(REPLACE(terms_text, 'AUTHENTIQ', 'ZEVROA'), 'Authentiq', 'Zevroa'),
    updated_at = NOW()
FROM organizations o
WHERE os.organization_id = o.id
  AND o.slug = 'zevroa';

UPDATE business_settings
SET business_name = 'ZEVROA',
    privacy_text = REPLACE(REPLACE(privacy_text, 'AUTHENTIQ', 'ZEVROA'), 'Authentiq', 'Zevroa'),
    terms_text = REPLACE(REPLACE(terms_text, 'AUTHENTIQ', 'ZEVROA'), 'Authentiq', 'Zevroa'),
    updated_at = NOW()
WHERE id = 1
  AND (business_name ILIKE 'AUTHENTIQ' OR business_name IS NULL);

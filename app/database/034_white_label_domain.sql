-- Perfil de marca blanca: dominio que el concesionario configurará en el proveedor de hosting.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(253);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_custom_domain_idx
  ON organizations (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

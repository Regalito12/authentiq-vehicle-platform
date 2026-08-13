-- Branding visual aislado por organización.
-- Mantiene defaults AUTHENTIQ para organizaciones existentes y permite que
-- cada concesionario tenga una identidad visual propia sin compartir estado.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) NOT NULL DEFAULT '#c8a24b',
  ADD COLUMN IF NOT EXISTS accent_color VARCHAR(7) NOT NULL DEFAULT '#b28b37',
  ADD COLUMN IF NOT EXISTS favicon_url TEXT;

UPDATE organization_settings
SET primary_color = '#c8a24b'
WHERE primary_color IS NULL OR primary_color = '';

UPDATE organization_settings
SET accent_color = '#b28b37'
WHERE accent_color IS NULL OR accent_color = '';

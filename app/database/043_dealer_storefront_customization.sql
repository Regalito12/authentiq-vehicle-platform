-- Fase 3 (arranque): personalización de la tienda que cada dealer controla desde su
-- propio backoffice, más allá de los 2 colores + logo que había hasta ahora.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS hero_headline VARCHAR(160),
  ADD COLUMN IF NOT EXISTS hero_subheadline VARCHAR(280),
  ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
  ADD COLUMN IF NOT EXISTS show_financing BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_brand_rail BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_model_line_rail BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_blog BOOLEAN NOT NULL DEFAULT TRUE;

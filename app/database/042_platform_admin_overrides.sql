-- Superpoderes del admin de plataforma: CSS/inyección manual por dealer, controlada
-- únicamente desde PlatformCenter (nunca editable por el propio dealer).
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS custom_css TEXT;

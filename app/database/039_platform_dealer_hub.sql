-- Centro central de ZEVROA para administrar dealers, planes y suscripciones.
-- El cobro real sigue fuera de esta migración: aquí solo vive el estado comercial.

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('admin', 'seller', 'editor', 'content_editor', 'platform_admin'));

CREATE TABLE IF NOT EXISTS platform_plans (
  code VARCHAR(40) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  monthly_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  vehicle_limit INTEGER CHECK (vehicle_limit IS NULL OR vehicle_limit > 0),
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_plans (code, name, description, monthly_amount, vehicle_limit, features)
VALUES
  ('starter', 'Starter', 'Para un dealer que está comenzando su vitrina digital.', 99, 40, '["Showroom white-label", "Inventario y leads", "Agenda de citas"]'::jsonb),
  ('growth', 'Growth', 'Para equipos comerciales que necesitan más automatización.', 249, 150, '["Todo Starter", "Redes sociales", "Cotizaciones y analítica"]'::jsonb),
  ('scale', 'Scale', 'Para operaciones con inventario amplio y varios usuarios.', 499, NULL, '["Todo Growth", "Inventario ilimitado", "Soporte prioritario"]'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  monthly_amount = EXCLUDED.monthly_amount,
  vehicle_limit = EXCLUDED.vehicle_limit,
  features = EXCLUDED.features,
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS platform_admin_role_idx ON admin_users (role, is_active);
CREATE INDEX IF NOT EXISTS billing_plan_status_idx ON billing_subscriptions (plan_code, status);

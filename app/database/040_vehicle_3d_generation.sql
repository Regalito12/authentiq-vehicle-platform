-- Trabajos asincronos para convertir fotos del vehiculo en un modelo 3D.
-- El proveedor se configura en el servidor; el resultado queda pendiente de revision.

CREATE TABLE IF NOT EXISTS vehicle_3d_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL DEFAULT 'rodin',
  status VARCHAR(24) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'needs_review')),
  source_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_task_id TEXT,
  provider_subscription_key TEXT,
  model_url TEXT,
  preview_url TEXT,
  error TEXT,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS vehicle_3d_jobs_vehicle_idx ON vehicle_3d_jobs (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_3d_jobs_org_status_idx ON vehicle_3d_jobs (organization_id, status, created_at DESC);

ALTER TABLE vehicle_3d_jobs ENABLE ROW LEVEL SECURITY;

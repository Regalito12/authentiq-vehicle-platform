CREATE TABLE IF NOT EXISTS vehicle_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('video', 'model_3d', 'panorama_360')),
  url TEXT NOT NULL,
  poster_url TEXT,
  alt_text VARCHAR(180),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vehicle_media_vehicle_idx
  ON vehicle_media(vehicle_id, is_active, sort_order);

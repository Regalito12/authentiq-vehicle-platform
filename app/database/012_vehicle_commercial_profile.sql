ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS variant VARCHAR(140);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(60);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS exterior_color VARCHAR(80);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS interior_color VARCHAR(80);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS doors SMALLINT CHECK (doors IS NULL OR doors BETWEEN 1 AND 8);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS seats SMALLINT CHECK (seats IS NULL OR seats BETWEEN 1 AND 20);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS location VARCHAR(160);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS stock_number VARCHAR(80);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS warranty VARCHAR(240);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_status_check;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_status_check
  CHECK (status IN ('draft', 'published', 'reserved', 'sold', 'inactive'));

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_stock_number_unique_idx
  ON vehicles (LOWER(stock_number))
  WHERE stock_number IS NOT NULL AND stock_number <> '';

CREATE INDEX IF NOT EXISTS vehicles_commercial_filters_idx
  ON vehicles (status, fuel_type, transmission, year, mileage_km);

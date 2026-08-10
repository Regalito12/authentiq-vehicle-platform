CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_users_role_check CHECK (role IN ('admin', 'seller'))
);

CREATE TABLE IF NOT EXISTS vehicle_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES vehicle_brands(id),
  category_id UUID REFERENCES vehicle_categories(id),
  model VARCHAR(120) NOT NULL,
  year SMALLINT NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  condition VARCHAR(20) NOT NULL DEFAULT 'used',
  price_usd NUMERIC(12, 2) NOT NULL CHECK (price_usd >= 0),
  engine VARCHAR(120),
  power VARCHAR(120),
  transmission VARCHAR(120),
  drive VARCHAR(80),
  mileage_km INTEGER NOT NULL DEFAULT 0 CHECK (mileage_km >= 0),
  description TEXT,
  stock INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  max_discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (max_discount_percent BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vehicles_condition_check CHECK (condition IN ('new', 'used')),
  CONSTRAINT vehicles_status_check CHECK (status IN ('draft', 'published', 'sold', 'inactive'))
);

CREATE TABLE IF NOT EXISTS vehicle_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  alt_text VARCHAR(180),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  buyer_name VARCHAR(120) NOT NULL,
  buyer_email VARCHAR(160),
  buyer_phone VARCHAR(40),
  amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd > 0),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
  message TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES admin_users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT offers_payment_method_check CHECK (payment_method IN ('cash')),
  CONSTRAINT offers_status_check CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE TABLE IF NOT EXISTS test_drive_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(160),
  customer_phone VARCHAR(40),
  requested_date DATE NOT NULL,
  requested_time TIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT test_drive_status_check CHECK (status IN ('pending', 'confirmed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS vehicles_catalog_idx
  ON vehicles (status, brand_id, category_id, year);

CREATE INDEX IF NOT EXISTS offers_review_idx
  ON offers (status, created_at DESC);

CREATE INDEX IF NOT EXISTS test_drive_review_idx
  ON test_drive_requests (status, requested_date, requested_time);

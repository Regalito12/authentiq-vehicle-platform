CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number VARCHAR(40) NOT NULL UNIQUE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(160),
  customer_phone VARCHAR(40),
  base_price_usd NUMERIC(12,2) NOT NULL CHECK (base_price_usd >= 0),
  discount_usd NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_usd >= 0),
  total_usd NUMERIC(12,2) NOT NULL CHECK (total_usd >= 0),
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  valid_until DATE,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','expired','cancelled')),
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quotes_discount_not_above_base CHECK (discount_usd <= base_price_usd),
  CONSTRAINT quotes_total_matches_base CHECK (total_usd = base_price_usd - discount_usd)
);

CREATE INDEX IF NOT EXISTS quotes_lead_created_idx ON quotes(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quotes_status_validity_idx ON quotes(status, valid_until);

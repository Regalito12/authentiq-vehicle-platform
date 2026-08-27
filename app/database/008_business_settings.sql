CREATE TABLE IF NOT EXISTS business_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name VARCHAR(160) NOT NULL DEFAULT 'ZEVROA',
  logo_url TEXT,
  phone VARCHAR(40),
  whatsapp VARCHAR(40),
  email VARCHAR(160),
  address VARCHAR(240),
  hours VARCHAR(240),
  instagram_url TEXT,
  facebook_url TEXT,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  privacy_text TEXT,
  terms_text TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO business_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

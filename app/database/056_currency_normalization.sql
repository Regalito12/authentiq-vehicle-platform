-- Normaliza los importes públicos sin romper los nombres históricos *_usd.
-- Los campos antiguos se conservan para compatibilidad temporal; el API nuevo
-- debe leer y escribir los campos genéricos.

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS price_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS price_currency VARCHAR(8);

UPDATE vehicles v
SET price_amount = COALESCE(v.price_amount, v.price_usd),
    price_currency = UPPER(COALESCE(NULLIF(v.price_currency, ''), os.currency, 'USD'))
FROM organizations o
LEFT JOIN organization_settings os ON os.organization_id = o.id
WHERE v.organization_id = o.id;

UPDATE vehicles
SET price_amount = COALESCE(price_amount, price_usd, 0),
    price_currency = UPPER(COALESCE(NULLIF(price_currency, ''), 'USD'))
WHERE price_amount IS NULL OR price_currency IS NULL OR price_currency = '';

UPDATE vehicles SET price_currency = UPPER(price_currency) WHERE price_currency IS NOT NULL;

ALTER TABLE vehicles
  ALTER COLUMN price_amount SET DEFAULT 0,
  ALTER COLUMN price_amount SET NOT NULL,
  ALTER COLUMN price_currency SET DEFAULT 'USD',
  ALTER COLUMN price_currency SET NOT NULL;

ALTER TABLE vehicles ALTER COLUMN price_usd DROP NOT NULL;

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_price_amount_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_price_amount_check CHECK (price_amount >= 0);
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_price_currency_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_price_currency_check CHECK (price_currency ~ '^[A-Z]{3,8}$');

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(8);

UPDATE offers o
SET amount = COALESCE(o.amount, o.amount_usd),
    currency = UPPER(COALESCE(NULLIF(o.currency, ''), v.price_currency, 'USD'))
FROM vehicles v
WHERE o.vehicle_id = v.id;

UPDATE offers
SET amount = COALESCE(amount, amount_usd, 0),
    currency = UPPER(COALESCE(NULLIF(currency, ''), 'USD'))
WHERE amount IS NULL OR currency IS NULL OR currency = '';

UPDATE offers SET currency = UPPER(currency) WHERE currency IS NOT NULL;

ALTER TABLE offers
  ALTER COLUMN amount SET DEFAULT 0,
  ALTER COLUMN amount SET NOT NULL,
  ALTER COLUMN currency SET DEFAULT 'USD',
  ALTER COLUMN currency SET NOT NULL;

ALTER TABLE offers ALTER COLUMN amount_usd DROP NOT NULL;

ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_amount_check;
ALTER TABLE offers ADD CONSTRAINT offers_amount_check CHECK (amount > 0);
ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_currency_check;
ALTER TABLE offers ADD CONSTRAINT offers_currency_check CHECK (currency ~ '^[A-Z]{3,8}$');

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2);

UPDATE quotes q
SET base_amount = COALESCE(q.base_amount, q.base_price_usd),
    discount_amount = COALESCE(q.discount_amount, q.discount_usd),
    total_amount = COALESCE(q.total_amount, q.total_usd),
    currency = UPPER(COALESCE(NULLIF(q.currency, ''), v.price_currency, 'USD'))
FROM vehicles v
WHERE q.vehicle_id = v.id;

UPDATE quotes
SET base_amount = COALESCE(base_amount, base_price_usd, 0),
    discount_amount = COALESCE(discount_amount, discount_usd, 0),
    total_amount = COALESCE(total_amount, total_usd, 0),
    currency = UPPER(COALESCE(NULLIF(currency, ''), 'USD'))
WHERE base_amount IS NULL OR discount_amount IS NULL OR total_amount IS NULL OR currency IS NULL OR currency = '';

UPDATE quotes SET currency = UPPER(currency) WHERE currency IS NOT NULL;

ALTER TABLE quotes
  ALTER COLUMN base_amount SET DEFAULT 0,
  ALTER COLUMN base_amount SET NOT NULL,
  ALTER COLUMN discount_amount SET DEFAULT 0,
  ALTER COLUMN discount_amount SET NOT NULL,
  ALTER COLUMN total_amount SET DEFAULT 0,
  ALTER COLUMN total_amount SET NOT NULL;

ALTER TABLE quotes
  ALTER COLUMN base_price_usd DROP NOT NULL,
  ALTER COLUMN discount_usd DROP NOT NULL,
  ALTER COLUMN total_usd DROP NOT NULL;

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_amounts_match;
ALTER TABLE quotes ADD CONSTRAINT quotes_amounts_match CHECK (discount_amount >= 0 AND discount_amount <= base_amount AND total_amount = base_amount - discount_amount);

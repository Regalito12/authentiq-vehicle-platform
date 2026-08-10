-- Link backoffice quotes to buyer accounts when their email matches.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customer_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotes_customer_idx
  ON quotes (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

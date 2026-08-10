-- Link commercial requests to buyer accounts when the buyer is authenticated.
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customer_accounts(id) ON DELETE SET NULL;

ALTER TABLE test_drive_requests
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customer_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS offers_customer_idx
  ON offers (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS test_drive_customer_idx
  ON test_drive_requests (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

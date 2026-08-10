-- Publication workflow: editors request review; admins approve or return to draft.
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_status_check;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_status_check
  CHECK (status IN ('draft', 'pending_review', 'published', 'reserved', 'sold', 'inactive'));

CREATE INDEX IF NOT EXISTS vehicles_review_idx
  ON vehicles (status, updated_at DESC)
  WHERE status = 'pending_review';

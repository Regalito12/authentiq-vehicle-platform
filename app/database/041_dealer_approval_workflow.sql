-- Cola de aprobación para dealers: el registro self-service ya no publica de inmediato.
-- El default 'approved' deja intactos a todos los dealers existentes.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS organizations_approval_status_idx ON organizations (approval_status);

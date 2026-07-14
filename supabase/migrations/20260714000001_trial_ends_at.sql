-- Fase 3.2: trial de 3 dias por tenant.
-- NULL = sem limite (tenants pré-existentes/grandfathered, ou pago na Fase 3.3).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
COMMENT ON COLUMN tenants.trial_ends_at IS 'NULL = sem limite. Trial expirado quando now() > trial_ends_at.';

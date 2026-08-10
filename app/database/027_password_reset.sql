-- 027_password_reset.sql
-- Idempotente.
--
-- Contexto: no existía ningún camino de recuperación de contraseña. Un
-- administrador auto-servido por email/SMTP no es viable ahora mismo (no hay
-- credenciales de correo configuradas), así que se implementa la mitad que sí
-- es completable de inmediato: un administrador puede restablecer la
-- contraseña de otro usuario del backoffice, y ese usuario queda obligado a
-- cambiarla en su próximo inicio de sesión.
--
-- El flujo de "olvidé mi contraseña" autoservido por correo queda documentado
-- como pendiente (ver AUDITORIA-2026-08-09.md) hasta que el negocio provea
-- credenciales SMTP reales.

BEGIN;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;

-- Verificación:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'admin_users' AND column_name = 'must_change_password';

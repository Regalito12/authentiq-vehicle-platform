import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

function hash(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }

function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0; let value = 0; let output = "";
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0; let current = 0; const output = [];
  for (const char of String(value || "").toUpperCase().replace(/=+$/, "")) { const index = alphabet.indexOf(char); if (index < 0) continue; current = (current << 5) | index; bits += 5; if (bits >= 8) { output.push((current >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(output);
}

function encryptionKey(jwtSecret) { return crypto.createHash("sha256").update(String(jwtSecret)).digest(); }
function encryptSecret(secret, jwtSecret) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(jwtSecret), iv); const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((item) => item.toString("base64url")).join(".");
}
function decryptSecret(value, jwtSecret) {
  const [iv, tag, encrypted] = String(value || "").split(".").map((item) => Buffer.from(item, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(jwtSecret), iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000); const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(buffer).digest(); const offset = digest[digest.length - 1] & 15; const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000; return String(number).padStart(6, "0");
}
function validTotp(secret, code) { const clean = String(code || "").replace(/\s/g, ""); if (!/^\d{6}$/.test(clean)) return false; for (const drift of [-30000, 0, 30000]) { if (crypto.timingSafeEqual(Buffer.from(totp(secret, Date.now() + drift)), Buffer.from(clean))) return true; } return false; }
function recoveryHash(value) { return hash(String(value || "").trim().toUpperCase()); }

function challengeToken({ id, email, role, organizationId, jwtSecret }) { return jwt.sign({ kind: "admin_mfa_challenge", id, email, role, organizationId }, jwtSecret, { expiresIn: "5m" }); }

async function mfaEnabledForAdmin(pool, id) {
  try { const result = await pool.query("SELECT mfa_enabled AS \"mfaEnabled\" FROM admin_users WHERE id=$1", [id]); return Boolean(result.rows[0]?.mfaEnabled); }
  catch (error) { if (error?.code === "42703") return false; throw error; }
}

function registerSecurityRoutes({ app, pool, jwtSecret, authenticate, requireRoles, adminOrganizationId, writeAudit, sendTransactionalEmail, publicSiteUrl, setSessionCookie, sessionResponse }) {
  app.get("/api/admin/invitations", authenticate, requireRoles("admin"), async (req, res) => {
    try { const result = await pool.query(`SELECT id, email, full_name AS "fullName", role, expires_at AS "expiresAt", accepted_at AS "acceptedAt", revoked_at AS "revokedAt", created_at AS "createdAt" FROM admin_invitations WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`, [adminOrganizationId(req)]); res.json({ data: result.rows }); }
    catch (error) { if (error?.code === "42P01") return res.status(503).json({ error: "Las invitaciones necesitan aplicar la migración", code: "INVITATIONS_MIGRATION_REQUIRED" }); console.error("Invitation list failed", error); res.status(500).json({ error: "No se pudieron cargar las invitaciones" }); }
  });

  app.post("/api/admin/invitations", authenticate, requireRoles("admin"), async (req, res) => {
    const organizationId = adminOrganizationId(req); const email = String(req.body?.email || "").trim().toLowerCase(); const fullName = String(req.body?.fullName || req.body?.name || "").trim(); const role = ["admin", "editor", "seller", "content_editor"].includes(req.body?.role) ? req.body.role : "seller";
    if (!organizationId || !email.includes("@") || !fullName) return res.status(400).json({ error: "Nombre, correo y rol son obligatorios" });
    const rawToken = crypto.randomBytes(32).toString("base64url");
    try {
      const existing = await pool.query("SELECT id FROM admin_users WHERE LOWER(email)=$1", [email]);
      if (existing.rowCount) return res.status(409).json({ error: "Ese correo ya pertenece a una cuenta" });
      const result = await pool.query(`INSERT INTO admin_invitations (organization_id,email,full_name,role,token_hash,expires_at,invited_by) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '72 hours',$6) RETURNING id, email, full_name AS "fullName", role, expires_at AS "expiresAt"`, [organizationId, email, fullName, role, hash(rawToken), req.admin.id]);
      const base = String(publicSiteUrl || `${req.protocol}://${req.get("host")}`).replace(/\/$/, ""); const url = `${base}/backoffice?invite=${encodeURIComponent(rawToken)}`;
      const delivery = await sendTransactionalEmail({ organizationId, to: email, subject: "Tu invitación a ZEVROA", text: `Te invitaron a trabajar en ZEVROA. Acepta la invitación en las próximas 72 horas: ${url}`, html: `<p>Te invitaron a trabajar en ZEVROA como <strong>${role}</strong>.</p><p><a href="${url}">Aceptar invitación</a></p><p>El enlace vence en 72 horas y solo se puede usar una vez.</p>` });
      if (!delivery.sent) { await pool.query("UPDATE admin_invitations SET revoked_at=NOW() WHERE id=$1", [result.rows[0].id]); return res.status(503).json({ error: "No se pudo enviar el correo. Configura Resend antes de invitar al equipo.", code: "EMAIL_NOT_CONFIGURED" }); }
      await writeAudit(req, "invitation.create", "admin_invitation", result.rows[0].id, { email, role }); res.status(201).json({ data: result.rows[0] });
    } catch (error) { if (error?.code === "42P01") return res.status(503).json({ error: "Las invitaciones necesitan aplicar la migración", code: "INVITATIONS_MIGRATION_REQUIRED" }); console.error("Invitation create failed", error); res.status(error?.code === "23505" ? 409 : 500).json({ error: error?.code === "23505" ? "Ya existe una invitación pendiente para ese correo" : "No se pudo crear la invitación" }); }
  });

  app.post("/api/admin/invitations/:id/revoke", authenticate, requireRoles("admin"), async (req, res) => {
    try { const result = await pool.query("UPDATE admin_invitations SET revoked_at=COALESCE(revoked_at,NOW()) WHERE id=$1 AND organization_id=$2 AND accepted_at IS NULL RETURNING id", [req.params.id, adminOrganizationId(req)]); if (!result.rowCount) return res.status(404).json({ error: "Invitación no encontrada o ya utilizada" }); await writeAudit(req, "invitation.revoke", "admin_invitation", req.params.id, {}); res.status(204).end(); }
    catch (error) { if (error?.code === "42P01") return res.status(503).json({ error: "Las invitaciones necesitan aplicar la migración", code: "INVITATIONS_MIGRATION_REQUIRED" }); console.error("Invitation revoke failed", error); res.status(500).json({ error: "No se pudo cancelar la invitación" }); }
  });

  app.post("/api/admin/invitations/:id/resend", authenticate, requireRoles("admin"), async (req, res) => {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    try {
      const invitation = await pool.query(`UPDATE admin_invitations SET token_hash=$1, expires_at=NOW()+INTERVAL '72 hours' WHERE id=$2 AND organization_id=$3 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id,email,full_name AS "fullName",role,expires_at AS "expiresAt"`, [hash(rawToken), req.params.id, adminOrganizationId(req)]);
      if (!invitation.rowCount) return res.status(404).json({ error: "Invitación no encontrada o ya utilizada" });
      const item = invitation.rows[0]; const base = String(publicSiteUrl || `${req.protocol}://${req.get("host")}`).replace(/\/$/, ""); const url = `${base}/backoffice?invite=${encodeURIComponent(rawToken)}`;
      const delivery = await sendTransactionalEmail({ organizationId: adminOrganizationId(req), to: item.email, subject: "Tu invitación a ZEVROA", text: `Tu invitación sigue disponible durante 72 horas: ${url}`, html: `<p>Tu invitación a ZEVROA fue renovada.</p><p><a href="${url}">Aceptar invitación</a></p>` });
      if (!delivery.sent) { await pool.query("UPDATE admin_invitations SET revoked_at=NOW() WHERE id=$1 AND organization_id=$2", [item.id, adminOrganizationId(req)]); return res.status(503).json({ error: "No se pudo enviar el correo. Revisa la configuración de Resend.", code: "EMAIL_NOT_CONFIGURED" }); }
      await writeAudit(req, "invitation.resend", "admin_invitation", item.id, { email: item.email }); res.json({ data: item });
    } catch (error) { if (error?.code === "42P01") return res.status(503).json({ error: "Las invitaciones necesitan aplicar la migración", code: "INVITATIONS_MIGRATION_REQUIRED" }); console.error("Invitation resend failed", error); res.status(500).json({ error: "No se pudo reenviar la invitación" }); }
  });

  app.post("/api/auth/accept-invitation", async (req, res) => {
    const token = String(req.body?.token || ""); const password = String(req.body?.password || "");
    if (token.length < 20 || password.length < 8) return res.status(400).json({ error: "El enlace y una contraseña de al menos 8 caracteres son obligatorios" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); const invitation = await client.query(`SELECT id, organization_id AS "organizationId", email, full_name AS "fullName", role FROM admin_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE`, [hash(token)]);
      if (!invitation.rowCount) { await client.query("ROLLBACK"); return res.status(410).json({ error: "La invitación no es válida, ya fue utilizada o expiró" }); }
      const item = invitation.rows[0]; const passwordHash = await bcrypt.hash(password, 12); const user = await client.query(`INSERT INTO admin_users (full_name,email,password_hash,role,organization_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name AS "name", email, role, organization_id AS "organizationId", must_change_password AS "mustChangePassword"`, [item.fullName, item.email, passwordHash, item.role, item.organizationId]);
      await client.query("INSERT INTO organization_members (organization_id, admin_user_id, role) VALUES ($1,$2,$3) ON CONFLICT (organization_id, admin_user_id) DO UPDATE SET role=EXCLUDED.role", [item.organizationId, user.rows[0].id, item.role]);
      await client.query("UPDATE admin_invitations SET accepted_at=NOW() WHERE id=$1", [item.id]); await client.query("COMMIT"); res.status(201).json({ data: { user: user.rows[0], message: "Cuenta creada. Ya puedes iniciar sesión." } });
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); console.error("Invitation acceptance failed", error); res.status(error?.code === "23505" ? 409 : 500).json({ error: error?.code === "23505" ? "Ese correo ya tiene una cuenta" : "No se pudo aceptar la invitación" }); } finally { client.release(); }
  });

  app.post("/api/admin/mfa/setup", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
    try { const account = await pool.query("SELECT email, mfa_enabled AS \"mfaEnabled\" FROM admin_users WHERE id=$1 AND is_active=TRUE", [req.admin.id]); if (!account.rowCount) return res.status(404).json({ error: "Cuenta no encontrada" }); if (account.rows[0].mfaEnabled) return res.status(409).json({ error: "MFA ya está activado" }); const secret = base32Encode(crypto.randomBytes(20)); const setupToken = jwt.sign({ kind: "mfa_setup", id: req.admin.id, secret }, jwtSecret, { expiresIn: "10m" }); const label = encodeURIComponent(`ZEVROA:${account.rows[0].email}`); res.json({ data: { setupToken, secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=ZEVROA&algorithm=SHA1&digits=6&period=30` } }); }
    catch (error) { console.error("MFA setup failed", error); res.status(500).json({ error: "No se pudo preparar MFA" }); }
  });

  app.post("/api/admin/mfa/verify", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
    const setupToken = String(req.body?.setupToken || ""); const code = String(req.body?.code || "");
    try { const payload = jwt.verify(setupToken, jwtSecret); if (payload.kind !== "mfa_setup" || payload.id !== req.admin.id || !validTotp(payload.secret, code)) return res.status(400).json({ error: "El código de autenticación no es válido" }); const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").toUpperCase()); await pool.query("UPDATE admin_users SET mfa_enabled=TRUE, mfa_secret_encrypted=$1, mfa_recovery_codes=$2::jsonb, updated_at=NOW() WHERE id=$3", [encryptSecret(payload.secret, jwtSecret), JSON.stringify(recoveryCodes.map(recoveryHash)), req.admin.id]); await writeAudit(req, "mfa.enable", "admin_user", req.admin.id, {}); res.json({ data: { enabled: true, recoveryCodes } }); }
    catch (error) { if (error?.name === "TokenExpiredError" || error?.name === "JsonWebTokenError") return res.status(400).json({ error: "La preparación de MFA expiró. Iníciala nuevamente." }); console.error("MFA verify failed", error); res.status(500).json({ error: "No se pudo activar MFA" }); }
  });

  app.post("/api/admin/mfa/disable", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
    const password = String(req.body?.password || ""); const code = String(req.body?.code || "");
    try { const account = await pool.query("SELECT password_hash, mfa_secret_encrypted AS \"secret\", mfa_enabled AS \"enabled\" FROM admin_users WHERE id=$1", [req.admin.id]); if (!account.rowCount || !account.rows[0].enabled) return res.status(400).json({ error: "MFA no está activado" }); if (!(await bcrypt.compare(password, account.rows[0].password_hash)) || !validTotp(decryptSecret(account.rows[0].secret, jwtSecret), code)) return res.status(401).json({ error: "Contraseña o código incorrectos" }); await pool.query("UPDATE admin_users SET mfa_enabled=FALSE, mfa_secret_encrypted=NULL, mfa_recovery_codes='[]'::jsonb, updated_at=NOW() WHERE id=$1", [req.admin.id]); await writeAudit(req, "mfa.disable", "admin_user", req.admin.id, {}); res.json({ data: { enabled: false } }); }
    catch (error) { console.error("MFA disable failed", error); res.status(500).json({ error: "No se pudo desactivar MFA" }); }
  });

  app.post("/api/auth/mfa/challenge", async (req, res) => {
    const token = String(req.body?.challengeToken || ""); const code = String(req.body?.code || "");
    try { const challenge = jwt.verify(token, jwtSecret); if (challenge.kind !== "admin_mfa_challenge") return res.status(401).json({ error: "Desafío MFA inválido" }); const result = await pool.query("SELECT id, full_name AS \"name\", email, role, organization_id AS \"organizationId\", session_version AS \"sessionVersion\", mfa_enabled AS \"mfaEnabled\", mfa_secret_encrypted AS \"secret\", mfa_recovery_codes AS \"recoveryCodes\", must_change_password AS \"mustChangePassword\" FROM admin_users WHERE id=$1 AND is_active=TRUE", [challenge.id]); const admin = result.rows[0]; if (!admin?.mfaEnabled) return res.status(409).json({ error: "MFA no está activado" }); let recoveryUsed = false; const secret = decryptSecret(admin.secret, jwtSecret); const codeValid = validTotp(secret, code); let recoveryCodes = Array.isArray(admin.recoveryCodes) ? admin.recoveryCodes : []; if (!codeValid) { const candidate = recoveryHash(code); const index = recoveryCodes.indexOf(candidate); if (index < 0) return res.status(401).json({ error: "Código de autenticación incorrecto" }); recoveryCodes = recoveryCodes.filter((_item, position) => position !== index); recoveryUsed = true; } if (recoveryUsed) await pool.query("UPDATE admin_users SET mfa_recovery_codes=$1::jsonb WHERE id=$2", [JSON.stringify(recoveryCodes), admin.id]); const session = jwt.sign({ id: admin.id, email: admin.email, role: admin.role, name: admin.name, organizationId: admin.organizationId, mustChangePassword: admin.mustChangePassword, sessionVersion: admin.sessionVersion || 0 }, jwtSecret, { expiresIn: admin.mustChangePassword ? "15m" : "8h" }); setSessionCookie(res, "authentiq_admin_session", session, admin.mustChangePassword ? 900 : 28800); res.json({ ...sessionResponse({ id: admin.id, name: admin.name, email: admin.email, role: admin.role, organizationId: admin.organizationId, mustChangePassword: admin.mustChangePassword }, session), recoveryCodeUsed: recoveryUsed }); }
    catch (error) { if (error?.name === "TokenExpiredError" || error?.name === "JsonWebTokenError") return res.status(401).json({ error: "El desafío MFA expiró. Inicia sesión nuevamente." }); console.error("MFA challenge failed", error); res.status(500).json({ error: "No se pudo validar MFA" }); }
  });
}

export { registerSecurityRoutes, mfaEnabledForAdmin, challengeToken };

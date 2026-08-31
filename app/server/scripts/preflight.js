import "dotenv/config";
import pg from "pg";

const baseUrl = String(process.env.API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, "");
const required = ["DATABASE_URL"];
const missing = required.filter((key) => !String(process.env[key] || "").trim());

if (missing.length) {
  console.error(`PREFLIGHT FAIL · faltan variables: ${missing.join(", ")}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && String(process.env.JWT_SECRET || "").length < 32) {
  console.error("PREFLIGHT FAIL · JWT_SECRET debe tener al menos 32 caracteres en producción");
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  const publicSettings = ["FRONTEND_ORIGIN", "PUBLIC_API_URL", "PUBLIC_SITE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET"];
  const missingPublicSettings = publicSettings.filter((key) => !String(process.env[key] || "").trim());
  if (missingPublicSettings.length) {
    console.error(`PREFLIGHT FAIL · faltan variables de producción: ${missingPublicSettings.join(", ")}`);
    process.exit(1);
  }

  const localUrl = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i;
  const localUrls = ["FRONTEND_ORIGIN", "PUBLIC_API_URL", "PUBLIC_SITE_URL"].filter((key) => localUrl.test(String(process.env[key] || "")));
  if (localUrls.length) {
    console.error(`PREFLIGHT FAIL · las URLs de producción no pueden apuntar a localhost: ${localUrls.join(", ")}`);
    process.exit(1);
  }

  if (String(process.env.BOT_PROTECTION_REQUIRED || "").trim().toLowerCase() === "true") {
    const missingBotSettings = ["TURNSTILE_SECRET_KEY", "VITE_TURNSTILE_SITE_KEY"].filter((key) => !String(process.env[key] || "").trim());
    if (missingBotSettings.length) {
      console.error(`PREFLIGHT FAIL · faltan variables de Turnstile: ${missingBotSettings.join(", ")}`);
      process.exit(1);
    }
  }

  const calendarSettings = ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_REDIRECT_URI", "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"];
  const configuredCalendarSettings = calendarSettings.filter((key) => String(process.env[key] || "").trim());
  if (configuredCalendarSettings.length > 0 && configuredCalendarSettings.length < calendarSettings.length) {
    console.warn(`PREFLIGHT WARN · Google Calendar pendiente; faltan: ${calendarSettings.filter((key) => !String(process.env[key] || "").trim()).join(", ")}`);
  }
  if (configuredCalendarSettings.length > 0 && localUrl.test(String(process.env.GOOGLE_CALENDAR_REDIRECT_URI || ""))) {
    console.warn("PREFLIGHT WARN · GOOGLE_CALENDAR_REDIRECT_URI apunta a localhost; OAuth no funcionará en producción hasta corregirlo");
  }
}

try {
  const response = await fetch(`${baseUrl}/api/health`);
  const payload = await response.json();
  const healthy = response.ok && payload.ok === true && payload.database === "connected" && ["available", "supabase"].includes(payload.storage);
  if (!healthy) {
    console.error("PREFLIGHT FAIL · el API no está listo", JSON.stringify(payload));
    process.exit(1);
  }
  console.log(`PREFLIGHT PASS · API ${baseUrl}`);
  console.log(`database=${payload.database} storage=${payload.storage} publicApiConfigured=${payload.publicApiConfigured}`);
  if (process.env.NODE_ENV === "production") {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const result = await pool.query("SELECT COUNT(*)::int AS count FROM vehicle_media WHERE media_type='model_3d' AND is_active=TRUE AND url ~* 'https?://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?/'");
      if (Number(result.rows[0]?.count || 0) > 0) {
        console.error(`PREFLIGHT FAIL · hay ${result.rows[0].count} referencias 3D apuntando a localhost. Ejecuta npm run migrate:3d -- --apply con Storage configurado antes de publicar.`);
        process.exit(1);
      }
      console.log("3dReferences=production-safe");
    } finally {
      await pool.end();
    }
  }
} catch (error) {
  console.error(`PREFLIGHT FAIL · no se pudo consultar ${baseUrl}: ${error.message}`);
  process.exit(1);
}

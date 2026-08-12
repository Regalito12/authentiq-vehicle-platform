import "dotenv/config";

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
} catch (error) {
  console.error(`PREFLIGHT FAIL · no se pudo consultar ${baseUrl}: ${error.message}`);
  process.exit(1);
}

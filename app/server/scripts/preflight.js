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

try {
  const response = await fetch(`${baseUrl}/api/health`);
  const payload = await response.json();
  const healthy = response.ok && payload.ok === true && payload.database === "connected" && payload.storage === "available";
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

import "dotenv/config";
import { assertSafeQaTarget, qaDatabaseUrl } from "./qa-safety.mjs";

const databaseUrl = qaDatabaseUrl();
assertSafeQaTarget({ databaseUrl, operation: "La prevalidación QA" });

const required = [
  "QA_SUPABASE_URL",
  "QA_SUPABASE_SERVICE_ROLE_KEY",
  "QA_TEST_URL",
  "QA_TEST_ADMIN_EMAIL",
  "QA_TEST_ADMIN_PASSWORD",
];
const missing = required.filter((key) => !String(process.env[key] || "").trim());
if (missing.length) throw new Error(`QA incompleto: faltan ${missing.join(", ")}. No se imprimieron secretos.`);

console.log("QA PREFLIGHT PASS · destino declarado como QA, base y credenciales de prueba presentes.");

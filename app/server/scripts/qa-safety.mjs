function isLocalTarget(value = "") {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(String(value).trim());
}

function isCanonicalProduction(value = "") {
  return /(^|[/:.])zevroa\.com(?::|\/|$)/i.test(String(value));
}

/**
 * Las pruebas de roles, aislamiento y restauración crean o sobrescriben datos.
 * Un destino remoto exige una declaración explícita de QA: nunca basta con que
 * una URL "parezca" no productiva.
 */
export function assertSafeQaTarget({ target = "", operation = "esta operación", databaseUrl = "" } = {}) {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error(`${operation} se negó porque NODE_ENV=production.`);
  }
  if (isCanonicalProduction(target) || isCanonicalProduction(databaseUrl)) {
    throw new Error(`${operation} se negó porque el destino parece ser zevroa.com (producción).`);
  }
  if (isLocalTarget(target) && !databaseUrl) return;
  if (String(process.env.QA_ENVIRONMENT || "").toLowerCase() !== "qa" || process.env.ZEVROA_QA_CONFIRMATION !== "zevroa-qa") {
    throw new Error(`${operation} requiere QA_ENVIRONMENT=qa y ZEVROA_QA_CONFIRMATION=zevroa-qa.`);
  }
}

export function qaDatabaseUrl() {
  const value = String(process.env.QA_DATABASE_URL || "").trim();
  if (!value) throw new Error("QA_DATABASE_URL es obligatorio para ejecutar esta prueba fuera de local.");
  return value;
}

export function isLocalUrl(value = "") {
  return isLocalTarget(value);
}

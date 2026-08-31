import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(scriptDir, "../../database");
const manifestPath = path.join(databaseDir, "migration-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const files = (await fs.readdir(databaseDir)).filter((file) => /^\d{3}_.+\.sql$/i.test(file)).sort();
const tracked = Array.isArray(manifest.trackedMigrations) ? manifest.trackedMigrations : [];
const trackedNames = new Set(tracked.map((entry) => entry.file));
const errors = [];

if (!manifest?.baseline?.id) errors.push("falta baseline.id");
if (!Array.isArray(manifest?.baseline?.legacyDuplicatePrefixes)) errors.push("falta baseline.legacyDuplicatePrefixes");
if (!tracked.length) errors.push("no hay migraciones rastreadas");

const prefixMap = new Map();
for (const file of files) {
  const prefix = file.slice(0, 3);
  const values = prefixMap.get(prefix) || [];
  values.push(file);
  prefixMap.set(prefix, values);
}
const permittedLegacyDuplicates = new Set(manifest.baseline?.legacyDuplicatePrefixes || []);
for (const [prefix, groupedFiles] of prefixMap) {
  if (groupedFiles.length > 1 && !permittedLegacyDuplicates.has(prefix)) {
    errors.push(`prefijo duplicado no reconocido ${prefix}: ${groupedFiles.join(", ")}`);
  }
}

for (const entry of tracked) {
  if (!entry?.file || !entry?.sha256) { errors.push("entrada de manifiesto incompleta"); continue; }
  if (!files.includes(entry.file)) { errors.push(`no existe ${entry.file}`); continue; }
  const contents = await fs.readFile(path.join(databaseDir, entry.file));
  // Git conserva estos SQL con LF, pero Windows puede materializarlos como
  // CRLF por core.autocrlf. El manifiesto valida el contenido, no el sistema
  // operativo, así que el hash debe ser idéntico en local, CI y Vercel.
  const normalizedContents = contents.toString("utf8").replaceAll("\r\n", "\n");
  const actualHash = createHash("sha256").update(normalizedContents, "utf8").digest("hex");
  if (actualHash !== String(entry.sha256).toLowerCase()) errors.push(`checksum cambió en ${entry.file}`);
}

for (const file of files.filter((item) => Number(item.slice(0, 3)) >= 45)) {
  if (!trackedNames.has(file)) errors.push(`migración reciente sin manifiesto: ${file}`);
}

// Estar en el manifiesto no sirve de nada si el despliegue no la ejecuta: la 051
// quedó registrada y verificada, pero `migrate:production` no la invocaba y el
// código ya dependía de su columna. Cerrar el círculo aquí evita repetirlo.
const packageJsonPath = path.resolve(scriptDir, "../package.json");
let migrateProductionScript = "";
try {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  migrateProductionScript = String(packageJson?.scripts?.["migrate:production"] || "");
  if (!migrateProductionScript) errors.push("no existe el script migrate:production");
} catch {
  errors.push("no se pudo leer server/package.json");
}
if (migrateProductionScript) {
  for (const entry of tracked) {
    if (entry?.file && !migrateProductionScript.includes(entry.file)) {
      errors.push(`migrate:production no aplica ${entry.file}`);
    }
  }
}

if (errors.length) {
  console.error(`MIGRATION MANIFEST FAIL · ${errors.join(" | ")}`);
  process.exit(1);
}

console.log(`MIGRATION MANIFEST PASS · baseline=${manifest.baseline.id} tracked=${tracked.length} files=${files.length} aplicadas-en-despliegue=${tracked.length}`);

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || "vehicle-media").trim();
const outputRoot = path.resolve(process.env.STORAGE_BACKUP_DIR || path.join(process.cwd(), "backups", `storage-${new Date().toISOString().replace(/[:.]/g, "-")}`));

if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorios para respaldar Storage");
if (process.env.NODE_ENV === "production" && String(process.env.ALLOW_PRODUCTION_BACKUP || "false") !== "true") {
  throw new Error("El backup de Storage en producción requiere ALLOW_PRODUCTION_BACKUP=true explícito");
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const storageUrl = `${supabaseUrl}/storage/v1`;
const requestTimeoutMs = Number(process.env.STORAGE_BACKUP_TIMEOUT_MS || 30000);

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function listPrefix(prefix = "") {
  const response = await fetchWithTimeout(`${storageUrl}/object/list/${encodeURIComponent(bucket)}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (!response.ok) throw new Error(`No se pudo listar Storage (${response.status}) en ${prefix || "raíz"}`);
  return response.json();
}

async function readResponseBuffer(response) {
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const expectedBytes = Number(response.headers.get("content-length") || 0);
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Tiempo agotado leyendo Storage después de ${totalBytes} bytes`)), requestTimeoutMs)),
    ]);
    if (result.done) break;
    const chunk = Buffer.from(result.value);
    chunks.push(chunk);
    totalBytes += chunk.length;
    if (expectedBytes > 0 && totalBytes >= expectedBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  if (expectedBytes > 0 && totalBytes !== expectedBytes) {
    throw new Error(`Descarga incompleta de Storage: esperados ${expectedBytes}, recibidos ${totalBytes}`);
  }
  return Buffer.concat(chunks, totalBytes);
}

async function collectObjects() {
  const folders = [""];
  const objects = [];
  const visited = new Set();
  while (folders.length) {
    const prefix = folders.shift();
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    const entries = await listPrefix(prefix);
    console.log(`STORAGE LIST · prefix=${prefix || "raíz"} entries=${entries.length} pendientes=${folders.length}`);
    for (const entry of entries) {
      const name = String(entry.name || "");
      if (!name) continue;
      const fullPath = `${prefix}${name}`;
      if (entry.id) objects.push({ path: fullPath, size: Number(entry.metadata?.size || 0), contentType: entry.metadata?.mimetype || null });
      else folders.push(`${fullPath}/`);
    }
  }
  return objects;
}

await fs.mkdir(outputRoot, { recursive: true });
const objects = await collectObjects();
console.log(`STORAGE DOWNLOAD · objects=${objects.length}`);
const manifest = { bucket, createdAt: new Date().toISOString(), environment: process.env.NODE_ENV || "development", objectCount: objects.length, objects: [] };
let totalBytes = 0;
for (const object of objects) {
  const response = await fetchWithTimeout(`${storageUrl}/object/${encodeURIComponent(bucket)}/${object.path.split("/").map(encodeURIComponent).join("/")}`, { headers });
  if (!response.ok) throw new Error(`No se pudo descargar ${object.path} (${response.status})`);
  const buffer = await readResponseBuffer(response);
  const destination = path.join(outputRoot, "objects", ...object.path.split("/").filter(Boolean));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, buffer);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  totalBytes += buffer.length;
  manifest.objects.push({ ...object, size: buffer.length, sha256, file: path.relative(outputRoot, destination) });
  console.log(`STORAGE OBJECT · ${manifest.objects.length}/${objects.length} ${object.path}`);
}
manifest.totalBytes = totalBytes;
await fs.writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`STORAGE BACKUP PASS · bucket=${bucket} objects=${objects.length} bytes=${totalBytes} output=${outputRoot}`);

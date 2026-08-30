import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const inputRoot = path.resolve(process.env.STORAGE_BACKUP_DIR || process.argv[2] || "");
const supabaseUrl = String(process.env.QA_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(process.env.QA_SUPABASE_SERVICE_ROLE_KEY || "").trim();
const bucket = String(process.env.QA_SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || "vehicle-media").trim();
if (!inputRoot || inputRoot === path.parse(inputRoot).root) throw new Error("Indica STORAGE_BACKUP_DIR con la carpeta exacta del backup");
if (process.env.ALLOW_QA_STORAGE_RESTORE !== "true") throw new Error("La restauración exige ALLOW_QA_STORAGE_RESTORE=true");
if (!supabaseUrl || !serviceKey) throw new Error("QA_SUPABASE_URL y QA_SUPABASE_SERVICE_ROLE_KEY son obligatorios");
if (/zevroa\.com|vercel\.app/i.test(supabaseUrl)) throw new Error("La restauración QA no acepta una URL de producción");

const manifest = JSON.parse(await fs.readFile(path.join(inputRoot, "manifest.json"), "utf8"));
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "x-upsert": "true" };
for (const object of manifest.objects || []) {
  const buffer = await fs.readFile(path.join(inputRoot, object.file));
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  if (sha256 !== object.sha256) throw new Error(`Hash inválido en ${object.path}`);
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${object.path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", headers: { ...headers, "Content-Type": object.contentType || "application/octet-stream" }, body: buffer });
  if (!response.ok) throw new Error(`No se pudo restaurar ${object.path} (${response.status})`);
}
console.log(`QA STORAGE RESTORE PASS · bucket=${bucket} objects=${manifest.objects?.length || 0}`);

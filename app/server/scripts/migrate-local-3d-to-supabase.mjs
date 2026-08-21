import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, "..");
const uploadsDir = path.resolve(serverDir, process.env.UPLOADS_DIR || "../uploads");
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const bucket = String(process.env.SUPABASE_STORAGE_BUCKET || "vehicle-media").trim();
const apply = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es obligatorio");
if (apply && (!supabaseUrl || !serviceRoleKey)) {
  throw new Error("Para aplicar la migración necesitas SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
}

function publicUrl(objectPath) {
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".gltf": "model/gltf+json",
    ".glb": "model/gltf-binary",
    ".bin": "application/octet-stream",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ktx2": "image/ktx2",
  })[extension] || "application/octet-stream";
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function upload(filePath, objectPath) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": contentType(filePath),
      "x-upsert": "true",
    },
    body: await fs.readFile(filePath),
  });
  if (!response.ok) throw new Error(`Storage ${response.status}: ${(await response.text()).slice(0, 220)}`);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(`
    SELECT vm.id, vm.vehicle_id AS "vehicleId", vm.url, b.name AS brand, v.model
    FROM vehicle_media vm
    JOIN vehicles v ON v.id = vm.vehicle_id
    LEFT JOIN vehicle_brands b ON b.id = v.brand_id
    WHERE vm.media_type = 'model_3d'
      AND vm.is_active = TRUE
      AND vm.url LIKE '%/uploads/packages/%'
    ORDER BY b.name, v.model
  `);
  const rows = result.rows.map((row) => {
    const match = String(row.url).match(/\/uploads\/(packages\/[^?#]+)/i);
    const relative = match?.[1] || "";
    const localPath = path.resolve(uploadsDir, relative);
    const relativeRoot = path.resolve(uploadsDir);
    if (!localPath.startsWith(`${relativeRoot}${path.sep}`)) throw new Error(`Ruta de media insegura: ${row.url}`);
    return { ...row, relative, localPath, nextUrl: publicUrl(`uploads/${relative}`) };
  });
  const missing = rows.filter((row) => !row.relative);
  const files = new Map();
  for (const row of rows) {
    const packageRoot = path.dirname(row.localPath);
    const packageFiles = await walk(packageRoot).catch(() => []);
    for (const filePath of packageFiles) {
      const relative = path.relative(uploadsDir, filePath).split(path.sep).join("/");
      files.set(relative, filePath);
    }
  }

  console.log(`3D local encontrado: ${rows.length} referencias, ${files.size} archivos, ${missing.length} referencias inválidas.`);
  for (const row of rows) console.log(`${apply ? "PLAN" : "DRY-RUN"} ${row.brand} ${row.model} -> ${row.nextUrl}`);
  if (missing.length) throw new Error("Hay referencias 3D que no apuntan a un paquete válido");
  const packagesWithoutFiles = rows.filter((row) => ![...files.keys()].some((file) => file.startsWith(`${path.posix.dirname(row.relative)}/`)));
  if (packagesWithoutFiles.length) {
    const names = packagesWithoutFiles.map((row) => `${row.brand || "Sin marca"} ${row.model}`).join(", ");
    console.warn(`No se encontraron archivos locales para ${packagesWithoutFiles.length} paquete(s): ${names}.`);
    if (apply) throw new Error("Migración detenida: faltan archivos físicos locales para uno o más paquetes 3D. No se actualizaron URLs.");
  }
  if (!apply) {
    console.log("Simulación terminada. No se subió ni se modificó nada. Usa --apply después de revisar el listado.");
    process.exitCode = 0;
  } else {
    for (const [relative, filePath] of files) {
      await upload(filePath, `uploads/${relative}`);
      console.log(`Subido: ${relative}`);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of rows) await client.query("UPDATE vehicle_media SET url = $1 WHERE id = $2", [row.nextUrl, row.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log(`Migración aplicada: ${rows.length} referencias actualizadas en vehicle_media.`);
  }
} finally {
  await pool.end();
}

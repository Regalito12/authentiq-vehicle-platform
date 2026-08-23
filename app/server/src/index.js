import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import fs from "node:fs/promises";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "node:path";
import pg from "pg";
import helmet from "helmet";
import { initMonitoring, reportServerError } from "./monitoring.js";
import { catalogPrerender, vehiclePrerender, catalogJsonLd, vehicleJsonLd } from "./prerender.js";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const app = express();
const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDir, "../.env") });
const port = Number(process.env.PORT || 3001);
const privacyPolicyVersion = process.env.PRIVACY_POLICY_VERSION || "2026-08-09";
const jwtSecret = process.env.JWT_SECRET || "local-dev-secret-change-before-deploy";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) throw new Error("JWT_SECRET es obligatorio en producción");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uploadsDir = path.resolve(serverDir, process.env.UPLOADS_DIR || "../uploads");
const publicApiUrl = String(process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || "").replace(/\/+$/, "");
const frontendOrigin = String(process.env.FRONTEND_ORIGIN || "").trim();
// Dominio base blanco-etiqueta: cada dealer recibe automáticamente <slug>.<PLATFORM_BASE_DOMAIN>
// sin comprar ni configurar nada. Requiere un registro DNS comodín (*.dominio) apuntando a este
// servicio y el dominio comodín agregado en Render — eso es manual, fuera de este código.
const platformBaseDomain = String(process.env.PLATFORM_BASE_DOMAIN || "").trim().toLowerCase().replace(/^\.+/, "");
function subdomainForSlug(slug) {
  return platformBaseDomain ? `${slug}.${platformBaseDomain}` : null;
}
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseServiceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const supabaseStorageBucket = String(process.env.SUPABASE_STORAGE_BUCKET || "vehicle-media").trim();
const remoteStorageEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey && supabaseStorageBucket);
const rodinApiKey = String(process.env.RODIN_API_KEY || "").trim();
const rodinApiBaseUrl = String(process.env.RODIN_API_URL || "https://api.hyper3d.com/api/v2").replace(/\/+$/, "");
const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || "").trim();
const emailDeliveryConfigured = Boolean(resendApiKey && resendFromEmail);
const botProtectionRequired = String(process.env.BOT_PROTECTION_REQUIRED || "false").trim().toLowerCase() === "true";
const turnstileSecretKey = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
const billingProvider = String(process.env.BILLING_PROVIDER || "none").trim().toLowerCase();
const billingCheckoutUrl = String(process.env.BILLING_CHECKOUT_URL || "").trim();
const metaAppConfigured = Boolean(String(process.env.META_APP_ID || "").trim() && String(process.env.META_APP_SECRET || "").trim());
const googleCalendarConfigured = Boolean(String(process.env.GOOGLE_CALENDAR_CLIENT_ID || "").trim() && String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "").trim());
const googleCalendarTokenKey = String(process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY || "").trim();
const googleCalendarRedirectUri = String(process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${publicApiUrl || `http://localhost:${port}`}/api/integrations/google-calendar/callback`).trim();
const googleCalendarScope = "https://www.googleapis.com/auth/calendar.events";
if (process.env.NODE_ENV === "production") {
  if (jwtSecret.length < 32) throw new Error("JWT_SECRET debe tener al menos 32 caracteres en producción");
  if (!publicApiUrl || !publicSiteUrl || !frontendOrigin || /localhost|127\.0\.0\.1/i.test(`${publicApiUrl} ${publicSiteUrl} ${frontendOrigin}`)) throw new Error("PUBLIC_API_URL, PUBLIC_SITE_URL y FRONTEND_ORIGIN deben apuntar al dominio de producción");
  if (!remoteStorageEnabled) throw new Error("Supabase Storage es obligatorio en producción; no se permite almacenamiento temporal");
  if (botProtectionRequired && !turnstileSecretKey) throw new Error("TURNSTILE_SECRET_KEY es obligatorio cuando BOT_PROTECTION_REQUIRED=true");
  if (googleCalendarConfigured && !googleCalendarTokenKey) throw new Error("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY es obligatorio cuando Google Calendar está configurado");
}
app.set("trust proxy", 1);
await fs.mkdir(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.mimetype)),
});
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedMimeTypesByExtension = {
      ".jpg": ["image/jpeg"], ".jpeg": ["image/jpeg"], ".png": ["image/png"], ".webp": ["image/webp"], ".avif": ["image/avif"],
      ".mp4": ["video/mp4", "application/octet-stream"], ".webm": ["video/webm", "application/octet-stream"], ".mov": ["video/quicktime", "application/octet-stream"],
      ".glb": ["model/gltf-binary", "application/octet-stream"], ".gltf": ["model/gltf+json", "application/json", "text/plain", "application/octet-stream"],
    };
    callback(null, Boolean(allowedMimeTypesByExtension[extension]?.includes(file.mimetype)));
  },
});
const mediaPackageStorage = multer.diskStorage({
  destination: (req, _file, callback) => {
    req.mediaPackageId ||= `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const packageDir = path.join(uploadsDir, "packages", req.mediaPackageId);
    fs.mkdir(packageDir, { recursive: true }).then(() => callback(null, packageDir)).catch(callback);
  },
  filename: (req, file, callback) => {
    const relativePath = sanitizeMediaRelativePath(file.originalname);
    if (!relativePath) return callback(new Error("Ruta de archivo no válida"));
    const packageDir = path.join(uploadsDir, "packages", req.mediaPackageId);
    fs.mkdir(path.dirname(path.join(packageDir, relativePath)), { recursive: true })
      .then(() => callback(null, relativePath))
      .catch(callback);
  },
});
const mediaPackageUpload = multer({
  storage: mediaPackageStorage,
  preservePath: true,
  limits: { fileSize: 120 * 1024 * 1024, files: 80 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = [".gltf", ".glb", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".avif"];
    callback(null, allowedExtensions.includes(extension));
  },
});
const vehicle3dGenerationUpload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, callback) => callback(null, `3d-source-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.mimetype)),
});

function sanitizeMediaRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== "." && part !== "..");
  if (!parts.length || parts.some((part) => /[\u0000-\u001f]/.test(part))) return "";
  return parts.join("/");
}

function gltfReferencePath(entryPath, uri) {
  const cleanUri = String(uri || "").split(/[?#]/, 1)[0];
  if (!cleanUri || cleanUri.startsWith("data:") || cleanUri.startsWith("blob:")) return "";
  const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(entryPath), cleanUri.replace(/\\/g, "/")));
  return candidate === ".." || candidate.startsWith("../") ? "" : candidate;
}

async function inspectGltfManifest(filePath, entryPath, availablePaths = new Set()) {
  const document = JSON.parse(await fs.readFile(filePath, "utf8"));
  const references = [
    ...(Array.isArray(document.buffers) ? document.buffers : []).map((item) => item?.uri),
    ...(Array.isArray(document.images) ? document.images : []).map((item) => item?.uri),
  ].filter(Boolean).map((uri) => gltfReferencePath(entryPath, uri)).filter(Boolean);
  const missing = [...new Set(references.filter((reference) => !availablePaths.has(reference)))];
  return { references: [...new Set(references)], missing };
}

// Reúne todo lo que está realmente en uso para no borrar nunca un archivo vivo.
async function collectReferencedUploads() {
  const referenced = new Set();
  const add = (url) => {
    const filePath = localUploadPath(url);
    if (!filePath) return;
    const relative = path.relative(uploadsDir, filePath).split(path.sep).join("/");
    referenced.add(relative);
    // Un GLTF dentro de un paquete mantiene vivo todo su paquete (bin + texturas).
    if (relative.startsWith("packages/")) referenced.add(`packages/${relative.split("/")[1]}`);
  };
  const [images, media, posts, settings] = await Promise.all([
    pool.query("SELECT image_url FROM vehicle_images"),
    pool.query("SELECT url, poster_url FROM vehicle_media"),
    pool.query("SELECT cover_image_url FROM blog_posts WHERE cover_image_url IS NOT NULL"),
    pool.query("SELECT logo_url FROM organization_settings WHERE logo_url IS NOT NULL"),
  ]);
  images.rows.forEach((row) => add(row.image_url));
  media.rows.forEach((row) => { add(row.url); add(row.poster_url); });
  posts.rows.forEach((row) => add(row.cover_image_url));
  settings.rows.forEach((row) => add(row.logo_url));
  return referenced;
}

// Borra medios que ya no referencia ningún registro. El periodo de gracia protege
// los archivos recién subidos que todavía no se han guardado en un vehículo.
async function cleanupOrphanUploads({ graceMinutes = 60, dryRun = false } = {}) {
  const referenced = await collectReferencedUploads();
  const cutoff = Date.now() - graceMinutes * 60 * 1000;
  const removed = [];
  let freedBytes = 0;
  const consider = async (relative, absolute) => {
    if (referenced.has(relative)) return;
    const stats = await fs.stat(absolute);
    if (stats.mtimeMs > cutoff) return;
    const size = stats.isDirectory() ? await directorySize(absolute) : stats.size;
    removed.push(relative);
    freedBytes += size;
    if (!dryRun) await fs.rm(absolute, { recursive: true, force: true });
  };
  for (const entry of await fs.readdir(uploadsDir, { withFileTypes: true })) {
    if (entry.name === "packages") continue;
    if (entry.isFile()) await consider(entry.name, path.join(uploadsDir, entry.name));
  }
  const packagesDir = path.join(uploadsDir, "packages");
  try {
    for (const entry of await fs.readdir(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) await consider(`packages/${entry.name}`, path.join(packagesDir, entry.name));
    }
  } catch { /* todavía no existe la carpeta de paquetes */ }
  return { removed, freedBytes, dryRun };
}

async function directorySize(directory) {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(full) : (await fs.stat(full)).size;
  }
  return total;
}

async function optimizeUploadedImage(file) {
  if (!file?.mimetype?.startsWith("image/")) return file;
  const optimizedFilename = `${path.basename(file.filename, path.extname(file.filename))}-optimized.webp`;
  const optimizedPath = path.join(path.dirname(file.path), optimizedFilename);
  try {
    await sharp(file.path)
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(optimizedPath);
    await fs.unlink(file.path).catch(() => {});
    const stats = await fs.stat(optimizedPath);
    return { ...file, filename: optimizedFilename, path: optimizedPath, size: stats.size, mimetype: "image/webp" };
  } catch (error) {
    await fs.unlink(optimizedPath).catch(() => {});
    console.error("Image optimization failed; keeping original", error);
    return file;
  }
}

async function isValidImageUpload(file) {
  if (!file) return false;
  const extension = path.extname(file.originalname || "").toLowerCase();
  const imageLike = file.mimetype?.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".avif"].includes(extension);
  if (!imageLike) return true;
  try {
    await sharp(file.path).metadata();
    return true;
  } catch {
    await fs.unlink(file.path).catch(() => {});
    return false;
  }
}

async function isValidMediaUpload(file) {
  if (!file || !(await isValidImageUpload(file))) return false;
  const extension = path.extname(file.originalname || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".avif"].includes(extension)) return true;
  try {
    const handle = await fs.open(file.path, "r");
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    await handle.close();
    const sample = header.subarray(0, bytesRead);
    if (extension === ".glb") return sample.subarray(0, 4).toString("ascii") === "glTF";
    if (extension === ".gltf") {
      const document = JSON.parse(await fs.readFile(file.path, "utf8"));
      return String(document?.asset?.version || "").startsWith("2");
    }
    if ([".mp4", ".mov"].includes(extension)) return sample.subarray(4, 8).toString("ascii") === "ftyp";
    if (extension === ".webm") return sample.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  } catch {
    // Se elimina abajo para que un archivo inválido nunca quede disponible localmente.
  }
  await fs.unlink(file.path).catch(() => {});
  return false;
}

async function removeMediaPackage(packageId) {
  if (packageId && /^[a-z0-9-]+$/i.test(packageId)) await fs.rm(path.join(uploadsDir, "packages", packageId), { recursive: true, force: true });
}

function storageObjectPath(value) {
  return String(value || "").split("/").map((part) => encodeURIComponent(part)).join("/");
}

function storagePublicUrl(objectPath) {
  if (!remoteStorageEnabled) return "";
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(supabaseStorageBucket)}/${storageObjectPath(objectPath)}`;
}

async function uploadBufferToSupabase(buffer, objectPath, contentType) {
  const endpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseStorageBucket)}/${storageObjectPath(objectPath)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      apikey: supabaseServiceRoleKey,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: buffer,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase Storage respondió ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return storagePublicUrl(objectPath);
}

async function uploadFileToConfiguredStorage(file, objectPath) {
  if (!remoteStorageEnabled) {
    const mediaOrigin = publicApiUrl || "";
    return `${mediaOrigin}/uploads/${objectPath.replace(/^uploads\//, "")}`;
  }
  const buffer = await fs.readFile(file.path);
  return uploadBufferToSupabase(buffer, objectPath, file.mimetype);
}

async function removeSupabaseObject(objectPath) {
  if (!remoteStorageEnabled || !objectPath) return;
  const endpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseStorageBucket)}/${storageObjectPath(objectPath)}`;
  await fetch(endpoint, { method: "DELETE", headers: { Authorization: `Bearer ${supabaseServiceRoleKey}`, apikey: supabaseServiceRoleKey } }).catch(() => {});
}

async function rodinRequest(endpoint, options = {}) {
  if (!rodinApiKey) {
    const error = new Error("El proveedor de generación 3D no está configurado. Añade RODIN_API_KEY al servidor.");
    error.code = "3D_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetch(`${rodinApiBaseUrl}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${rodinApiKey}`, ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) {
    const detail = payload?.message || payload?.error || text;
    const error = new Error(`El proveedor 3D respondió ${response.status}${detail ? `: ${String(detail).slice(0, 220)}` : ""}`);
    error.code = "3D_PROVIDER_ERROR";
    throw error;
  }
  return payload;
}

async function submitRodinGeneration(files) {
  const body = new FormData();
  for (const file of files) {
    const buffer = await fs.readFile(file.path);
    body.append("images", new Blob([buffer], { type: file.mimetype }), file.originalname);
  }
  body.append("geometry_file_format", "glb");
  body.append("material", "PBR");
  body.append("quality", "medium");
  body.append("preview_render", "true");
  const payload = await rodinRequest("/rodin", { method: "POST", body });
  const data = payload?.data || payload;
  const taskId = data?.uuid || data?.task_uuid || data?.taskUuid;
  const subscriptionKey = data?.jobs?.subscription_key || data?.subscription_key || data?.subscriptionKey;
  if (!taskId || !subscriptionKey) throw new Error("El proveedor 3D no devolvió los identificadores del trabajo");
  return { taskId: String(taskId), subscriptionKey: String(subscriptionKey) };
}

async function checkRodinGeneration(subscriptionKey) {
  const payload = await rodinRequest("/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription_key: subscriptionKey }),
  });
  const data = payload?.data || payload;
  return { status: String(data?.status || data?.jobs?.status || "").toLowerCase(), raw: data };
}

function providerDownloadLinks(payload) {
  const links = [];
  const visit = (value, key = "", depth = 0) => {
    if (!value || depth > 5) return;
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      links.push({ url: value, key: key.toLowerCase() });
      return;
    }
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key, depth + 1));
    if (typeof value === "object") Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey, depth + 1));
  };
  visit(payload);
  return [...new Map(links.map((item) => [item.url, item])).values()];
}

async function downloadRodinResults(taskId) {
  const payload = await rodinRequest("/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_uuid: taskId }),
  });
  const links = providerDownloadLinks(payload);
  const model = links.find((item) => /\.glb(?:[?#]|$)/i.test(item.url) || /glb|model|geometry/i.test(item.key));
  const preview = links.find((item) => /\.(?:webp|png|jpe?g)(?:[?#]|$)/i.test(item.url) || /preview|thumbnail|render/i.test(item.key));
  if (!model) throw new Error("El proveedor terminó el trabajo, pero no devolvió un archivo GLB");
  return { modelUrl: model.url, previewUrl: preview?.url || "" };
}

async function persistGenerated3dAsset(sourceUrl, organizationId, vehicleId, filename, contentType) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`No se pudo descargar el resultado 3D (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const objectPath = `uploads/generated-3d/${organizationId}/${vehicleId}/${Date.now()}-${filename}`;
  if (remoteStorageEnabled) return uploadBufferToSupabase(buffer, objectPath, contentType);
  const relativePath = objectPath.replace(/^uploads\//, "");
  const localPath = path.join(uploadsDir, relativePath);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, buffer);
  return `${publicApiUrl || ""}/uploads/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      // model-viewer usa WebAssembly para decodificar algunos modelos; esto
      // permite wasm sin abrir la puerta general de unsafe-eval.
      "script-src": ["'self'", "'wasm-unsafe-eval'", "https://challenges.cloudflare.com"],
      "frame-src": ["'self'", "https://challenges.cloudflare.com"],
      "worker-src": ["'self'", "blob:"],
      "img-src": ["'self'", "data:", "blob:", "https:"],
      "connect-src": ["'self'", "https:"],
      "media-src": ["'self'", "blob:", "https:"],
    },
  },
}));
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  next();
});
app.use(cors({ origin: frontendOrigin ? frontendOrigin.split(",").map((value) => value.trim()) : true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadsDir, {
  maxAge: "1y",
  immutable: true,
  etag: true,
  lastModified: true,
  setHeaders: (response, filePath) => {
    if (filePath.endsWith(".gltf")) response.setHeader("Content-Type", "model/gltf+json");
    if (filePath.endsWith(".glb")) response.setHeader("Content-Type", "model/gltf-binary");
  },
}));
// Los listados y operaciones del negocio son dinámicos: nunca deben quedar congelados
// por una caché intermedia después de guardar cambios en el backoffice.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api/customer/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiados intentos. Intenta nuevamente mas tarde." } }));
app.use("/api/customer/auth/register", rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiados registros. Intenta nuevamente mas tarde." } }));
app.use("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiados intentos. Intenta nuevamente más tarde." } }));
app.use("/api/auth/register-dealer", rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiados registros de dealer. Intenta nuevamente más tarde." } }));
app.use("/api/leads", rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiadas solicitudes. Intenta nuevamente más tarde." } }));
app.use("/api/offers", rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiadas ofertas enviadas. Intenta nuevamente más tarde." } }));
// La analítica escribe en base de datos sin autenticación: se limita para que no pueda inundarse.
app.use("/api/events", rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiados eventos." } }));
app.use("/api/public/quotes", rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiadas solicitudes para esta cotización." } }));

const vehicleSelect = `
  SELECT
    v.id,
    v.model,
    v.variant,
    v.year,
    v.condition,
    v.price_usd AS "priceUsd",
    v.engine,
    v.power,
    v.transmission,
    v.drive,
    v.fuel_type AS "fuelType",
    v.exterior_color AS "exteriorColor",
    v.interior_color AS "interiorColor",
    v.doors,
    v.seats,
    v.location,
    v.stock_number AS "stockNumber",
    v.warranty,
    v.features,
    v.mileage_km AS "mileageKm",
    v.description,
    v.seo_title AS "seoTitle",
    v.seo_description AS "seoDescription",
    v.stock,
    v.status,
    v.max_discount_percent AS "maxDiscountPercent",
    v.created_at AS "createdAt",
    b.name AS brand,
    b.logo_url AS "brandLogoUrl",
    c.name AS category,
    COALESCE(
      json_agg(
        json_build_object('id', vi.id, 'url', vi.image_url, 'altText', vi.alt_text, 'sortOrder', vi.sort_order)
        ORDER BY vi.sort_order
      ) FILTER (WHERE vi.id IS NOT NULL),
      '[]'::json
    ) AS images,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'id', vm.id,
            'type', vm.media_type,
            'url', vm.url,
            'posterUrl', vm.poster_url,
            'altText', vm.alt_text,
            'sortOrder', vm.sort_order,
            'metadata', vm.metadata
          ) ORDER BY vm.sort_order
        )
        FROM vehicle_media vm
        WHERE vm.vehicle_id = v.id AND vm.is_active = TRUE
      ),
      '[]'::json
    ) AS media
  FROM vehicles v
  JOIN vehicle_brands b ON b.id = v.brand_id
  LEFT JOIN vehicle_categories c ON c.id = v.category_id
  LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
`;

// Con una contraseña restablecida por un administrador, la única acción permitida
// es que el propio usuario defina su contraseña nueva. Todo lo demás queda bloqueado
// aunque el token sea válido, para que un reseteo no deje una sesión operando con
// una contraseña que el titular de la cuenta nunca eligió.
const PASSWORD_CHANGE_PATH = "/api/auth/change-password";
const ADMIN_SESSION_COOKIE = "authentiq_admin_session";
const CUSTOMER_SESSION_COOKIE = "authentiq_customer_session";
const DEFAULT_ORGANIZATION_SLUG = String(process.env.DEFAULT_ORGANIZATION_SLUG || "authentiq").trim().toLowerCase();

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((item) => item.trim().split("="));
  const match = cookies.find(([key]) => key === name);
  if (!match) return "";
  try { return decodeURIComponent(match.slice(1).join("=")); } catch { return ""; }
}

function setSessionCookie(res, name, token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearSessionCookie(res, name) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function requestHostname(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().split(":")[0].toLowerCase();
}

function publicOriginForOrganization(req, organization) {
  if (organization?.customDomain) return `https://${String(organization.customDomain).replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  const hostname = requestHostname(req);
  if (!hostname || ["localhost", "127.0.0.1", "::1"].includes(hostname)) return publicSiteUrl || `${req.protocol}://${req.get("host")}`;
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return `${forwardedProtocol === "https" || process.env.NODE_ENV === "production" ? "https" : req.protocol}://${hostname}`;
}

function absolutePublicAsset(origin, value) {
  const clean = String(value || "").trim();
  if (/^https?:\/\//i.test(clean)) return clean;
  return `${origin}${clean.startsWith("/") ? clean : "/assets/hero-highway.webp"}`;
}

async function verifyPublicForm(req, res, next) {
  const honeypot = String(req.body?.companyWebsite || req.body?.website || "").trim();
  if (honeypot) return res.status(400).json({ error: "No se pudo validar el envío" });
  if (!turnstileSecretKey) {
    if (botProtectionRequired) return res.status(503).json({ error: "La protección del formulario no está disponible. Intenta más tarde." });
    return next();
  }
  const token = String(req.body?.turnstileToken || "").trim();
  if (!token) return res.status(400).json({ error: "Completa la verificación de seguridad antes de enviar" });
  try {
    const body = new URLSearchParams({ secret: turnstileSecretKey, response: token });
    const remoteIp = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json().catch(() => ({}));
    const expectedHostname = requestHostname(req);
    if (!response.ok || !result?.success || (result.hostname && expectedHostname && String(result.hostname).toLowerCase() !== expectedHostname)) {
      return res.status(400).json({ error: "No pudimos validar la verificación de seguridad. Intenta nuevamente." });
    }
    return next();
  } catch (error) {
    console.error("Turnstile verification failed", error);
    return res.status(503).json({ error: "La verificación de seguridad no está disponible. Intenta más tarde." });
  }
}

// Vista previa privada: el propio dealer autenticado puede ver su showroom aunque el
// host no resuelva a su organización (sin dominio propio todavía, o pendiente de
// aprobación). Se basa solo en el JWT de la sesión, nunca en un slug enviado por el
// cliente, así que un dealer nunca puede previsualizar la organización de otro.
function previewOrganizationId(req) {
  if (String(req.headers["x-preview-mode"] || "") !== "1") return null;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : readCookie(req, ADMIN_SESSION_COOKIE);
  if (!token) return null;
  try { return jwt.verify(token, jwtSecret).organizationId || null; } catch { return null; }
}

async function getOrganizationContext(req) {
  if (req.organizationContext) return req.organizationContext;
  const previewId = previewOrganizationId(req);
  if (previewId) {
    const preview = await pool.query(
      `SELECT id, slug, name, logo_url AS "logoUrl", custom_domain AS "customDomain", is_active AS "isActive"
       FROM organizations WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [previewId],
    );
    if (preview.rowCount) { req.organizationContext = preview.rows[0]; return req.organizationContext; }
  }
  const hostname = requestHostname(req);
  // Los dominios reales se resuelven por host. El header solo existe para la
  // demostración local en localhost. En el dominio central sí permitimos el
  // selector público ?dealer=slug, pero únicamente contra dealers activos y
  // aprobados; un dominio propio nunca puede cambiar de tenant por querystring.
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  const requestedLocalTenant = String(req.headers["x-authentiq-tenant"] || "").trim().toLowerCase();
  const localTenantSlug = localHost && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(requestedLocalTenant) ? requestedLocalTenant : null;
  const localSlug = localTenantSlug || (/\.(?:localhost|test)$/.test(hostname) ? hostname.split(".")[0] : null);
  let configuredPublicHostname = "";
  try { configuredPublicHostname = new URL(publicSiteUrl).hostname.toLowerCase(); } catch { configuredPublicHostname = ""; }
  const canSelectPublicDealer = Boolean(localHost || (configuredPublicHostname && hostname === configuredPublicHostname));
  const requestedPublicTenant = canSelectPublicDealer && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(String(req.query?.dealer || "").trim().toLowerCase())
    ? String(req.query.dealer).trim().toLowerCase()
    : null;
  const resolvedSlug = localSlug || requestedPublicTenant;
  const allowUnapprovedSlug = Boolean(localSlug || (requestedPublicTenant && requestedPublicTenant === DEFAULT_ORGANIZATION_SLUG));
  // Subdominio blanco-etiqueta automático: <slug>.<PLATFORM_BASE_DOMAIN>, sin dominio propio.
  // Igual que un dominio propio, exige approval_status='approved' — un dealer pendiente no
  // se ve ahí, solo por vista previa privada.
  const subdomainSlug = platformBaseDomain && hostname.endsWith(`.${platformBaseDomain}`)
    ? hostname.slice(0, -(platformBaseDomain.length + 1))
    : null;
  const validSubdomainSlug = subdomainSlug && /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(subdomainSlug) ? subdomainSlug : null;
  const result = await pool.query(
    `SELECT id, slug, name, logo_url AS "logoUrl", custom_domain AS "customDomain", is_active AS "isActive"
     FROM organizations
      WHERE is_active = TRUE
        AND (
          (LOWER(custom_domain) = $1 AND approval_status = 'approved')
          OR (slug = $5 AND approval_status = 'approved')
          OR (slug = COALESCE($2, $3) AND (approval_status = 'approved' OR $4::boolean))
        )
      ORDER BY CASE WHEN LOWER(custom_domain) = $1 THEN 0 WHEN slug = $5 THEN 1 ELSE 2 END
      LIMIT 1`,
    [hostname, resolvedSlug, DEFAULT_ORGANIZATION_SLUG, allowUnapprovedSlug, validSubdomainSlug],
  );
  if (!result.rowCount) {
    const error = new Error("Organización no encontrada");
    error.code = "ORGANIZATION_NOT_FOUND";
    throw error;
  }
  req.organizationContext = result.rows[0];
  return req.organizationContext;
}

function isOrganizationNotFound(error) {
  return error?.code === "ORGANIZATION_NOT_FOUND";
}

function sendOrganizationNotFound(res) {
  return res.status(404).json({ error: "Dealer no encontrado", code: "ORGANIZATION_NOT_FOUND" });
}

function adminOrganizationId(req) {
  return req.admin?.organizationId || req.organizationContext?.id || null;
}

async function getOrganizationPlan(client, organizationId) {
  const result = await client.query(`
    SELECT COALESCE(bs.plan_code, 'starter') AS "planCode", COALESCE(bs.status, 'trialing') AS status,
           pp.name, pp.vehicle_limit AS "vehicleLimit", pp.monthly_amount AS "monthlyAmount"
    FROM organizations o
    LEFT JOIN billing_subscriptions bs ON bs.organization_id=o.id
    LEFT JOIN platform_plans pp ON pp.code=COALESCE(bs.plan_code, 'starter')
    WHERE o.id=$1
  `, [organizationId]);
  return result.rows[0] || { planCode: "starter", status: "trialing", name: "Starter", vehicleLimit: 40, monthlyAmount: 99 };
}

async function vehiclePlanGuard(client, organizationId, extraVehicles = 1) {
  const plan = await getOrganizationPlan(client, organizationId);
  if (plan.status === "cancelled") return { code: "SUBSCRIPTION_INACTIVE", error: "La suscripción está cancelada. Contacta al administrador de AUTHENTIQ para reactivarla." };
  const current = await client.query("SELECT COUNT(*)::int AS count FROM vehicles WHERE organization_id=$1 AND status <> 'inactive'", [organizationId]);
  const count = Number(current.rows[0]?.count || 0);
  const limit = plan.vehicleLimit === null || plan.vehicleLimit === undefined ? null : Number(plan.vehicleLimit);
  if (limit !== null && count + extraVehicles > limit) return { code: "PLAN_LIMIT", error: `El plan ${plan.name || plan.planCode} permite ${limit} vehículos activos. Actualiza el plan para agregar más.`, planCode: plan.planCode, limit, current: count };
  return null;
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : readCookie(req, ADMIN_SESSION_COOKIE);
  if (!token) return res.status(401).json({ error: "Autenticación requerida" });
  try {
    req.admin = jwt.verify(token, jwtSecret);
    const organization = await pool.query("SELECT organization_id AS \"organizationId\", is_active AS \"isActive\", role FROM admin_users WHERE id=$1", [req.admin.id]);
    if (!organization.rowCount || !organization.rows[0].isActive) return res.status(403).json({ error: "La cuenta administrativa no está activa" });
    req.admin.role = organization.rows[0].role;
    if (req.admin.role !== "platform_admin" && !organization.rows[0].organizationId) return res.status(403).json({ error: "La cuenta no tiene una organización activa asignada" });
    req.admin.organizationId = organization.rows[0].organizationId || null;
    if (req.admin.mustChangePassword && req.path !== PASSWORD_CHANGE_PATH) {
      return res.status(403).json({ error: "Debes definir una nueva contraseña antes de continuar", code: "MUST_CHANGE_PASSWORD" });
    }
    return next();
  } catch {
    return res.status(401).json({ error: "Sesión inválida o expirada" });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.admin?.role) ? next() : res.status(403).json({ error: "No tienes permisos para esta operación" });
}

function authenticateCustomer(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : readCookie(req, CUSTOMER_SESSION_COOKIE);
  if (!token) return res.status(401).json({ error: "Inicia sesión para continuar" });
  try {
    const customer = jwt.verify(token, jwtSecret);
    if (customer.kind !== "customer") throw new Error("Invalid customer token");
    req.customer = customer;
    return next();
  } catch {
    return res.status(401).json({ error: "La sesión del comprador expiró" });
  }
}

function getOptionalCustomerId(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const customer = jwt.verify(token, jwtSecret);
    return customer.kind === "customer" ? customer.id : null;
  } catch {
    return null;
  }
}

async function writeAudit(req, action, entityType, entityId = null, metadata = {}) {
  try {
    await pool.query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)", [req.admin?.id || null, action, entityType, entityId, metadata]);
  } catch (error) { console.error("Audit log failed", error); }
}

function vehiclePayload(body) {
  const media = Array.isArray(body.media) ? body.media.map((item) => ({
    type: ["video", "model_3d", "panorama_360"].includes(item?.type) ? item.type : null,
    url: String(item?.url || "").trim().slice(0, 2000),
    posterUrl: String(item?.posterUrl || "").trim().slice(0, 2000) || null,
    altText: String(item?.altText || "").trim().slice(0, 180) || null,
    metadata: item?.metadata && typeof item.metadata === "object" ? item.metadata : {},
  // 'procedural://' fue un marcador de una versión anterior que nunca apuntó a un archivo real:
  // se descarta al guardar para que el dato viejo se limpie solo.
  })).filter((item) => item.type && item.url && !item.url.startsWith("procedural://")).slice(0, 12) : [];
  return {
    brand: String(body.brand || "").trim(),
    brandLogoUrl: String(body.brandLogoUrl || "").trim().slice(0, 2000) || null,
    category: String(body.category || "").trim() || null,
    model: String(body.model || "").trim(),
    variant: String(body.variant || "").trim() || null,
    year: Number(body.year),
    condition: body.condition === "new" ? "new" : "used",
    priceUsd: Number(body.priceUsd),
    engine: String(body.engine || "").trim() || null,
    power: String(body.power || "").trim() || null,
    transmission: String(body.transmission || "").trim() || null,
    drive: String(body.drive || "").trim() || null,
    fuelType: String(body.fuelType || "").trim() || null,
    exteriorColor: String(body.exteriorColor || "").trim() || null,
    interiorColor: String(body.interiorColor || "").trim() || null,
    doors: body.doors === "" || body.doors == null ? null : Number(body.doors),
    seats: body.seats === "" || body.seats == null ? null : Number(body.seats),
    location: String(body.location || "").trim() || null,
    stockNumber: String(body.stockNumber || "").trim() || null,
    warranty: String(body.warranty || "").trim() || null,
    features: Array.isArray(body.features) ? body.features.map((item) => String(item).trim()).filter(Boolean).slice(0, 100) : [],
    mileageKm: Number(body.mileageKm || 0),
    description: String(body.description || "").trim() || null,
    seoTitle: String(body.seoTitle || "").trim() || null,
    seoDescription: String(body.seoDescription || "").trim() || null,
    stock: Number(body.stock || 0),
    status: ["draft", "pending_review", "published", "reserved", "sold", "inactive"].includes(body.status) ? body.status : "draft",
    maxDiscountPercent: Number(body.maxDiscountPercent || 0),
    images: Array.isArray(body.images) ? body.images.filter(Boolean).map(String) : [],
    imageAltTexts: Array.isArray(body.imageAltTexts) ? body.imageAltTexts.map((item) => String(item || "").trim().slice(0, 180)) : [],
    media,
  };
}

async function replaceVehicleMedia(client, vehicleId, media) {
  await client.query("DELETE FROM vehicle_media WHERE vehicle_id = $1", [vehicleId]);
  for (const [sortOrder, item] of media.entries()) {
    await client.query(
      "INSERT INTO vehicle_media (vehicle_id, media_type, url, poster_url, alt_text, sort_order, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [vehicleId, item.type, item.url, item.posterUrl, item.altText, sortOrder, item.metadata],
    );
  }
}

function validateVehicle(vehicle) {
  if (!vehicle.brand || !vehicle.model) return "Marca y modelo son obligatorios";
  if (vehicle.seoTitle && vehicle.seoTitle.length > 180) return "El título SEO es demasiado largo";
  if (vehicle.seoDescription && vehicle.seoDescription.length > 320) return "La descripción SEO es demasiado larga";
  if (!Number.isInteger(vehicle.year) || vehicle.year < 1900 || vehicle.year > 2200) return "El año no es válido";
  if (!Number.isFinite(vehicle.priceUsd) || vehicle.priceUsd < 0) return "El precio no es válido";
  if (!Number.isInteger(vehicle.mileageKm) || vehicle.mileageKm < 0) return "El kilometraje no es válido";
  if (!Number.isInteger(vehicle.stock) || vehicle.stock < 0) return "El stock no es valido";
  if (vehicle.doors != null && (!Number.isInteger(vehicle.doors) || vehicle.doors < 1 || vehicle.doors > 8)) return "La cantidad de puertas no es valida";
  if (vehicle.seats != null && (!Number.isInteger(vehicle.seats) || vehicle.seats < 1 || vehicle.seats > 20)) return "La cantidad de asientos no es valida";
  if (!Number.isFinite(vehicle.maxDiscountPercent) || vehicle.maxDiscountPercent < 0 || vehicle.maxDiscountPercent > 100) return "El descuento no es valido";
  if (["pending_review", "published"].includes(vehicle.status) && !vehicle.images.length) return "Un vehiculo en revision necesita al menos una imagen";
  if (["pending_review", "published"].includes(vehicle.status) && !vehicle.description) return "Un vehiculo en revision necesita una descripcion comercial";
  return null;
}

function slugify(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Debe producir exactamente la misma URL que `vehicleSlug` en el frontend (app/src/App.jsx).
function vehicleSlug(vehicle) {
  const base = slugify(`${vehicle.brand}-${vehicle.model}${vehicle.variant ? `-${vehicle.variant}` : ""}`);
  const suffix = String(vehicle.id || "").replace(/-/g, "").slice(0, 8);
  return suffix ? `${base}-${suffix}` : base;
}

// Traduce una URL p\u00fablica de /uploads a su ruta real en disco, sin permitir salir del directorio.
function localUploadPath(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  let pathname = value;
  if (/^https?:\/\//i.test(value)) { try { pathname = new URL(value).pathname; } catch { return ""; } }
  if (!pathname.startsWith("/uploads/")) return "";
  const relative = pathname.slice("/uploads/".length).split("/").map((part) => decodeURIComponent(part)).join("/");
  const sanitized = sanitizeMediaRelativePath(relative);
  if (!sanitized) return "";
  const resolved = path.resolve(uploadsDir, sanitized);
  const root = path.resolve(uploadsDir);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : "";
}

// Impide guardar un modelo 3D que el comprador no podr\u00eda cargar.
async function validateModel3dUrl(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  if (value.startsWith("procedural://")) return "El marcador 'procedural://' ya no es un modelo v\u00e1lido. Sube un archivo GLB o la carpeta GLTF completa.";
  const extension = path.extname(value.split(/[?#]/, 1)[0]).toLowerCase();
  if (![".glb", ".gltf"].includes(extension)) return "El modelo 3D debe ser un archivo .glb o .gltf";
  const filePath = localUploadPath(value);
  if (!filePath) return null; // Fuente externa: no se puede inspeccionar desde aqu\u00ed.
  try { await fs.access(filePath); } catch { return "El archivo del modelo 3D ya no existe en el servidor. Vuelve a subirlo."; }
  if (extension !== ".gltf") return null;
  try {
    const relativeEntry = path.relative(uploadsDir, filePath).split(path.sep).join("/");
    const manifest = await inspectGltfManifest(filePath, relativeEntry, new Set([relativeEntry]));
    const stillMissing = [];
    for (const reference of manifest.missing) {
      try { await fs.access(path.resolve(uploadsDir, reference)); } catch { stillMissing.push(reference); }
    }
    if (stillMissing.length) return `Este GLTF no puede mostrarse: le faltan ${stillMissing.length} archivo(s) como ${stillMissing.slice(0, 2).join(", ")}. Sube la carpeta completa o convi\u00e9rtelo a GLB.`;
  } catch { return "El archivo GLTF no contiene un manifiesto v\u00e1lido."; }
  return null;
}

function blogPayload(body) {
  const title = String(body.title || "").trim();
  return {
    title,
    slug: slugify(body.slug || title),
    summary: String(body.summary || "").trim() || null,
    content: String(body.content || "").trim(),
    coverImageUrl: String(body.coverImageUrl || "").trim() || null,
    seoTitle: String(body.seoTitle || title).trim() || null,
    seoDescription: String(body.seoDescription || body.summary || "").trim() || null,
    category: String(body.category || "").trim() || null,
    tags: Array.isArray(body.tags) ? body.tags.map((item) => String(item).trim()).filter(Boolean).slice(0, 12) : String(body.tags || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12),
    status: ["draft", "published", "archived"].includes(body.status) ? body.status : "draft",
  };
}

function quotePayload(body) {
  const basePriceUsd = Number(body.basePriceUsd);
  const discountUsd = Number(body.discountUsd || 0);
  return {
    leadId: String(body.leadId || "").trim() || null,
    vehicleId: String(body.vehicleId || "").trim() || null,
    customerName: String(body.customerName || "").trim(),
    customerEmail: String(body.customerEmail || "").trim() || null,
    customerPhone: String(body.customerPhone || "").trim() || null,
    basePriceUsd,
    discountUsd,
    totalUsd: Number((basePriceUsd - discountUsd).toFixed(2)),
    currency: String(body.currency || "USD").trim().toUpperCase().slice(0, 8),
    validUntil: String(body.validUntil || "").trim() || null,
    notes: String(body.notes || "").trim() || null,
  };
}

function validateQuote(quote) {
  if (!quote.customerName) return "El nombre del cliente es obligatorio";
  if (!Number.isFinite(quote.basePriceUsd) || quote.basePriceUsd < 0) return "El precio base no es válido";
  if (!Number.isFinite(quote.discountUsd) || quote.discountUsd < 0 || quote.discountUsd > quote.basePriceUsd) return "El descuento no es válido";
  if (quote.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(quote.validUntil)) return "La vigencia no es válida";
  return null;
}

function createQuoteNumber() {
  return `AUTH-${new Date().getFullYear()}-${Date.now()}`;
}

async function upsertTaxonomy(client, table, name, logoUrl = null, organizationId = null) {
  if (!name) return null;
  const isBrandTable = table === "vehicle_brands";
  const result = await client.query(
    isBrandTable
      ? `INSERT INTO ${table} (organization_id, name, logo_url) VALUES ($1, $2, $3) ON CONFLICT (organization_id, name) DO UPDATE SET is_active = TRUE, logo_url = COALESCE(EXCLUDED.logo_url, ${table}.logo_url) RETURNING id`
      : `INSERT INTO ${table} (organization_id, name) VALUES ($1, $2) ON CONFLICT (organization_id, name) DO UPDATE SET is_active = TRUE RETURNING id`,
    isBrandTable ? [organizationId, name, logoUrl] : [organizationId, name],
  );
  return result.rows[0].id;
}

function taxonomyName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

app.get("/api/admin/taxonomy", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  try {
    const organizationId = adminOrganizationId(req);
    const [brands, categories] = await Promise.all([
      pool.query(`SELECT b.id, b.name, b.logo_url AS "logoUrl", b.is_active AS "isActive", b.created_at AS "createdAt", COUNT(v.id)::int AS "vehicleCount" FROM vehicle_brands b LEFT JOIN vehicles v ON v.brand_id=b.id AND v.organization_id=$1 WHERE b.organization_id=$1 GROUP BY b.id ORDER BY b.is_active DESC, b.name`, [organizationId]),
      pool.query(`SELECT c.id, c.name, c.is_active AS "isActive", c.created_at AS "createdAt", COUNT(v.id)::int AS "vehicleCount" FROM vehicle_categories c LEFT JOIN vehicles v ON v.category_id=c.id AND v.organization_id=$1 WHERE c.organization_id=$1 GROUP BY c.id ORDER BY c.is_active DESC, c.name`, [organizationId]),
    ]);
    res.json({ data: { brands: brands.rows, categories: categories.rows } });
  } catch (error) { console.error("Taxonomy query failed", error); res.status(500).json({ error: "No se pudo cargar marcas y categorías" }); }
});

app.post("/api/admin/taxonomy/:kind", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const kind = req.params.kind === "brands" ? "brands" : req.params.kind === "categories" ? "categories" : null;
  const name = taxonomyName(req.body?.name);
  const logoUrl = String(req.body?.logoUrl || "").trim().slice(0, 2000) || null;
  if (!kind || name.length < 2) return res.status(400).json({ error: "Indica un nombre válido" });
  try {
    const table = kind === "brands" ? "vehicle_brands" : "vehicle_categories";
    const result = kind === "brands"
      ? await pool.query(`INSERT INTO ${table} (organization_id, name, logo_url, is_active) VALUES ($1,$2,$3,TRUE) ON CONFLICT (organization_id, name) DO UPDATE SET logo_url=COALESCE(EXCLUDED.logo_url, ${table}.logo_url), is_active=TRUE RETURNING id, name, logo_url AS "logoUrl", is_active AS "isActive"`, [adminOrganizationId(req), name, logoUrl])
      : await pool.query(`INSERT INTO ${table} (organization_id, name, is_active) VALUES ($1,$2,TRUE) ON CONFLICT (organization_id, name) DO UPDATE SET is_active=TRUE RETURNING id, name, is_active AS "isActive"`, [adminOrganizationId(req), name]);
    await writeAudit(req, `taxonomy.${kind}.create`, kind.slice(0, -1), result.rows[0].id, { name });
    res.status(201).json({ data: result.rows[0] });
  } catch (error) { console.error("Taxonomy create failed", error); res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Ese nombre ya existe" : "No se pudo guardar" }); }
});

app.patch("/api/admin/taxonomy/:kind/:id", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const kind = req.params.kind === "brands" ? "brands" : req.params.kind === "categories" ? "categories" : null;
  const name = taxonomyName(req.body?.name);
  const logoUrl = String(req.body?.logoUrl || "").trim().slice(0, 2000) || null;
  const isActive = req.body?.isActive !== false;
  if (!kind || name.length < 2) return res.status(400).json({ error: "Indica un nombre válido" });
  try {
    const table = kind === "brands" ? "vehicle_brands" : "vehicle_categories";
    const result = kind === "brands"
      ? await pool.query(`UPDATE ${table} SET name=$1, logo_url=$2, is_active=$3 WHERE id=$4 AND organization_id=$5 RETURNING id, name, logo_url AS "logoUrl", is_active AS "isActive"`, [name, logoUrl, isActive, req.params.id, adminOrganizationId(req)])
      : await pool.query(`UPDATE ${table} SET name=$1, is_active=$2 WHERE id=$3 AND organization_id=$4 RETURNING id, name, is_active AS "isActive"`, [name, isActive, req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Registro no encontrado" });
    await writeAudit(req, `taxonomy.${kind}.update`, kind.slice(0, -1), req.params.id, { name, isActive });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Taxonomy update failed", error); res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Ese nombre ya existe" : "No se pudo actualizar" }); }
});

// Sin paginación de catálogo en el frontend a propósito: AUTHENTIQ se posiciona como
// selección curada ("no llenamos el catálogo, seleccionamos lo que merece ser conducido"),
// no como un listado masivo. Este límite es solo una válvula de seguridad de escala:
// evita que una consulta sin filtro devuelva miles de filas con imágenes y medios si el
// inventario crece mucho más allá de lo que el negocio maneja hoy.
const CATALOG_SAFETY_LIMIT = 500;

async function listVehicles(includeInactive = false, organizationId = null) {
  const clauses = [`v.organization_id = $1`];
  if (!includeInactive) clauses.push("v.status IN ('published', 'reserved')");
  const result = await pool.query(`${vehicleSelect} WHERE ${clauses.join(" AND ")} GROUP BY v.id, b.name, b.logo_url, c.name ORDER BY v.created_at DESC LIMIT ${CATALOG_SAFETY_LIMIT}`, [organizationId]);
  return result.rows;
}

async function createLead({ organizationId, leadType, vehicleId = null, name, email = null, phone = null, message = null, source = "website", privacyConsent = false }) {
  const result = await pool.query(
    `INSERT INTO leads (organization_id, lead_type, vehicle_id, name, email, phone, message, source, privacy_consent, privacy_consent_at, privacy_policy_version, consent_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9 THEN NOW() ELSE NULL END,$10,$8)
     RETURNING id, status, created_at AS "createdAt"`,
    [organizationId, leadType, vehicleId, name, email, phone, message, source, privacyConsent, privacyPolicyVersion],
  );
  return result.rows[0];
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function sendCsv(res, filename, columns, rows) {
  const content = [columns.map((column) => csvCell(column.label)).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(","))].join("\r\n");
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` }).send(`\uFEFF${content}\r\n`);
}

function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? (hours * 60) + minutes : null;
}

function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

async function appointmentAvailability(date, organizationId) {
  const settingsResult = await pool.query(`SELECT appointment_timezone AS timezone, appointment_start AS "start", appointment_end AS "end", appointment_duration_minutes AS "durationMinutes", appointment_min_notice_hours AS "minNoticeHours", appointment_max_days_ahead AS "maxDaysAhead", appointment_days AS "days", appointment_capacity AS "capacity" FROM organization_settings WHERE organization_id=$1`, [organizationId]);
  const settings = settingsResult.rows[0] || { start: "09:00", end: "18:00", durationMinutes: 60, minNoticeHours: 2, maxDaysAhead: 30, days: [1, 2, 3, 4, 5, 6], capacity: 1 };
  const requestedDate = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAhead = Math.round((requestedDate - today) / 86400000);
  const dayOfWeek = requestedDate.getDay() || 7;
  const start = timeToMinutes(String(settings.start).slice(0, 5));
  const end = timeToMinutes(String(settings.end).slice(0, 5));
  const duration = Number(settings.durationMinutes) || 60;
  if (!isIsoDate(date) || daysAhead < 0 || daysAhead > Number(settings.maxDaysAhead) || !settings.days.includes(dayOfWeek) || start === null || end === null || end <= start) {
    return { date, timezone: settings.timezone || "America/Santo_Domingo", slots: [], capacity: Number(settings.capacity) || 1 };
  }
  const bookedResult = await pool.query(`SELECT requested_time AS "time", COUNT(*)::int AS count FROM test_drive_requests WHERE organization_id=$1 AND requested_date=$2 AND status IN ('pending','confirmed') GROUP BY requested_time`, [organizationId, date]);
  const booked = new Map(bookedResult.rows.map((row) => [String(row.time).slice(0, 5), Number(row.count)]));
  const blocksResult = await pool.query(`SELECT start_time AS "start", end_time AS "end" FROM appointment_blocks WHERE organization_id=$1 AND block_date=$2::date`, [organizationId, date]);
  const blocks = blocksResult.rows.map((block) => ({ start: block.start ? timeToMinutes(String(block.start).slice(0, 5)) : start, end: block.end ? timeToMinutes(String(block.end).slice(0, 5)) : end }));
  const slots = [];
  for (let minute = start; minute + duration <= end; minute += duration) {
    const time = minutesToTime(minute);
    const slotDate = new Date(`${date}T${time}:00`);
    const availableByNotice = slotDate.getTime() - Date.now() >= Number(settings.minNoticeHours || 0) * 3600000;
    const blocked = blocks.some((block) => minute < block.end && minute + duration > block.start);
    slots.push({ time, available: availableByNotice && !blocked && (booked.get(time) || 0) < Number(settings.capacity || 1), booked: booked.get(time) || 0, blocked, capacity: Number(settings.capacity || 1) });
  }
  return { date, timezone: settings.timezone || "America/Santo_Domingo", durationMinutes: duration, slots, capacity: Number(settings.capacity || 1) };
}

function escapeHtml(value) {
  return String(value || "").replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" })[char]);
}

function googleTokenKeyBuffer() {
  if (!googleCalendarTokenKey) return null;
  return /^[a-f0-9]{64}$/i.test(googleCalendarTokenKey) ? Buffer.from(googleCalendarTokenKey, "hex") : crypto.createHash("sha256").update(googleCalendarTokenKey).digest();
}

function encryptGoogleSecret(value) {
  const key = googleTokenKeyBuffer();
  if (!key || !value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptGoogleSecret(value) {
  const key = googleTokenKeyBuffer();
  const [ivValue, tagValue, encryptedValue] = String(value || "").split(".");
  if (!key || !ivValue || !tagValue || !encryptedValue) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  } catch { return null; }
}

function googleCalendarAuthorizationUrl(state) {
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID, redirect_uri: googleCalendarRedirectUri, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: googleCalendarScope, state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function googleTokenRequest(params) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error || "Google no pudo autorizar el calendario");
  return payload;
}

async function getGoogleCalendarAccess(organizationId) {
  const result = await pool.query("SELECT config FROM organization_integrations WHERE organization_id=$1 AND provider='google_calendar'", [organizationId]);
  const config = result.rows[0]?.config || {};
  const refreshToken = decryptGoogleSecret(config.refreshTokenEncrypted);
  if (!refreshToken) return null;
  const token = await googleTokenRequest({ client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID, client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" });
  return { accessToken: token.access_token, calendarId: config.calendarId || "primary", timezone: config.timezone || "America/Santo_Domingo" };
}

async function syncAppointmentToGoogle(organizationId, appointmentId) {
  if (!googleCalendarConfigured || !googleCalendarTokenKey) return { synced: false, reason: "not_configured" };
  try {
    const result = await pool.query(`
      SELECT t.id, t.google_event_id AS "googleEventId", t.status, t.customer_name AS "customerName", t.customer_email AS "customerEmail", t.customer_phone AS "customerPhone", t.requested_date AS date, t.requested_time AS time, t.notes, t.vehicle_id AS "vehicleId", b.name AS brand, v.model, v.variant, os.appointment_timezone AS timezone
      FROM test_drive_requests t LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN vehicle_brands b ON b.id=v.brand_id LEFT JOIN organization_settings os ON os.organization_id=t.organization_id
      WHERE t.id=$1 AND t.organization_id=$2`, [appointmentId, organizationId]);
    const appointment = result.rows[0];
    if (!appointment) return { synced: false, reason: "appointment_not_found" };
    const access = await getGoogleCalendarAccess(organizationId);
    if (!access) return { synced: false, reason: "not_connected" };
    const date = String(appointment.date).slice(0, 10);
    const time = String(appointment.time).slice(0, 5);
    const start = `${date}T${time}:00`;
    const duration = 60;
    const [hour, minute] = time.split(":").map(Number);
    const endMinutes = hour * 60 + minute + duration;
    const end = `${date}T${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}:00`;
    const vehicle = [appointment.brand, appointment.model, appointment.variant].filter(Boolean).join(" ") || "vehículo seleccionado";
    const event = { summary: `Prueba de manejo · ${vehicle}`, description: [`Cliente: ${appointment.customerName}`, appointment.customerEmail && `Correo: ${appointment.customerEmail}`, appointment.customerPhone && `Teléfono: ${appointment.customerPhone}`, appointment.notes && `Notas: ${appointment.notes}`, "Creada desde AUTHENTIQ"].filter(Boolean).join("\n"), start: { dateTime: start, timeZone: appointment.timezone || access.timezone }, end: { dateTime: end, timeZone: appointment.timezone || access.timezone }, status: appointment.status === "cancelled" ? "cancelled" : appointment.status === "pending" ? "tentative" : "confirmed", extendedProperties: { private: { authentiqAppointmentId: String(appointment.id) } } };
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(access.calendarId)}/events`;
    const method = appointment.googleEventId ? "PATCH" : "POST";
    const url = appointment.googleEventId ? `${base}/${encodeURIComponent(appointment.googleEventId)}` : base;
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${access.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(event) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `Google Calendar respondió ${response.status}`);
    if (!appointment.googleEventId && payload.id) await pool.query("UPDATE test_drive_requests SET google_event_id=$1 WHERE id=$2 AND organization_id=$3", [payload.id, appointment.id, organizationId]);
    return { synced: true, eventId: payload.id || appointment.googleEventId };
  } catch (error) {
    console.error("Google Calendar appointment sync failed", { organizationId, appointmentId, error: error.message });
    return { synced: false, reason: "provider_error" };
  }
}

async function sendTransactionalEmail({ to, subject, text, html }) {
  if (!emailDeliveryConfigured || !to) return { sent: false, reason: "not_configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: resendFromEmail, to: [to], subject, text, html }),
    });
    if (!response.ok) throw new Error(`Resend respondió ${response.status}`);
    return { sent: true };
  } catch (error) {
    console.error("Transactional email failed", { to, subject, error: error.message });
    return { sent: false, reason: "provider_error" };
  }
}

async function notifyAdmins({ organizationId, type = "lead", title, body, entityType = "lead", entityId = null }) {
  const admins = await pool.query("SELECT email FROM admin_users WHERE organization_id=$1 AND is_active = TRUE AND email IS NOT NULL", [organizationId]);
  await pool.query(
    `INSERT INTO notifications (user_id, notification_type, title, body, entity_type, entity_id)
     SELECT id, $1, $2, $3, $4, $5 FROM admin_users WHERE organization_id=$6 AND is_active = TRUE`,
    [type, title, body, entityType, entityId, organizationId],
  );
  if (emailDeliveryConfigured) {
    await Promise.allSettled([...new Set(admins.rows.map((row) => String(row.email || "").trim().toLowerCase()).filter(Boolean))].map((email) => sendTransactionalEmail({
      to: email,
      subject: `[AUTHENTIQ] ${title}`,
      text: body,
      html: `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body)}</p><p>Revisa el backoffice de tu showroom para continuar.</p>`,
    })));
  }
  if (process.env.LEAD_WEBHOOK_URL) {
    try { await fetch(process.env.LEAD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, title, body, entityType, entityId }) }); }
    catch (error) { console.error("External lead notification failed", error); }
  }
}

async function notifyCustomer({ customerId, type = "activity", title, body, entityType = null, entityId = null }) {
  if (!customerId) return;
  await pool.query(
    "INSERT INTO customer_notifications (customer_id, notification_type, title, body, entity_type, entity_id) VALUES ($1,$2,$3,$4,$5,$6)",
    [customerId, type, title, body, entityType, entityId],
  );
}

async function dispatchAppointmentReminders() {
  const webhookUrl = String(process.env.APPOINTMENT_REMINDER_WEBHOOK_URL || "").trim();
  if (!webhookUrl && !emailDeliveryConfigured) return;
  const result = await pool.query(`
    SELECT t.id, t.customer_name AS "customerName", t.customer_email AS "customerEmail", t.customer_phone AS "customerPhone", t.requested_date AS "date", t.requested_time AS "time", t.reminder_24h_sent_at AS "reminder24hSentAt", t.reminder_2h_sent_at AS "reminder2hSentAt", b.name AS brand, v.model
    FROM test_drive_requests t
    JOIN vehicles v ON v.id=t.vehicle_id
    JOIN vehicle_brands b ON b.id=v.brand_id
    WHERE t.status IN ('pending','confirmed') AND (t.customer_email IS NOT NULL OR t.customer_phone IS NOT NULL)
      AND (t.requested_date + t.requested_time) BETWEEN NOW() + INTERVAL '1 hour 45 minutes' AND NOW() + INTERVAL '25 hours'`);
  for (const appointment of result.rows) {
    const appointmentAt = new Date(`${String(appointment.date).slice(0, 10)}T${String(appointment.time).slice(0, 5)}:00`);
    const hoursUntil = (appointmentAt.getTime() - Date.now()) / 3600000;
    const reminderType = hoursUntil >= 20 ? "24h" : hoursUntil <= 4 ? "2h" : null;
    const sentColumn = reminderType === "24h" ? "reminder_24h_sent_at" : reminderType === "2h" ? "reminder_2h_sent_at" : null;
    if (!sentColumn || appointment[reminderType === "24h" ? "reminder24hSentAt" : "reminder2hSentAt"]) continue;
    const body = { type: "appointment_reminder", reminder: reminderType, appointmentId: appointment.id, customer: { name: appointment.customerName, email: appointment.customerEmail, phone: appointment.customerPhone }, vehicle: `${appointment.brand} ${appointment.model}`, date: appointment.date, time: String(appointment.time).slice(0, 5) };
    try {
      let delivered = false;
      if (webhookUrl) {
        const response = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`Webhook respondió ${response.status}`);
        delivered = true;
      }
      if (emailDeliveryConfigured && appointment.customerEmail) {
        const emailResult = await sendTransactionalEmail({
          to: appointment.customerEmail,
          subject: `Recordatorio de cita · ${appointment.vehicle}`,
          text: `Te esperamos para ver tu ${appointment.vehicle} el ${appointment.date} a las ${String(appointment.time).slice(0, 5)}.`,
          html: `<p>Te esperamos para ver tu <strong>${escapeHtml(appointment.vehicle)}</strong>.</p><p>Fecha: ${escapeHtml(appointment.date)} · Hora: ${escapeHtml(String(appointment.time).slice(0, 5))}</p>`,
        });
        delivered = delivered || emailResult.sent;
      }
      if (!delivered) throw new Error("No hubo un canal de entrega disponible");
      await pool.query(`UPDATE test_drive_requests SET ${sentColumn}=NOW() WHERE id=$1 AND ${sentColumn} IS NULL`, [appointment.id]);
    } catch (error) { console.error(`Appointment ${reminderType} reminder failed`, error); }
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS server_time");
    await fs.access(uploadsDir);
    res.json({ ok: true, database: "connected", storage: remoteStorageEnabled ? "supabase" : "available", storageProvider: remoteStorageEnabled ? "supabase" : "local-temporary", publicApiConfigured: Boolean(publicApiUrl), serverTime: result.rows[0].server_time });
  } catch (error) {
    console.error("Health check failed", error);
    res.status(503).json({ ok: false, database: "unavailable", storage: "unavailable" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  try {
    const organization = await getOrganizationContext(req);
    const result = await pool.query("SELECT id, full_name, email, role, password_hash, must_change_password AS \"mustChangePassword\", organization_id AS \"organizationId\" FROM admin_users WHERE LOWER(email) = $1 AND (organization_id = $2 OR role = 'platform_admin') AND is_active = TRUE", [email, organization.id]);
    const admin = result.rows[0];
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    // Una contraseña restablecida por un administrador solo sirve para volver a entrar:
    // el token es de vida corta y obliga a definir una contraseña propia antes de operar.
    const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role, name: admin.full_name, organizationId: admin.organizationId, mustChangePassword: admin.mustChangePassword }, jwtSecret, { expiresIn: admin.mustChangePassword ? "15m" : "8h" });
    setSessionCookie(res, ADMIN_SESSION_COOKIE, token, admin.mustChangePassword ? 900 : 28800);
    res.json({ token, user: { id: admin.id, name: admin.full_name, email: admin.email, role: admin.role, organizationId: admin.organizationId, mustChangePassword: admin.mustChangePassword } });
  } catch (error) {
    if (isOrganizationNotFound(error)) return sendOrganizationNotFound(res);
    console.error("Admin login failed", error);
    res.status(503).json({ error: "El servicio no está disponible en este momento. Intenta nuevamente." });
  }
});

app.post("/api/auth/register-dealer", verifyPublicForm, async (req, res) => {
  const dealershipName = String(req.body?.dealershipName || req.body?.name || "").trim();
  const rawSlug = String(req.body?.slug || "").trim().toLowerCase();
  const generatedSlug = rawSlug || dealershipName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const slug = generatedSlug.slice(0, 80);
  const adminName = String(req.body?.adminName || "").trim();
  const adminEmail = String(req.body?.adminEmail || req.body?.email || "").trim().toLowerCase();
  const adminPassword = String(req.body?.adminPassword || req.body?.password || "");
  const phone = String(req.body?.phone || "").trim() || null;
  const whatsapp = String(req.body?.whatsapp || "").trim() || phone;
  const address = String(req.body?.address || "").trim() || null;

  if (dealershipName.length < 2) return res.status(400).json({ error: "El nombre del concesionario debe tener al menos 2 caracteres" });
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return res.status(400).json({ error: "El identificador (slug) debe contener solo letras minúsculas, números y guiones" });
  if (adminName.length < 2) return res.status(400).json({ error: "El nombre del administrador debe tener al menos 2 caracteres" });
  if (!/^\S+@\S+\.\S+$/.test(adminEmail)) return res.status(400).json({ error: "Introduce un correo electrónico válido" });
  if (adminPassword.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingOrg = await client.query("SELECT id FROM organizations WHERE slug = $1", [slug]);
    if (existingOrg.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `El identificador "${slug}" ya está en uso. Por favor elige otro nombre o slug.` });
    }
    const existingUser = await client.query("SELECT id FROM admin_users WHERE LOWER(email) = $1", [adminEmail]);
    if (existingUser.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Ya existe un usuario registrado con este correo electrónico." });
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const orgResult = await client.query(
      `INSERT INTO organizations (slug, name, is_active, approval_status) VALUES ($1, $2, TRUE, 'pending')
       RETURNING id, slug, name, logo_url AS "logoUrl", custom_domain AS "customDomain", is_active AS "isActive", approval_status AS "approvalStatus", created_at AS "createdAt"`,
      [slug, dealershipName]
    );
    const organizationId = orgResult.rows[0].id;

    await client.query(
      `INSERT INTO organization_settings (
        organization_id, business_name, phone, whatsapp, address, primary_color, accent_color,
        appointment_timezone, appointment_start, appointment_end, appointment_duration_minutes, appointment_capacity, appointment_days
      ) VALUES ($1, $2, $3, $4, $5, '#c8a24b', '#b28b37', 'America/Santo_Domingo', '09:00', '18:00', 60, 1, ARRAY[1,2,3,4,5,6]::integer[])`,
      [organizationId, dealershipName, phone, whatsapp, address]
    );

    await client.query(
      `INSERT INTO organization_integrations (organization_id, provider, mode, status, config)
       VALUES ($1, 'google_calendar', 'local', 'local_export_ready', $2::jsonb),
              ($1, 'meta_social', 'local', 'drafts_ready', $3::jsonb),
              ($1, 'billing', 'local_demo', 'trialing', $4::jsonb)`,
      [organizationId, JSON.stringify({ calendarName: `Agenda de ${dealershipName}` }), JSON.stringify({ publishing: "manual" }), JSON.stringify({ checkout: "pending_provider" })]
    );

    await client.query(
      `INSERT INTO billing_subscriptions (organization_id, provider, mode, plan_code, status, monthly_amount, currency, current_period_end)
       VALUES ($1, 'local', 'local_demo', 'starter', 'trialing', 99, 'USD', CURRENT_DATE + 14)`,
      [organizationId]
    );

    const adminResult = await client.query(
      `INSERT INTO admin_users (full_name, email, password_hash, role, organization_id, is_active)
       VALUES ($1, $2, $3, 'admin', $4, TRUE)
       RETURNING id, full_name AS "name", email, role, organization_id AS "organizationId"`,
      [adminName, adminEmail, passwordHash, organizationId]
    );
    const admin = adminResult.rows[0];

    await client.query("INSERT INTO organization_members (organization_id, admin_user_id, role) VALUES ($1, $2, 'admin')", [organizationId, admin.id]);

    await client.query("COMMIT");

    await pool.query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, 'dealer.self_register', 'organization', $2, $3::jsonb)", [
      admin.id, organizationId, JSON.stringify({ slug, name: dealershipName, email: adminEmail })
    ]);

    const token = jwt.sign({ id: admin.id, email: admin.email, role: "admin", name: admin.name, organizationId, mustChangePassword: false }, jwtSecret, { expiresIn: "8h" });
    setSessionCookie(res, ADMIN_SESSION_COOKIE, token, 28800);

    // El showroom recién registrado sigue siendo privado hasta aprobación. La vista
    // previa usa el JWT; el enlace público por ?dealer= solo se habilita para dealers
    // activos/aprobados desde el dominio central.
    const baseUrl = String(process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const dealerUrl = `${baseUrl}/?preview=1`;
    const futureSubdomain = subdomainForSlug(slug);

    res.status(201).json({
      token,
      user: { id: admin.id, name: admin.name, email: admin.email, role: "admin", organizationId, organizationSlug: slug, organizationName: dealershipName, mustChangePassword: false },
      organization: { id: organizationId, slug, name: dealershipName, approvalStatus: "pending" },
      dealerUrl,
      futurePublicUrl: futureSubdomain ? `https://${futureSubdomain}` : null,
      message: "Concesionario registrado. Tu showroom queda en revisión y solo tú puedes verlo hasta que se apruebe.",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Dealer registration failed", error);
    if (error.code === "23505") {
      return res.status(409).json({ error: "El identificador del concesionario o el correo electrónico ya está en uso." });
    }
    res.status(500).json({ error: "No se pudo registrar el concesionario" });
  } finally {
    client.release();
  }
});

app.post("/api/customer/auth/register", verifyPublicForm, async (req, res) => {
  const fullName = String(req.body.fullName || req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const phone = String(req.body.phone || "").trim() || null;
  const password = String(req.body.password || "");
  if (fullName.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ error: "Nombre, correo válido y contraseña de 8 caracteres son obligatorios" });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query("INSERT INTO customer_accounts (full_name, email, phone, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, full_name, email, phone", [fullName, email, phone, passwordHash]);
    const account = result.rows[0];
    const token = jwt.sign({ id: account.id, email: account.email, name: account.full_name, kind: "customer" }, jwtSecret, { expiresIn: "30d" });
    setSessionCookie(res, CUSTOMER_SESSION_COOKIE, token, 2592000);
    res.status(201).json({ token, user: { id: account.id, name: account.full_name, email: account.email, phone: account.phone } });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe una cuenta con ese correo" });
    console.error("Customer registration failed", error);
    res.status(500).json({ error: "No se pudo crear la cuenta" });
  }
});

app.post("/api/customer/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  try {
    const result = await pool.query("SELECT id, full_name, email, phone, password_hash FROM customer_accounts WHERE LOWER(email)=$1 AND is_active=TRUE", [email]);
    const account = result.rows[0];
    if (!account || !(await bcrypt.compare(password, account.password_hash))) return res.status(401).json({ error: "Correo o contraseña incorrectos" });
    const token = jwt.sign({ id: account.id, email: account.email, name: account.full_name, kind: "customer" }, jwtSecret, { expiresIn: "30d" });
    setSessionCookie(res, CUSTOMER_SESSION_COOKIE, token, 2592000);
    res.json({ token, user: { id: account.id, name: account.full_name, email: account.email, phone: account.phone } });
  } catch (error) {
    console.error("Customer login failed", error);
    res.status(500).json({ error: "No se pudo iniciar sesión" });
  }
});

app.get("/api/customer/me", authenticateCustomer, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, full_name AS name, email, phone FROM customer_accounts WHERE id=$1 AND is_active=TRUE", [req.customer.id]);
    if (!result.rowCount) return res.status(401).json({ error: "La cuenta ya no está disponible" });
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error("Customer profile failed", error);
    res.status(500).json({ error: "No se pudo cargar la cuenta" });
  }
});

app.get("/api/customer/favorites", authenticateCustomer, async (req, res) => {
  try {
    const result = await pool.query("SELECT vehicle_id AS \"vehicleId\" FROM vehicle_favorites vf JOIN vehicles v ON v.id=vf.vehicle_id WHERE vf.customer_id=$1 AND v.status IN ('published','reserved') ORDER BY vf.created_at DESC", [req.customer.id]);
    res.json({ data: result.rows.map((row) => row.vehicleId) });
  } catch (error) {
    console.error("Customer favorites failed", error);
    res.status(500).json({ error: "No se pudieron cargar los favoritos" });
  }
});

app.put("/api/customer/favorites/:vehicleId", authenticateCustomer, async (req, res) => {
  try {
    const vehicle = await pool.query("SELECT id FROM vehicles WHERE id=$1 AND status IN ('published','reserved')", [req.params.vehicleId]);
    if (!vehicle.rowCount) return res.status(404).json({ error: "Vehículo no disponible" });
    await pool.query("INSERT INTO vehicle_favorites (customer_id, vehicle_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [req.customer.id, req.params.vehicleId]);
    res.status(204).end();
  } catch (error) {
    console.error("Add customer favorite failed", error);
    res.status(500).json({ error: "No se pudo guardar el favorito" });
  }
});

app.delete("/api/customer/favorites/:vehicleId", authenticateCustomer, async (req, res) => {
  try {
    await pool.query("DELETE FROM vehicle_favorites WHERE customer_id=$1 AND vehicle_id=$2", [req.customer.id, req.params.vehicleId]);
    res.status(204).end();
  } catch (error) {
    console.error("Remove customer favorite failed", error);
    res.status(500).json({ error: "No se pudo quitar el favorito" });
  }
});

app.get("/api/customer/activity", authenticateCustomer, async (req, res) => {
  try {
    const [offers, notifications, quotes] = await Promise.all([
      pool.query(`SELECT o.id, o.status, o.amount_usd AS "amountUsd", o.message, o.created_at AS "createdAt", b.name AS brand, v.model, v.year FROM offers o JOIN vehicles v ON v.id=o.vehicle_id JOIN vehicle_brands b ON b.id=v.brand_id WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 20`, [req.customer.id]),
      pool.query(`SELECT id, notification_type AS "type", title, body, entity_type AS "entityType", entity_id AS "entityId", read_at AS "readAt", created_at AS "createdAt" FROM customer_notifications WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.customer.id]),
      pool.query(`SELECT q.id, q.quote_number AS "quoteNumber", q.status, q.total_usd AS "totalUsd", q.currency, q.valid_until AS "validUntil", q.created_at AS "createdAt", b.name AS brand, v.model, v.year FROM quotes q LEFT JOIN vehicles v ON v.id=q.vehicle_id LEFT JOIN vehicle_brands b ON b.id=v.brand_id WHERE q.customer_id=$1 ORDER BY q.created_at DESC LIMIT 20`, [req.customer.id]),
    ]);
    res.json({ data: { offers: offers.rows, notifications: notifications.rows, quotes: quotes.rows } });
  } catch (error) {
    console.error("Customer activity failed", error);
    res.status(500).json({ error: "No se pudo cargar tu actividad" });
  }
});

app.patch("/api/customer/notifications/read", authenticateCustomer, async (req, res) => {
  try {
    await pool.query("UPDATE customer_notifications SET read_at=NOW() WHERE customer_id=$1 AND read_at IS NULL", [req.customer.id]);
    res.status(204).end();
  } catch (error) {
    console.error("Customer notifications read failed", error);
    res.status(500).json({ error: "No se pudieron marcar las notificaciones" });
  }
});

app.get("/api/vehicles", async (req, res) => {
  try { const organization = await getOrganizationContext(req); res.json({ data: await listVehicles(false, organization.id) }); }
  catch (error) { if (isOrganizationNotFound(error)) return sendOrganizationNotFound(res); console.error("Vehicle listing failed", error); res.status(500).json({ error: "No se pudo cargar el catálogo" }); }
});

app.get("/api/settings", async (req, res) => {
  try {
    const organization = await getOrganizationContext(req);
    const result = await pool.query('SELECT business_name AS "businessName", logo_url AS "logoUrl", primary_color AS "primaryColor", accent_color AS "accentColor", favicon_url AS "faviconUrl", phone, whatsapp, email, address, hours, instagram_url AS "instagramUrl", facebook_url AS "facebookUrl", currency, privacy_text AS "privacyText", terms_text AS "termsText", custom_css AS "customCss", hero_headline AS "heroHeadline", hero_subheadline AS "heroSubheadline", hero_image_url AS "heroImageUrl", show_financing AS "showFinancing", show_brand_rail AS "showBrandRail", show_model_line_rail AS "showModelLineRail", show_blog AS "showBlog" FROM organization_settings WHERE organization_id=$1', [organization.id]);
    const isPlatformHome = organization.slug === DEFAULT_ORGANIZATION_SLUG;
    res.json({ data: result.rows[0] ? { ...result.rows[0], isPlatformHome } : { isPlatformHome }, privacyPolicyVersion });
  } catch (error) { if (isOrganizationNotFound(error)) return sendOrganizationNotFound(res); console.error("Public settings query failed", error); res.status(500).json({ error: "No se pudo cargar la informacion del negocio" }); }
});

app.get("/api/blog", async (req, res) => {
  try {
    const organization = await getOrganizationContext(req);
    const result = await pool.query(`SELECT id, title, slug, summary, category, tags, cover_image_url AS "coverImageUrl", published_at AS "publishedAt", seo_title AS "seoTitle", seo_description AS "seoDescription" FROM blog_posts WHERE organization_id=$1 AND status='published' ORDER BY published_at DESC NULLS LAST, created_at DESC`, [organization.id]);
    res.json({ data: result.rows });
  } catch (error) { if (isOrganizationNotFound(error)) return sendOrganizationNotFound(res); console.error("Blog listing failed", error); res.status(500).json({ error: "No se pudo cargar el blog" }); }
});

app.get("/api/blog/:slug", async (req, res) => {
  try {
    const organization = await getOrganizationContext(req);
    const result = await pool.query(`SELECT id, title, slug, summary, content, category, tags, cover_image_url AS "coverImageUrl", published_at AS "publishedAt", seo_title AS "seoTitle", seo_description AS "seoDescription" FROM blog_posts WHERE organization_id=$1 AND slug=$2 AND status='published'`, [organization.id, req.params.slug]);
    if (!result.rowCount) return res.status(404).json({ error: "Artículo no encontrado" });
    res.json({ data: result.rows[0] });
  } catch (error) { if (isOrganizationNotFound(error)) return sendOrganizationNotFound(res); console.error("Blog article failed", error); res.status(500).json({ error: "No se pudo cargar el artículo" }); }
});

app.post("/api/offers", verifyPublicForm, async (req, res) => {
  const vehicleId = String(req.body.vehicleId || "");
  const buyerName = String(req.body.buyerName || "").trim();
  const buyerEmail = String(req.body.buyerEmail || "").trim() || null;
  const buyerPhone = String(req.body.buyerPhone || "").trim() || null;
  const amountUsd = Number(req.body.amountUsd);
  const message = String(req.body.message || "").trim() || null;
  const privacyConsent = req.body.privacyConsent === true;
  const customerId = getOptionalCustomerId(req);
  if (!privacyConsent) return res.status(400).json({ error: "Debes aceptar la politica de privacidad para enviar la oferta" });
  if (!vehicleId || !buyerName || !Number.isFinite(amountUsd) || amountUsd <= 0) return res.status(400).json({ error: "Nombre, vehículo y monto válido son obligatorios" });
  try {
    const organization = await getOrganizationContext(req);
    const vehicle = await pool.query("SELECT id, status FROM vehicles WHERE id=$1 AND organization_id=$2 AND status IN ('published','reserved')", [vehicleId, organization.id]);
    if (!vehicle.rowCount) return res.status(404).json({ error: "Este vehículo ya no está disponible en el catálogo" });
    if (vehicle.rows[0].status === "reserved") return res.status(409).json({ error: "Este vehículo está reservado y no admite ofertas nuevas. Escríbenos y te avisamos si vuelve a estar disponible." });
    const result = await pool.query(
      `INSERT INTO offers (organization_id, vehicle_id, buyer_name, buyer_email, buyer_phone, amount_usd, payment_method, message, privacy_consent, privacy_consent_at, privacy_policy_version, customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,'cash',$7,$8,NOW(),$9,$10)
       RETURNING id, status, created_at AS "createdAt"`,
      [organization.id, vehicleId, buyerName, buyerEmail, buyerPhone, amountUsd, message, privacyConsent, privacyPolicyVersion, customerId],
    );
    const lead = await createLead({ organizationId: organization.id, leadType: "offer", vehicleId, name: buyerName, email: buyerEmail, phone: buyerPhone, message, source: "vehicle-offer", privacyConsent });
    await pool.query("UPDATE offers SET lead_id=$1 WHERE id=$2", [lead.id, result.rows[0].id]);
    await notifyAdmins({ organizationId: organization.id, type: "offer", title: "Nueva oferta recibida", body: `${buyerName} envió una oferta para un vehículo.`, entityType: "offer", entityId: result.rows[0].id });
    await sendTransactionalEmail({
      to: buyerEmail,
      subject: "Recibimos tu oferta",
      text: `Gracias, ${buyerName}. El dealer recibió tu oferta y se pondrá en contacto contigo.`,
      html: `<p>Gracias, <strong>${escapeHtml(buyerName)}</strong>.</p><p>El dealer recibió tu oferta y se pondrá en contacto contigo.</p>`,
    });
    res.status(201).json({ data: { ...result.rows[0], leadId: lead.id } });
  } catch (error) {
    console.error("Offer creation failed", error);
    res.status(500).json({ error: "No se pudo registrar la oferta" });
  }
});

app.get("/api/internal/appointment-reminders", async (req, res) => {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(req.headers.authorization || "");
  if (!secret || authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "No autorizado" });
  try {
    await dispatchAppointmentReminders();
    res.json({ ok: true });
  } catch (error) {
    console.error("Scheduled appointment reminders failed", error);
    res.status(500).json({ error: "No se pudieron procesar los recordatorios" });
  }
});

app.get("/api/appointments/availability", async (req, res) => {
  const date = String(req.query.date || "").trim();
  if (!isIsoDate(date)) return res.status(400).json({ error: "La fecha debe tener formato YYYY-MM-DD" });
  try {
    const organization = await getOrganizationContext(req);
    res.json({ data: await appointmentAvailability(date, organization.id) });
  } catch (error) {
    if (isOrganizationNotFound(error)) return sendOrganizationNotFound(res);
    console.error("Appointment availability failed", error);
    res.status(500).json({ error: "No se pudo consultar la disponibilidad" });
  }
});

app.post("/api/appointments", rateLimit({ windowMs: 10 * 60 * 1000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Demasiadas solicitudes de cita. Intenta nuevamente más tarde." } }), verifyPublicForm, async (req, res) => {
  const vehicleId = String(req.body.vehicleId || "").trim() || null;
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim() || null;
  const phone = String(req.body.phone || "").trim() || null;
  const date = String(req.body.date || "").trim();
  const time = String(req.body.time || "").trim();
  const notes = String(req.body.notes || "").trim() || null;
  const privacyConsent = req.body.privacyConsent === true;
  if (!vehicleId || !name || (!email && !phone) || !isIsoDate(date) || timeToMinutes(time) === null || !privacyConsent) return res.status(400).json({ error: "Vehículo, nombre, correo o teléfono, fecha, horario y consentimiento son obligatorios" });
  try {
    const organization = await getOrganizationContext(req);
    const availability = await appointmentAvailability(date, organization.id);
    const slot = availability.slots.find((item) => item.time === time);
    if (!slot || !slot.available) return res.status(409).json({ error: "Ese horario ya no está disponible. Selecciona otro." });
    const client = await pool.connect();
    let appointment;
    let lead;
    try {
      await client.query("BEGIN");
      const vehicle = await client.query("SELECT id FROM vehicles WHERE id=$1 AND organization_id=$2 AND status IN ('published','reserved')", [vehicleId, organization.id]);
      if (!vehicle.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Vehículo no disponible" }); }
      const settings = await client.query("SELECT appointment_capacity AS capacity FROM organization_settings WHERE organization_id=$1 FOR UPDATE", [organization.id]);
      const capacity = Number(settings.rows[0]?.capacity || 1);
      const booked = await client.query("SELECT COUNT(*)::int AS count FROM test_drive_requests WHERE organization_id=$1 AND requested_date=$2::date AND requested_time=$3::time AND status IN ('pending','confirmed')", [organization.id, date, time]);
      if (Number(booked.rows[0].count) >= capacity) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Ese horario acaba de completarse. Selecciona otro." }); }
      const leadResult = await client.query(
        `INSERT INTO leads (organization_id, lead_type, vehicle_id, name, email, phone, message, source, privacy_consent, privacy_consent_at, privacy_policy_version, consent_source)
         VALUES ($1,'test-drive',$2,$3,$4,$5,$6,'appointment',$7,CASE WHEN $7 THEN NOW() ELSE NULL END,$8,'appointment')
         RETURNING id, status, created_at AS "createdAt"`,
        [organization.id, vehicleId, name, email, phone, notes, privacyConsent, privacyPolicyVersion],
      );
      lead = leadResult.rows[0];
      const appointmentResult = await client.query(
        `INSERT INTO test_drive_requests (organization_id, vehicle_id, lead_id, customer_name, customer_email, customer_phone, requested_date, requested_time, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::time,'pending',$9)
         RETURNING id, vehicle_id AS "vehicleId", requested_date AS "date", requested_time AS "time", status, created_at AS "createdAt"`,
        [organization.id, vehicleId, lead.id, name, email, phone, date, time, notes],
      );
      appointment = appointmentResult.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await notifyAdmins({ organizationId: organization.id, title: "Nueva cita solicitada", body: `${name} solicitó una cita para ${date} a las ${time}.`, entityType: "appointment", entityId: appointment.id });
    await sendTransactionalEmail({
      to: email,
      subject: "Recibimos tu solicitud de cita",
      text: `Hola ${name}. Recibimos tu solicitud para el ${date} a las ${time}. El dealer confirmará la disponibilidad.`,
      html: `<p>Hola <strong>${escapeHtml(name)}</strong>.</p><p>Recibimos tu solicitud para el <strong>${escapeHtml(date)}</strong> a las <strong>${escapeHtml(time)}</strong>.</p><p>El dealer confirmará la disponibilidad.</p>`,
    });
    res.status(201).json({ data: { ...appointment, leadId: lead.id } });
  } catch (error) {
    if (isOrganizationNotFound(error)) return sendOrganizationNotFound(res);
    console.error("Appointment creation failed", error);
    res.status(500).json({ error: "No se pudo registrar la cita" });
  }
});

app.post("/api/leads", verifyPublicForm, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim() || null;
  const phone = String(req.body.phone || "").trim() || null;
  const message = String(req.body.message || "").trim() || null;
  const vehicleId = String(req.body.vehicleId || "").trim() || null;
  const privacyConsent = req.body.privacyConsent === true;
  if (!privacyConsent) return res.status(400).json({ error: "Debes aceptar la politica de privacidad para enviar el mensaje" });
  if (!name || (!email && !phone)) return res.status(400).json({ error: "Nombre y correo o teléfono son obligatorios" });
  try {
    const organization = await getOrganizationContext(req);
    if (vehicleId) {
      // El catálogo público muestra 'published' y 'reserved': se puede consultar por ambos.
      const vehicle = await pool.query("SELECT id FROM vehicles WHERE id=$1 AND organization_id=$2 AND status IN ('published','reserved')", [vehicleId, organization.id]);
      if (!vehicle.rowCount) return res.status(404).json({ error: "Vehículo no disponible" });
    }
    const lead = await createLead({ organizationId: organization.id, leadType: vehicleId ? "interest" : "contact", vehicleId, name, email, phone, message, source: vehicleId ? "vehicle-interest" : "contact-form", privacyConsent });
    await notifyAdmins({ organizationId: organization.id, title: "Nuevo lead recibido", body: `${name} dejó sus datos desde el sitio web.`, entityType: "lead", entityId: lead.id });
    await sendTransactionalEmail({
      to: email,
      subject: "Recibimos tu mensaje",
      text: `Hola ${name}. Recibimos tu mensaje y un asesor del dealer se pondrá en contacto contigo.`,
      html: `<p>Hola <strong>${escapeHtml(name)}</strong>.</p><p>Recibimos tu mensaje y un asesor del dealer se pondrá en contacto contigo.</p>`,
    });
    res.status(201).json({ data: lead });
  } catch (error) {
    if (isOrganizationNotFound(error)) return sendOrganizationNotFound(res);
    console.error("Lead creation failed", error);
    res.status(500).json({ error: "No se pudo registrar el contacto" });
  }
});

app.post("/api/admin/uploads", authenticate, requireRoles("admin", "editor"), (req, res) => {
  upload.single("image")(req, res, async (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "La imagen no puede superar 8 MB" });
    if (error) return res.status(400).json({ error: "Solo se permiten imágenes JPG, PNG, WebP o AVIF" });
    if (!req.file) return res.status(400).json({ error: "Debes seleccionar una imagen" });
    if (!(await isValidImageUpload(req.file))) return res.status(400).json({ error: "La imagen está corrupta o no coincide con su formato" });
    req.file = await optimizeUploadedImage(req.file);
    const objectPath = `uploads/${req.file.filename}`;
    const url = remoteStorageEnabled ? await uploadFileToConfiguredStorage(req.file, objectPath) : `${publicApiUrl || `${req.protocol}://${req.get("host")}`}/uploads/${req.file.filename}`;
    if (remoteStorageEnabled) await fs.unlink(req.file.path).catch(() => {});
    await writeAudit(req, "image.upload", "image", null, { filename: req.file.filename, size: req.file.size, mimeType: req.file.mimetype });
    res.status(201).json({ data: { url, filename: req.file.filename, size: req.file.size } });
  });
});

app.post("/api/admin/media-upload", authenticate, requireRoles("admin", "editor"), (req, res) => {
  mediaUpload.single("file")(req, res, async (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "El archivo no puede superar 120 MB" });
    if (error) return res.status(400).json({ error: "Tipo de archivo no compatible. Usa JPG, PNG, WebP, MP4, WebM, GLB o GLTF" });
    if (!req.file) return res.status(400).json({ error: "Debes seleccionar un archivo" });
    if (!(await isValidMediaUpload(req.file))) return res.status(400).json({ error: "El archivo está corrupto o no coincide con su formato declarado" });
    req.file = await optimizeUploadedImage(req.file);
    if (path.extname(req.file.originalname).toLowerCase() === ".gltf") {
      try {
        const entryPath = sanitizeMediaRelativePath(req.file.filename);
        const manifest = await inspectGltfManifest(req.file.path, entryPath, new Set([entryPath]));
        if (manifest.missing.length) {
          await fs.unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: `Este GLTF necesita ${manifest.missing.length} archivo${manifest.missing.length === 1 ? "" : "s"} adicional${manifest.missing.length === 1 ? "" : "es"}. Carga la carpeta completa o conviértelo a GLB.`, code: "GLTF_DEPENDENCIES_MISSING", missing: manifest.missing.slice(0, 12), missingCount: manifest.missing.length });
        }
      } catch {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: "El archivo GLTF no contiene un manifiesto válido" });
      }
    }
    const objectPath = `uploads/${req.file.filename}`;
    const url = remoteStorageEnabled ? await uploadFileToConfiguredStorage(req.file, objectPath) : `${publicApiUrl || `${req.protocol}://${req.get("host")}`}/uploads/${req.file.filename}`;
    if (remoteStorageEnabled) await fs.unlink(req.file.path).catch(() => {});
    await writeAudit(req, "media.upload", "media", null, { filename: req.file.filename, size: req.file.size, mimeType: req.file.mimetype });
    res.status(201).json({ data: { url, filename: req.file.filename, size: req.file.size, mimeType: req.file.mimetype } });
  });
});

app.post("/api/admin/media-package-upload", authenticate, requireRoles("admin", "editor"), (req, res) => {
  mediaPackageUpload.array("files", 80)(req, res, async (error) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") { await removeMediaPackage(req.mediaPackageId); return res.status(400).json({ error: "Cada archivo del modelo no puede superar 120 MB" }); }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") { await removeMediaPackage(req.mediaPackageId); return res.status(400).json({ error: "La carpeta del modelo no puede superar 80 archivos" }); }
    if (error) { await removeMediaPackage(req.mediaPackageId); return res.status(400).json({ error: "La carpeta contiene un tipo de archivo no compatible. Usa GLTF, BIN y texturas PNG, JPG o WebP" }); }
    const files = Array.isArray(req.files) ? req.files : [];
    const relativePaths = files.map((file) => sanitizeMediaRelativePath(file.originalname)).filter(Boolean);
    const entryPath = relativePaths.find((filePath) => path.extname(filePath).toLowerCase() === ".gltf");
    if (!entryPath) { await removeMediaPackage(req.mediaPackageId); return res.status(400).json({ error: "La carpeta debe contener al menos un archivo .gltf. Para una carga simple usa un .glb." }); }
    try {
      const entryFile = files.find((file) => sanitizeMediaRelativePath(file.originalname) === entryPath);
      const manifest = await inspectGltfManifest(entryFile.path, entryPath, new Set(relativePaths));
      if (manifest.missing.length) {
        await removeMediaPackage(req.mediaPackageId);
        return res.status(400).json({ error: `El GLTF todavía tiene ${manifest.missing.length} dependencia${manifest.missing.length === 1 ? "" : "s"} faltante${manifest.missing.length === 1 ? "" : "s"}. Revisa que seleccionaste la carpeta raíz del modelo.`, code: "GLTF_DEPENDENCIES_MISSING", missing: manifest.missing.slice(0, 12), missingCount: manifest.missing.length });
      }
      const uploadedObjects = [];
      let url = "";
      if (remoteStorageEnabled) {
        for (const file of files) {
          const relativePath = sanitizeMediaRelativePath(file.originalname);
          const objectPath = `uploads/packages/${req.mediaPackageId}/${relativePath}`;
          await uploadFileToConfiguredStorage(file, objectPath);
          uploadedObjects.push(objectPath);
        }
        url = storagePublicUrl(`uploads/packages/${req.mediaPackageId}/${entryPath}`);
        await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {})));
      } else {
        const mediaOrigin = publicApiUrl || `${req.protocol}://${req.get("host")}`;
        url = `${mediaOrigin}/uploads/packages/${req.mediaPackageId}/${entryPath.split("/").map(encodeURIComponent).join("/")}`;
      }
      await writeAudit(req, "media.package_upload", "media", null, { packageId: req.mediaPackageId, entryPath, fileCount: files.length, referenceCount: manifest.references.length });
      return res.status(201).json({ data: { url, packageId: req.mediaPackageId, entryPath, fileCount: files.length, referenceCount: manifest.references.length } });
    } catch {
      await removeMediaPackage(req.mediaPackageId);
      return res.status(400).json({ error: "No se pudo leer el manifiesto GLTF de la carpeta" });
    }
  });
});

app.post("/api/admin/vehicles/:id/3d-generation", authenticate, requireRoles("admin", "editor"), (req, res) => {
  vehicle3dGenerationUpload.array("images", 5)(req, res, async (error) => {
    const files = Array.isArray(req.files) ? req.files : [];
    const removeSources = () => Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {})));
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") { await removeSources(); return res.status(400).json({ error: "Cada foto para generar el modelo no puede superar 8 MB" }); }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") { await removeSources(); return res.status(400).json({ error: "Puedes enviar hasta 5 fotos por modelo 3D" }); }
    if (error) { await removeSources(); return res.status(400).json({ error: "Solo se permiten fotos JPG, PNG, WebP o AVIF" }); }
    if (!files.length) return res.status(400).json({ error: "Selecciona entre 1 y 5 fotos del vehículo" });
    if (!rodinApiKey) { await removeSources(); return res.status(503).json({ error: "La generación 3D todavía no está configurada. Añade RODIN_API_KEY al servidor.", code: "3D_PROVIDER_NOT_CONFIGURED", provider: "rodin" }); }
    try {
      const vehicle = await pool.query("SELECT id FROM vehicles WHERE id=$1 AND organization_id=$2", [req.params.id, adminOrganizationId(req)]);
      if (!vehicle.rowCount) { await removeSources(); return res.status(404).json({ error: "Vehículo no encontrado" }); }
      for (const file of files) if (!(await isValidImageUpload(file))) return res.status(400).json({ error: "Una de las fotos está corrupta o no coincide con su formato" });
      const submitted = await submitRodinGeneration(files);
      const inserted = await pool.query(
        `INSERT INTO vehicle_3d_jobs (organization_id, vehicle_id, provider, status, source_images, provider_task_id, provider_subscription_key, created_by)
         VALUES ($1,$2,'rodin','processing',$3::jsonb,$4,$5,$6)
         RETURNING id, vehicle_id AS "vehicleId", provider, status, created_at AS "createdAt"`,
        [adminOrganizationId(req), req.params.id, JSON.stringify(files.map((file) => ({ name: file.originalname, mimeType: file.mimetype }))), submitted.taskId, submitted.subscriptionKey, req.admin.id],
      );
      await writeAudit(req, "vehicle.3d_generation_started", "vehicle_3d_job", inserted.rows[0].id, { vehicleId: req.params.id, provider: "rodin", imageCount: files.length });
      return res.status(202).json({ data: { ...inserted.rows[0], message: "Modelo 3D en proceso. Puedes consultar el estado en unos segundos." } });
    } catch (generationError) {
      console.error("3D generation submission failed", generationError);
      const status = generationError.code === "3D_PROVIDER_ERROR" ? 502 : 500;
      return res.status(status).json({ error: generationError.message || "No se pudo iniciar la generación 3D", code: generationError.code || "3D_GENERATION_FAILED" });
    } finally { await removeSources(); }
  });
});

app.get("/api/admin/vehicles/:id/3d-generation", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, vehicle_id AS "vehicleId", provider, status, source_images AS "sourceImages", model_url AS "modelUrl", preview_url AS "previewUrl", error, created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
       FROM vehicle_3d_jobs WHERE vehicle_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 10`,
      [req.params.id, adminOrganizationId(req)],
    );
    res.json({ data: result.rows });
  } catch (listError) { console.error("3D generation listing failed", listError); res.status(500).json({ error: "No se pudieron cargar los trabajos 3D" }); }
});

app.get("/api/admin/vehicles/:id/3d-generation/:jobId/refresh", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const jobResult = await pool.query(
    `SELECT id, vehicle_id AS "vehicleId", provider, status, provider_task_id AS "taskId", provider_subscription_key AS "subscriptionKey", model_url AS "modelUrl", preview_url AS "previewUrl", error, created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"
     FROM vehicle_3d_jobs WHERE id=$1 AND vehicle_id=$2 AND organization_id=$3`,
    [req.params.jobId, req.params.id, adminOrganizationId(req)],
  );
  if (!jobResult.rowCount) return res.status(404).json({ error: "Trabajo 3D no encontrado" });
  const job = jobResult.rows[0];
  if (["ready", "needs_review", "failed"].includes(job.status)) return res.json({ data: job });
  try {
    const providerState = await checkRodinGeneration(job.subscriptionKey);
    const failed = ["failed", "error", "cancelled"].includes(providerState.status);
    const complete = ["done", "completed", "success"].includes(providerState.status);
    if (failed) {
      const message = "El proveedor no pudo completar este modelo 3D";
      await pool.query("UPDATE vehicle_3d_jobs SET status='failed', error=$1, updated_at=NOW() WHERE id=$2", [message, job.id]);
      return res.json({ data: { ...job, status: "failed", error: message } });
    }
    if (!complete) {
      await pool.query("UPDATE vehicle_3d_jobs SET status='processing', updated_at=NOW() WHERE id=$1", [job.id]);
      return res.json({ data: { ...job, status: "processing" } });
    }
    const assets = await downloadRodinResults(job.taskId);
    const modelUrl = await persistGenerated3dAsset(assets.modelUrl, adminOrganizationId(req), req.params.id, `${job.id}.glb`, "model/gltf-binary");
    const previewUrl = assets.previewUrl ? await persistGenerated3dAsset(assets.previewUrl, adminOrganizationId(req), req.params.id, `${job.id}.webp`, "image/webp") : null;
    const updated = await pool.query(
      `UPDATE vehicle_3d_jobs SET status='needs_review', model_url=$1, preview_url=$2, error=NULL, updated_at=NOW(), completed_at=NOW()
       WHERE id=$3 RETURNING id, vehicle_id AS "vehicleId", provider, status, model_url AS "modelUrl", preview_url AS "previewUrl", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"`,
      [modelUrl, previewUrl, job.id],
    );
    await writeAudit(req, "vehicle.3d_generation_ready", "vehicle_3d_job", job.id, { vehicleId: req.params.id, modelUrl });
    return res.json({ data: updated.rows[0] });
  } catch (refreshError) {
    console.error("3D generation refresh failed", refreshError);
    if (refreshError.code === "3D_PROVIDER_ERROR") return res.status(502).json({ error: refreshError.message, code: refreshError.code });
    await pool.query("UPDATE vehicle_3d_jobs SET status='failed', error=$1, updated_at=NOW() WHERE id=$2", [refreshError.message || "No se pudo descargar el modelo 3D", job.id]);
    return res.status(500).json({ error: refreshError.message || "No se pudo finalizar el modelo 3D", code: "3D_RESULT_FAILED" });
  }
});

app.get("/api/admin/vehicles", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try { res.json({ data: await listVehicles(true, adminOrganizationId(req)) }); }
  catch (error) { console.error("Admin vehicle listing failed", error); res.status(500).json({ error: "No se pudo cargar el inventario" }); }
});

app.post("/api/admin/vehicles", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const vehicle = vehiclePayload(req.body);
  if (vehicle.status === "published" && req.admin.role !== "admin") vehicle.status = "pending_review";
  const validationError = validateVehicle(vehicle);
  if (validationError) return res.status(400).json({ error: validationError });
  const modelError = await validateModel3dUrl(vehicle.media.find((item) => item.type === "model_3d")?.url);
  if (modelError) return res.status(400).json({ error: modelError, code: "MODEL_3D_INVALID" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const planError = await vehiclePlanGuard(client, adminOrganizationId(req), 1);
    if (planError) { await client.query("ROLLBACK"); return res.status(planError.code === "SUBSCRIPTION_INACTIVE" ? 402 : 409).json(planError); }
    const brandId = await upsertTaxonomy(client, "vehicle_brands", vehicle.brand, vehicle.brandLogoUrl, adminOrganizationId(req));
    const categoryId = await upsertTaxonomy(client, "vehicle_categories", vehicle.category, null, adminOrganizationId(req));
    const inserted = await client.query(
      `INSERT INTO vehicles (organization_id, brand_id, category_id, model, variant, year, condition, price_usd, engine, power, transmission, drive, fuel_type, exterior_color, interior_color, doors, seats, location, stock_number, warranty, features, mileage_km, description, seo_title, seo_description, stock, status, max_discount_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING id`,
      [adminOrganizationId(req), brandId, categoryId, vehicle.model, vehicle.variant, vehicle.year, vehicle.condition, vehicle.priceUsd, vehicle.engine, vehicle.power, vehicle.transmission, vehicle.drive, vehicle.fuelType, vehicle.exteriorColor, vehicle.interiorColor, vehicle.doors, vehicle.seats, vehicle.location, vehicle.stockNumber, vehicle.warranty, vehicle.features, vehicle.mileageKm, vehicle.description, vehicle.seoTitle, vehicle.seoDescription, vehicle.stock, vehicle.status, vehicle.maxDiscountPercent],
    );
    for (const [sortOrder, imageUrl] of vehicle.images.entries()) await client.query("INSERT INTO vehicle_images (vehicle_id, image_url, alt_text, sort_order) VALUES ($1,$2,$3,$4)", [inserted.rows[0].id, imageUrl, vehicle.imageAltTexts[sortOrder] || `${vehicle.brand} ${vehicle.model} - vista ${sortOrder + 1}`, sortOrder]);
    await replaceVehicleMedia(client, inserted.rows[0].id, vehicle.media);
    await client.query("COMMIT");
    await writeAudit(req, "vehicle.create", "vehicle", inserted.rows[0].id, { status: vehicle.status, imageCount: vehicle.images.length, mediaCount: vehicle.media.length });
    if (vehicle.status === "pending_review") await notifyAdmins({ organizationId: adminOrganizationId(req), type: "vehicle_review", title: "Vehículo pendiente de revisión", body: `${vehicle.brand} ${vehicle.model} fue enviado para aprobación.`, entityType: "vehicle", entityId: inserted.rows[0].id });
    res.status(201).json({ data: (await listVehicles(true, adminOrganizationId(req))).find((item) => item.id === inserted.rows[0].id) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Vehicle creation failed", error);
    res.status(500).json({ error: "No se pudo crear el vehículo" });
  } finally { client.release(); }
});

app.post("/api/admin/vehicles/:id/duplicate", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const planError = await vehiclePlanGuard(client, adminOrganizationId(req), 1);
    if (planError) { await client.query("ROLLBACK"); return res.status(planError.code === "SUBSCRIPTION_INACTIVE" ? 402 : 409).json(planError); }
    const source = await client.query("SELECT * FROM vehicles WHERE id=$1 AND organization_id=$2", [req.params.id, adminOrganizationId(req)]);
    if (!source.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Vehículo no encontrado" }); }
    const vehicle = source.rows[0];
    const copied = await client.query(
      `INSERT INTO vehicles (organization_id, brand_id, category_id, model, variant, year, condition, price_usd, engine, power, transmission, drive, fuel_type, exterior_color, interior_color, doors, seats, location, stock_number, warranty, features, mileage_km, description, seo_title, seo_description, stock, status, max_discount_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NULL,$19,$20,$21,$22,$23,$24,$25,'draft',$26) RETURNING id`,
      [adminOrganizationId(req), vehicle.brand_id, vehicle.category_id, `${vehicle.model} · copia`, vehicle.variant, vehicle.year, vehicle.condition, vehicle.price_usd, vehicle.engine, vehicle.power, vehicle.transmission, vehicle.drive, vehicle.fuel_type, vehicle.exterior_color, vehicle.interior_color, vehicle.doors, vehicle.seats, vehicle.location, vehicle.warranty, vehicle.features, vehicle.mileage_km, vehicle.description, vehicle.seo_title, vehicle.seo_description, vehicle.stock, vehicle.max_discount_percent],
    );
    await client.query("INSERT INTO vehicle_images (vehicle_id, image_url, alt_text, sort_order) SELECT $1, image_url, alt_text, sort_order FROM vehicle_images WHERE vehicle_id=$2", [copied.rows[0].id, req.params.id]);
    await client.query("INSERT INTO vehicle_media (vehicle_id, media_type, url, poster_url, alt_text, sort_order, is_active, metadata) SELECT $1, media_type, url, poster_url, alt_text, sort_order, is_active, metadata FROM vehicle_media WHERE vehicle_id=$2", [copied.rows[0].id, req.params.id]);
    await client.query("COMMIT");
    await writeAudit(req, "vehicle.duplicate", "vehicle", copied.rows[0].id, { sourceId: req.params.id });
    res.status(201).json({ data: (await listVehicles(true, adminOrganizationId(req))).find((item) => item.id === copied.rows[0].id) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Vehicle duplication failed", error);
    res.status(500).json({ error: "No se pudo duplicar el vehículo" });
  } finally { client.release(); }
});

app.put("/api/admin/vehicles/:id", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const vehicle = vehiclePayload(req.body);
  if (vehicle.status === "published" && req.admin.role !== "admin") vehicle.status = "pending_review";
  const validationError = validateVehicle(vehicle);
  if (validationError) return res.status(400).json({ error: validationError });
  const modelError = await validateModel3dUrl(vehicle.media.find((item) => item.type === "model_3d")?.url);
  if (modelError) return res.status(400).json({ error: modelError, code: "MODEL_3D_INVALID" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const brandId = await upsertTaxonomy(client, "vehicle_brands", vehicle.brand, vehicle.brandLogoUrl, adminOrganizationId(req));
    const categoryId = await upsertTaxonomy(client, "vehicle_categories", vehicle.category, null, adminOrganizationId(req));
    const updated = await client.query(
       `UPDATE vehicles SET brand_id=$1, category_id=$2, model=$3, variant=$4, year=$5, condition=$6, price_usd=$7, engine=$8, power=$9, transmission=$10, drive=$11, fuel_type=$12, exterior_color=$13, interior_color=$14, doors=$15, seats=$16, location=$17, stock_number=$18, warranty=$19, features=$20, mileage_km=$21, description=$22, seo_title=$23, seo_description=$24, stock=$25, status=$26, max_discount_percent=$27, updated_at=NOW() WHERE id=$28 AND organization_id=$29 RETURNING id`,
      [brandId, categoryId, vehicle.model, vehicle.variant, vehicle.year, vehicle.condition, vehicle.priceUsd, vehicle.engine, vehicle.power, vehicle.transmission, vehicle.drive, vehicle.fuelType, vehicle.exteriorColor, vehicle.interiorColor, vehicle.doors, vehicle.seats, vehicle.location, vehicle.stockNumber, vehicle.warranty, vehicle.features, vehicle.mileageKm, vehicle.description, vehicle.seoTitle, vehicle.seoDescription, vehicle.stock, vehicle.status, vehicle.maxDiscountPercent, req.params.id, adminOrganizationId(req)],
    );
    if (!updated.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Vehículo no encontrado" }); }
    await client.query("DELETE FROM vehicle_images WHERE vehicle_id = $1", [req.params.id]);
    for (const [sortOrder, imageUrl] of vehicle.images.entries()) await client.query("INSERT INTO vehicle_images (vehicle_id, image_url, alt_text, sort_order) VALUES ($1,$2,$3,$4)", [req.params.id, imageUrl, vehicle.imageAltTexts[sortOrder] || `${vehicle.brand} ${vehicle.model} - vista ${sortOrder + 1}`, sortOrder]);
    await replaceVehicleMedia(client, req.params.id, vehicle.media);
    await client.query("COMMIT");
    await writeAudit(req, "vehicle.update", "vehicle", req.params.id, { status: vehicle.status, imageCount: vehicle.images.length, mediaCount: vehicle.media.length });
    if (vehicle.status === "pending_review") await notifyAdmins({ organizationId: adminOrganizationId(req), type: "vehicle_review", title: "Vehículo pendiente de revisión", body: `${vehicle.brand} ${vehicle.model} fue enviado para aprobación.`, entityType: "vehicle", entityId: req.params.id });
    res.json({ data: (await listVehicles(true, adminOrganizationId(req))).find((item) => item.id === req.params.id) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Vehicle update failed", error);
    res.status(500).json({ error: "No se pudo actualizar el vehículo" });
  } finally { client.release(); }
});

app.patch("/api/admin/vehicles/:id/review", authenticate, requireRoles("admin"), async (req, res) => {
  const decision = req.body?.decision === "approve" ? "published" : req.body?.decision === "reject" ? "draft" : null;
  if (!decision) return res.status(400).json({ error: "La decisión debe ser approve o reject" });
  try {
      const result = await pool.query("UPDATE vehicles SET status=$1, updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND status='pending_review' RETURNING id, status", [decision, req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Vehículo no encontrado o no está pendiente de revisión" });
    await writeAudit(req, `vehicle.${decision === "published" ? "approve" : "reject"}`, "vehicle", req.params.id, { decision, note: String(req.body?.note || "").slice(0, 240) });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Vehicle review failed", error); res.status(500).json({ error: "No se pudo revisar el vehículo" }); }
});

// Cambio de estado comercial sin reenviar la ficha completa (reservar, vender, reactivar).
app.patch("/api/admin/vehicles/:id/status", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const status = String(req.body?.status || "");
  if (!["draft", "published", "reserved", "sold", "inactive"].includes(status)) return res.status(400).json({ error: "Estado no válido" });
  if (status === "published" && req.admin.role !== "admin") return res.status(403).json({ error: "Solo un administrador puede publicar directamente" });
  try {
    if (status === "published") {
      const ready = await pool.query("SELECT (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id=$1)::int AS images, description, price_usd AS price FROM vehicles WHERE id=$1 AND organization_id=$2", [req.params.id, adminOrganizationId(req)]);
      if (!ready.rowCount) return res.status(404).json({ error: "Vehículo no encontrado" });
      const row = ready.rows[0];
      if (!row.images || !String(row.description || "").trim() || !(Number(row.price) > 0)) {
        return res.status(400).json({ error: "Para publicar, el vehículo necesita al menos una imagen, una descripción y un precio." });
      }
    }
    const result = await pool.query('UPDATE vehicles SET status=$1, updated_at=NOW() WHERE id=$2 AND organization_id=$3 RETURNING id, status', [status, req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Vehículo no encontrado" });
    await writeAudit(req, "vehicle.status_update", "vehicle", req.params.id, { status });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Vehicle status update failed", error); res.status(500).json({ error: "No se pudo actualizar el estado" }); }
});

app.delete("/api/admin/vehicles/:id", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  try {
    const result = await pool.query("UPDATE vehicles SET status='inactive', updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING id", [req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Vehículo no encontrado" });
    await writeAudit(req, "vehicle.archive", "vehicle", req.params.id);
    res.status(204).end();
  } catch (error) { console.error("Vehicle deactivation failed", error); res.status(500).json({ error: "No se pudo desactivar el vehículo" }); }
});

app.get("/api/admin/leads", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.id, l.lead_type AS "leadType", l.name, l.email, l.phone, l.message, l.source, l.status, l.notes, l.priority, l.next_action AS "nextAction", l.next_action_at AS "nextActionAt", l.lost_reason AS "lostReason", l.closed_at AS "closedAt",
             l.created_at AS "createdAt", l.updated_at AS "updatedAt", l.last_contacted_at AS "lastContactedAt",
             v.id AS "vehicleId", v.model, v.year, b.name AS brand, l.assigned_to AS "assignedToId", au.full_name AS "assignedTo",
             appointment.id AS "appointmentId", appointment.requested_date AS "appointmentDate", appointment.requested_time AS "appointmentTime", appointment.status AS "appointmentStatus"
      FROM leads l
      LEFT JOIN vehicles v ON v.id = l.vehicle_id
      LEFT JOIN vehicle_brands b ON b.id = v.brand_id
      LEFT JOIN admin_users au ON au.id = l.assigned_to
       LEFT JOIN LATERAL (SELECT id, requested_date, requested_time, status FROM test_drive_requests WHERE lead_id=l.id AND organization_id=$1 ORDER BY created_at DESC LIMIT 1) appointment ON TRUE
       WHERE l.organization_id=$1
       ORDER BY l.created_at DESC
    `, [adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) {
    console.error("Leads query failed", error);
    res.status(500).json({ error: "No se pudieron cargar los leads" });
  }
});

app.get("/api/admin/appointments", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  const from = isIsoDate(String(req.query.from || "")) ? String(req.query.from) : null;
  const to = isIsoDate(String(req.query.to || "")) ? String(req.query.to) : null;
  try {
    const result = await pool.query(`
      SELECT t.id, t.vehicle_id AS "vehicleId", t.lead_id AS "leadId", t.customer_name AS "customerName", t.customer_email AS "customerEmail", t.customer_phone AS "customerPhone", t.requested_date AS "date", t.requested_time AS "time", t.status, t.notes, t.created_at AS "createdAt", v.model, v.year, b.name AS brand
      FROM test_drive_requests t
      LEFT JOIN vehicles v ON v.id=t.vehicle_id
      LEFT JOIN vehicle_brands b ON b.id=v.brand_id
      WHERE ($1::date IS NULL OR t.requested_date >= $1::date) AND ($2::date IS NULL OR t.requested_date <= $2::date)
      AND t.organization_id=$3
      ORDER BY t.requested_date ASC, t.requested_time ASC, t.created_at DESC`, [from, to, adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) { console.error("Appointments query failed", error); res.status(500).json({ error: "No se pudieron cargar las citas" }); }
});

app.post("/api/admin/appointments", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  const leadId = String(req.body.leadId || "").trim();
  const date = String(req.body.date || "").trim();
  const time = String(req.body.time || "").trim();
  const notes = String(req.body.notes || "").trim() || null;
  if (!leadId || !isIsoDate(date) || timeToMinutes(time) === null) return res.status(400).json({ error: "Interesado, fecha y horario son obligatorios" });
  try {
    const availability = await appointmentAvailability(date, adminOrganizationId(req));
    const slot = availability.slots.find((item) => item.time === time);
    if (!slot || !slot.available) return res.status(409).json({ error: "Ese horario no está disponible. Selecciona otro." });
    const client = await pool.connect();
    let appointment;
    try {
      await client.query("BEGIN");
      const leadResult = await client.query(
        `SELECT l.id, l.vehicle_id AS "vehicleId", l.name, l.email, l.phone, l.assigned_to AS "assignedTo"
         FROM leads l WHERE l.id=$1 AND l.organization_id=$2 FOR UPDATE`,
        [leadId, adminOrganizationId(req)],
      );
      if (!leadResult.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Interesado no encontrado" }); }
      const lead = leadResult.rows[0];
      if (!lead.vehicleId) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Este interesado no tiene un vehículo asociado" }); }
      const settings = await client.query("SELECT appointment_capacity AS capacity FROM organization_settings WHERE organization_id=$1 FOR UPDATE", [adminOrganizationId(req)]);
      const capacity = Number(settings.rows[0]?.capacity || 1);
      const booked = await client.query("SELECT COUNT(*)::int AS count FROM test_drive_requests WHERE organization_id=$1 AND requested_date=$2::date AND requested_time=$3::time AND status IN ('pending','confirmed')", [adminOrganizationId(req), date, time]);
      if (Number(booked.rows[0].count) >= capacity) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Ese horario acaba de completarse. Selecciona otro." }); }
      const result = await client.query(
         `INSERT INTO test_drive_requests (organization_id, vehicle_id, lead_id, customer_name, customer_email, customer_phone, requested_date, requested_time, status, notes, assigned_to)
          VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::time,'confirmed',$9,$10)
          RETURNING id, vehicle_id AS "vehicleId", lead_id AS "leadId", requested_date AS "date", requested_time AS "time", status, notes, created_at AS "createdAt"`,
         [adminOrganizationId(req), lead.vehicleId, lead.id, lead.name, lead.email, lead.phone, date, time, notes, lead.assignedTo || req.admin.id],
      );
      appointment = result.rows[0];
      await client.query("INSERT INTO lead_events (lead_id, actor_id, event_type, note) VALUES ($1,$2,'appointment_created',$3)", [lead.id, req.admin.id, `Cita confirmada para ${date} a las ${time}`]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    await notifyAdmins({ organizationId: adminOrganizationId(req), type: "appointment", title: "Cita agregada desde un interesado", body: `Se agendó una cita para ${date} a las ${time}.`, entityType: "appointment", entityId: appointment.id });
    await syncAppointmentToGoogle(adminOrganizationId(req), appointment.id);
    res.status(201).json({ data: appointment });
  } catch (error) {
    console.error("Admin appointment creation failed", error);
    res.status(500).json({ error: "No se pudo crear la cita" });
  }
});

app.patch("/api/admin/appointments/:id", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  const status = String(req.body.status || "pending");
  const notes = String(req.body.notes || "").trim() || null;
  if (!["pending", "confirmed", "cancelled"].includes(status)) return res.status(400).json({ error: "Estado de cita no válido" });
  try {
    const result = await pool.query(`UPDATE test_drive_requests SET status=$1, notes=$2 WHERE id=$3 AND organization_id=$4 RETURNING id, status, notes, requested_date AS "date", requested_time AS "time"`, [status, notes, req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Cita no encontrada" });
    await syncAppointmentToGoogle(adminOrganizationId(req), req.params.id);
    await writeAudit(req, "appointment.update", "appointment", req.params.id, { status });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Appointment update failed", error); res.status(500).json({ error: "No se pudo actualizar la cita" }); }
});

app.get("/api/admin/appointment-blocks", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const from = isIsoDate(String(req.query.from || "")) ? String(req.query.from) : null;
  const to = isIsoDate(String(req.query.to || "")) ? String(req.query.to) : null;
  try {
     const result = await pool.query(`SELECT id, block_date AS "date", start_time AS "start", end_time AS "end", reason, created_at AS "createdAt" FROM appointment_blocks WHERE organization_id=$3 AND ($1::date IS NULL OR block_date >= $1::date) AND ($2::date IS NULL OR block_date <= $2::date) ORDER BY block_date ASC, start_time ASC NULLS FIRST`, [from, to, adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) { console.error("Appointment blocks query failed", error); res.status(500).json({ error: "No se pudieron cargar los bloqueos" }); }
});

app.post("/api/admin/appointment-blocks", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const date = String(req.body.date || "").trim();
  const start = String(req.body.start || "").trim() || null;
  const end = String(req.body.end || "").trim() || null;
  const reason = String(req.body.reason || "").trim();
  if (!isIsoDate(date) || !reason || (start && timeToMinutes(start) === null) || (end && timeToMinutes(end) === null) || (!!start !== !!end) || (start && end && timeToMinutes(end) <= timeToMinutes(start))) return res.status(400).json({ error: "Fecha, motivo y un rango de horas válido son obligatorios" });
  try {
     const result = await pool.query(`INSERT INTO appointment_blocks (organization_id, block_date, start_time, end_time, reason, created_by) VALUES ($1,$2::date,$3::time,$4::time,$5,$6) RETURNING id, block_date AS "date", start_time AS "start", end_time AS "end", reason, created_at AS "createdAt"`, [adminOrganizationId(req), date, start, end, reason, req.admin.id]);
    await writeAudit(req, "appointment_block.create", "appointment_block", result.rows[0].id, { date, start, end, reason });
    res.status(201).json({ data: result.rows[0] });
  } catch (error) { console.error("Appointment block creation failed", error); res.status(500).json({ error: "No se pudo crear el bloqueo" }); }
});

app.delete("/api/admin/appointment-blocks/:id", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  try {
     const result = await pool.query("DELETE FROM appointment_blocks WHERE id=$1 AND organization_id=$2 RETURNING id", [req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Bloqueo no encontrado" });
    await writeAudit(req, "appointment_block.delete", "appointment_block", req.params.id);
    res.status(204).end();
  } catch (error) { console.error("Appointment block deletion failed", error); res.status(500).json({ error: "No se pudo eliminar el bloqueo" }); }
});

app.patch("/api/admin/leads/:id", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  const status = String(req.body.status || "new");
  const notes = String(req.body.notes || "").trim() || null;
  const assignedTo = String(req.body.assignedTo || "").trim() || null;
  const priority = Number(req.body.priority || 2);
  const nextAction = String(req.body.nextAction || "").trim() || null;
  const nextActionAt = String(req.body.nextActionAt || "").trim() || null;
  const lostReason = String(req.body.lostReason || "").trim() || null;
  if (!["new", "contacted", "qualified", "closed", "lost"].includes(status)) return res.status(400).json({ error: "Estado de lead no válido" });
  if (![1, 2, 3].includes(priority)) return res.status(400).json({ error: "La prioridad no es válida" });
  if (status === "lost" && !lostReason) return res.status(400).json({ error: "Indica el motivo de pérdida" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
     const current = await client.query("SELECT status, notes FROM leads WHERE id=$1 AND organization_id=$2", [req.params.id, adminOrganizationId(req)]);
    if (!current.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Lead no encontrado" }); }
    if (assignedTo) {
       const assignee = await client.query("SELECT id FROM admin_users WHERE id=$1 AND organization_id=$2 AND is_active=TRUE", [assignedTo, adminOrganizationId(req)]);
      if (!assignee.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Usuario asignado no válido" }); }
    }
    const result = await client.query(
       `UPDATE leads SET status=$1::varchar, notes=$2::text, assigned_to=$3::uuid, priority=$4::smallint, next_action=$5::varchar, next_action_at=$6::timestamptz, lost_reason=$7::varchar, closed_at=CASE WHEN $1::varchar='closed' THEN COALESCE(closed_at, NOW()) ELSE NULL::timestamptz END, updated_at=NOW(), last_contacted_at=CASE WHEN $1::varchar IN ('contacted','qualified','closed') THEN NOW() ELSE last_contacted_at END
        WHERE id=$8::uuid AND organization_id=$9 RETURNING id, status, notes, assigned_to AS "assignedTo", priority, next_action AS "nextAction", next_action_at AS "nextActionAt", lost_reason AS "lostReason", closed_at AS "closedAt", updated_at AS "updatedAt"`,
       [status, notes, assignedTo, priority, nextAction, nextActionAt, lostReason, req.params.id, adminOrganizationId(req)],
    );
    if (current.rows[0].status !== status) await client.query("INSERT INTO lead_events (lead_id, actor_id, event_type, note) VALUES ($1,$2,'status_change',$3)", [req.params.id, req.admin.id, `Estado cambiado a ${status}`]);
    if (current.rows[0].notes !== notes) await client.query("INSERT INTO lead_events (lead_id, actor_id, event_type, note) VALUES ($1,$2,'note',$3)", [req.params.id, req.admin.id, notes]);
    await client.query("COMMIT");
    await writeAudit(req, "lead.update", "lead", req.params.id, { status, priority, nextAction, nextActionAt, lostReason });
    res.json({ data: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Lead update failed", error);
    res.status(500).json({ error: "No se pudo actualizar el lead" });
  } finally { client.release(); }
});

app.get("/api/admin/leads/:id/events", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
     const result = await pool.query(`SELECT e.id, e.event_type AS "eventType", e.note, e.created_at AS "createdAt", au.full_name AS "actorName" FROM lead_events e LEFT JOIN admin_users au ON au.id = e.actor_id JOIN leads l ON l.id=e.lead_id WHERE e.lead_id=$1 AND l.organization_id=$2 ORDER BY e.created_at DESC`, [req.params.id, adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) {
    console.error("Lead events query failed", error);
    res.status(500).json({ error: "No se pudo cargar el historial" });
  }
});

app.get("/api/admin/notifications", authenticate, requireRoles("admin", "editor", "seller", "content_editor"), async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, notification_type AS "type", title, body, entity_type AS "entityType", entity_id AS "entityId", read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`, [req.admin.id]);
    res.json({ data: result.rows, unread: result.rows.filter((item) => !item.readAt).length });
  } catch (error) { console.error("Notifications query failed", error); res.status(500).json({ error: "No se pudieron cargar las notificaciones" }); }
});

app.patch("/api/admin/notifications/read", authenticate, requireRoles("admin", "editor", "seller", "content_editor"), async (req, res) => {
  try {
    await pool.query("UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL", [req.admin.id]);
    res.status(204).end();
  } catch (error) { console.error("Notifications update failed", error); res.status(500).json({ error: "No se pudieron actualizar las notificaciones" }); }
});

// Sin restricción de rol: cualquier sesión autenticada puede cambiar su propia contraseña,
// incluida una marcada mustChangePassword (es la única ruta que `authenticate` deja pasar en ese estado).
app.post("/api/auth/change-password", authenticate, async (req, res) => {
  const newPassword = String(req.body?.newPassword || "");
  if (newPassword.length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres" });
  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const result = await pool.query(
      "UPDATE admin_users SET password_hash=$1, must_change_password=FALSE, updated_at=NOW() WHERE id=$2 AND is_active=TRUE RETURNING id, full_name, email, role",
      [passwordHash, req.admin.id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Cuenta no encontrada" });
    await writeAudit(req, "user.password_change", "admin_user", req.admin.id, {});
    const admin = result.rows[0];
    const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role, name: admin.full_name, mustChangePassword: false }, jwtSecret, { expiresIn: "8h" });
    setSessionCookie(res, ADMIN_SESSION_COOKIE, token, 28800);
    res.json({ token, user: { id: admin.id, name: admin.full_name, email: admin.email, role: admin.role, mustChangePassword: false } });
  } catch (error) { console.error("Password change failed", error); res.status(500).json({ error: "No se pudo cambiar la contraseña" }); }
});

app.post("/api/auth/logout", (_req, res) => { clearSessionCookie(res, ADMIN_SESSION_COOKIE); res.status(204).end(); });
app.post("/api/customer/auth/logout", (_req, res) => { clearSessionCookie(res, CUSTOMER_SESSION_COOKIE); res.status(204).end(); });

app.get("/api/admin/users", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  // seller solo necesita nombres para asignar leads/citas, no el directorio completo
  // (correo, rol) del resto del equipo.
  const canSeeDirectory = ["admin", "editor"].includes(req.admin.role);
  try {
     const result = await pool.query(
       `SELECT id, full_name AS "name"${canSeeDirectory ? ', email, role' : ''} FROM admin_users WHERE organization_id=$1 AND is_active=TRUE ORDER BY full_name`,
       [adminOrganizationId(req)],
     );
    res.json({ data: result.rows });
  } catch (error) { console.error("Admin users query failed", error); res.status(500).json({ error: "No se pudieron cargar los usuarios" }); }
});

app.get("/api/admin/users/manage", authenticate, requireRoles("admin"), async (req, res) => {
  try {
     const result = await pool.query('SELECT id, full_name AS "name", email, role, is_active AS "isActive", created_at AS "createdAt" FROM admin_users WHERE organization_id=$1 ORDER BY is_active DESC, full_name', [adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) { console.error("Admin user management query failed", error); res.status(500).json({ error: "No se pudieron cargar los usuarios" }); }
});

app.post("/api/admin/users", authenticate, requireRoles("admin"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = ["admin", "seller", "editor", "content_editor"].includes(req.body.role) ? req.body.role : "seller";
  if (!name || !email || password.length < 8) return res.status(400).json({ error: "Nombre, correo y una contraseña de al menos 8 caracteres son obligatorios" });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query('INSERT INTO admin_users (full_name, email, password_hash, role, organization_id) SELECT $1,$2,$3,$4,organization_id FROM admin_users WHERE id=$5 RETURNING id, full_name AS "name", email, role, is_active AS "isActive", created_at AS "createdAt"', [name, email, passwordHash, role, req.admin.id]);
    await writeAudit(req, "user.create", "admin_user", result.rows[0].id, { email, role });
    res.status(201).json({ data: result.rows[0] });
  } catch (error) { console.error("Admin user creation failed", error); res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Ese correo ya está registrado" : "No se pudo crear el usuario" }); }
});

// Recuperación de contraseña, mitad mediada por administrador: sin credenciales SMTP
// configuradas, un flujo de "olvidé mi contraseña" autoservido por correo no es viable
// todavía (queda documentado como pendiente). Esto sí es completable ahora: un admin
// genera una contraseña temporal que entrega fuera de banda (en persona, teléfono), y el
// titular queda obligado a reemplazarla en su primer inicio de sesión.
app.post("/api/admin/users/:id/reset-password", authenticate, requireRoles("admin"), async (req, res) => {
  try {
    const temporaryPassword = crypto.randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const result = await pool.query(
       "UPDATE admin_users SET password_hash=$1, must_change_password=TRUE, updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND is_active=TRUE RETURNING id, email, full_name AS \"name\"",
       [passwordHash, req.params.id, adminOrganizationId(req)],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Usuario no encontrado o inactivo" });
    await writeAudit(req, "user.password_reset", "admin_user", req.params.id, { email: result.rows[0].email });
    // La contraseña en claro solo existe en esta respuesta: no se guarda ni se registra en la auditoría.
    res.json({ data: { id: result.rows[0].id, email: result.rows[0].email, name: result.rows[0].name, temporaryPassword } });
  } catch (error) { console.error("Admin password reset failed", error); res.status(500).json({ error: "No se pudo restablecer la contraseña" }); }
});

app.patch("/api/admin/users/:id", authenticate, requireRoles("admin"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  const role = ["admin", "seller", "editor", "content_editor"].includes(req.body.role) ? req.body.role : "seller";
  const isActive = req.body.isActive !== false;
  if (!name) return res.status(400).json({ error: "El nombre es obligatorio" });
  if (req.params.id === req.admin.id && !isActive) return res.status(400).json({ error: "No puedes desactivar tu propia cuenta" });
  try {
    const result = await pool.query('UPDATE admin_users SET full_name=$1, role=$2, is_active=$3, updated_at=NOW() WHERE id=$4 AND organization_id=$5 RETURNING id, full_name AS "name", email, role, is_active AS "isActive", created_at AS "createdAt"', [name, role, isActive, req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Usuario no encontrado" });
    await writeAudit(req, "user.update", "admin_user", req.params.id, { role, isActive });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Admin user update failed", error); res.status(500).json({ error: "No se pudo actualizar el usuario" }); }
});

app.delete("/api/admin/users/:id", authenticate, requireRoles("admin"), async (req, res) => {
  if (req.params.id === req.admin.id) return res.status(400).json({ error: "No puedes eliminar tu propia cuenta" });
  try {
    const result = await pool.query('DELETE FROM admin_users WHERE id=$1 AND organization_id=$2 RETURNING id, email', [req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Usuario no encontrado" });
    await writeAudit(req, "user.delete", "admin_user", req.params.id, { email: result.rows[0].email });
    res.status(204).end();
  } catch (error) {
    // FK sin ON DELETE CASCADE/SET NULL (p. ej. vehículos que este usuario revisó): no se puede
    // borrar sin perder ese historial. Desactivar sigue siendo la opción segura en ese caso.
    if (error.code === "23503") return res.status(409).json({ error: "Este usuario tiene actividad registrada (revisiones, etc.) y no se puede eliminar. Desactívalo en su lugar." });
    console.error("Admin user delete failed", error);
    res.status(500).json({ error: "No se pudo eliminar el usuario" });
  }
});

app.get("/api/admin/settings", authenticate, requireRoles("admin", "editor", "content_editor"), async (req, res) => {
  try {
    const result = await pool.query('SELECT organization_id AS "organizationId", business_name AS "businessName", logo_url AS "logoUrl", primary_color AS "primaryColor", accent_color AS "accentColor", favicon_url AS "faviconUrl", phone, whatsapp, email, address, hours, instagram_url AS "instagramUrl", facebook_url AS "facebookUrl", currency, privacy_text AS "privacyText", terms_text AS "termsText", appointment_timezone AS "appointmentTimezone", appointment_start AS "appointmentStart", appointment_end AS "appointmentEnd", appointment_duration_minutes AS "appointmentDurationMinutes", appointment_min_notice_hours AS "appointmentMinNoticeHours", appointment_max_days_ahead AS "appointmentMaxDaysAhead", appointment_days AS "appointmentDays", appointment_capacity AS "appointmentCapacity", hero_headline AS "heroHeadline", hero_subheadline AS "heroSubheadline", hero_image_url AS "heroImageUrl", show_financing AS "showFinancing", show_brand_rail AS "showBrandRail", show_model_line_rail AS "showModelLineRail", show_blog AS "showBlog", updated_at AS "updatedAt" FROM organization_settings WHERE organization_id=$1', [adminOrganizationId(req)]);
    res.json({ data: result.rows[0] || null });
  } catch (error) { console.error("Business settings query failed", error); res.status(500).json({ error: "No se pudo cargar la configuración" }); }
});

app.patch("/api/admin/settings", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const normalizeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback;
  const normalizeTime = (value, fallback) => {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return fallback;
    return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
  };
  const settings = {
    businessName: String(req.body.businessName || "AUTHENTIQ").trim(), logoUrl: String(req.body.logoUrl || "").trim() || null,
    primaryColor: normalizeColor(req.body.primaryColor, "#c8a24b"), accentColor: normalizeColor(req.body.accentColor, "#b28b37"), faviconUrl: String(req.body.faviconUrl || "").trim() || null,
    phone: String(req.body.phone || "").trim() || null, whatsapp: String(req.body.whatsapp || "").trim() || null,
    email: String(req.body.email || "").trim() || null, address: String(req.body.address || "").trim() || null,
    hours: String(req.body.hours || "").trim() || null, instagramUrl: String(req.body.instagramUrl || "").trim() || null,
    facebookUrl: String(req.body.facebookUrl || "").trim() || null, currency: String(req.body.currency || "USD").trim().toUpperCase(),
    privacyText: String(req.body.privacyText || "").trim() || null, termsText: String(req.body.termsText || "").trim() || null,
    appointmentTimezone: String(req.body.appointmentTimezone || "America/Santo_Domingo").trim(), appointmentStart: normalizeTime(req.body.appointmentStart, "09:00"), appointmentEnd: normalizeTime(req.body.appointmentEnd, "18:00"), appointmentDurationMinutes: Number(req.body.appointmentDurationMinutes || 60), appointmentMinNoticeHours: Number(req.body.appointmentMinNoticeHours || 2), appointmentMaxDaysAhead: Number(req.body.appointmentMaxDaysAhead || 30), appointmentDays: Array.isArray(req.body.appointmentDays) ? req.body.appointmentDays.map(Number).filter((day) => day >= 1 && day <= 7) : [1, 2, 3, 4, 5, 6], appointmentCapacity: Number(req.body.appointmentCapacity || 1),
    heroHeadline: String(req.body.heroHeadline || "").trim().slice(0, 160) || null, heroSubheadline: String(req.body.heroSubheadline || "").trim().slice(0, 280) || null, heroImageUrl: String(req.body.heroImageUrl || "").trim() || null,
    showFinancing: req.body.showFinancing !== false, showBrandRail: req.body.showBrandRail !== false, showModelLineRail: req.body.showModelLineRail !== false, showBlog: req.body.showBlog !== false,
  };
  if (!settings.businessName) return res.status(400).json({ error: "El nombre del negocio es obligatorio" });
  try {
    if (settings.appointmentDurationMinutes < 15 || settings.appointmentDurationMinutes > 240 || settings.appointmentMinNoticeHours < 0 || settings.appointmentMaxDaysAhead < 1 || settings.appointmentMaxDaysAhead > 365 || settings.appointmentCapacity < 1 || settings.appointmentCapacity > 20 || timeToMinutes(settings.appointmentStart) === null || timeToMinutes(settings.appointmentEnd) === null || timeToMinutes(settings.appointmentEnd) <= timeToMinutes(settings.appointmentStart)) return res.status(400).json({ error: "La configuración de citas no es válida" });
    const values = [settings.businessName, settings.logoUrl, settings.phone, settings.whatsapp, settings.email, settings.address, settings.hours, settings.instagramUrl, settings.facebookUrl, settings.currency, settings.privacyText, settings.termsText, settings.appointmentTimezone, settings.appointmentStart, settings.appointmentEnd, settings.appointmentDurationMinutes, settings.appointmentMinNoticeHours, settings.appointmentMaxDaysAhead, settings.appointmentDays, settings.appointmentCapacity];
     const result = await pool.query('UPDATE organization_settings SET business_name=$1, logo_url=$2, phone=$3, whatsapp=$4, email=$5, address=$6, hours=$7, instagram_url=$8, facebook_url=$9, currency=$10, privacy_text=$11, terms_text=$12, appointment_timezone=$13, appointment_start=$14, appointment_end=$15, appointment_duration_minutes=$16, appointment_min_notice_hours=$17, appointment_max_days_ahead=$18, appointment_days=$19, appointment_capacity=$20, updated_at=NOW() WHERE organization_id=$21 RETURNING organization_id AS "organizationId", business_name AS "businessName", logo_url AS "logoUrl", phone, whatsapp, email, address, hours, instagram_url AS "instagramUrl", facebook_url AS "facebookUrl", currency, privacy_text AS "privacyText", terms_text AS "termsText", appointment_timezone AS "appointmentTimezone", appointment_start AS "appointmentStart", appointment_end AS "appointmentEnd", appointment_duration_minutes AS "appointmentDurationMinutes", appointment_min_notice_hours AS "appointmentMinNoticeHours", appointment_max_days_ahead AS "appointmentMaxDaysAhead", appointment_days AS "appointmentDays", appointment_capacity AS "appointmentCapacity", updated_at AS "updatedAt"', [...values, adminOrganizationId(req)]);
    await pool.query("UPDATE organization_settings SET primary_color=$1, accent_color=$2, favicon_url=$3, updated_at=NOW() WHERE organization_id=$4", [settings.primaryColor, settings.accentColor, settings.faviconUrl, adminOrganizationId(req)]);
    await pool.query(
      "UPDATE organization_settings SET hero_headline=$1, hero_subheadline=$2, hero_image_url=$3, show_financing=$4, show_brand_rail=$5, show_model_line_rail=$6, show_blog=$7, updated_at=NOW() WHERE organization_id=$8",
      [settings.heroHeadline, settings.heroSubheadline, settings.heroImageUrl, settings.showFinancing, settings.showBrandRail, settings.showModelLineRail, settings.showBlog, adminOrganizationId(req)],
    );
    const branding = await pool.query('SELECT primary_color AS "primaryColor", accent_color AS "accentColor", favicon_url AS "faviconUrl", hero_headline AS "heroHeadline", hero_subheadline AS "heroSubheadline", hero_image_url AS "heroImageUrl", show_financing AS "showFinancing", show_brand_rail AS "showBrandRail", show_model_line_rail AS "showModelLineRail", show_blog AS "showBlog" FROM organization_settings WHERE organization_id=$1', [adminOrganizationId(req)]);
    await writeAudit(req, "settings.update", "business_settings", null, { businessName: settings.businessName, primaryColor: settings.primaryColor, accentColor: settings.accentColor });
    res.json({ data: { ...(result.rows[0] || {}), ...(branding.rows[0] || {}) } });
  } catch (error) { console.error("Business settings update failed", error); res.status(500).json({ error: "No se pudo guardar la configuración" }); }
});

app.patch("/api/admin/settings/branding", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  const normalizeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback;
  const primaryColor = normalizeColor(req.body?.primaryColor, "#c8a24b");
  const accentColor = normalizeColor(req.body?.accentColor, "#b28b37");
  const faviconUrl = String(req.body?.faviconUrl || "").trim() || null;
  try {
    const result = await pool.query('UPDATE organization_settings SET primary_color=$1, accent_color=$2, favicon_url=$3, updated_at=NOW() WHERE organization_id=$4 RETURNING organization_id AS "organizationId", primary_color AS "primaryColor", accent_color AS "accentColor", favicon_url AS "faviconUrl"', [primaryColor, accentColor, faviconUrl, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Configuración de marca no encontrada" });
    await writeAudit(req, "branding.update", "organization_settings", adminOrganizationId(req), { primaryColor, accentColor, hasFavicon: Boolean(faviconUrl) });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Branding update failed", error); res.status(500).json({ error: "No se pudo guardar la identidad visual" }); }
});

app.get("/api/admin/organization", authenticate, requireRoles("admin"), async (req, res) => {
  try {
    const result = await pool.query(`SELECT o.id, o.slug, o.name, o.logo_url AS "logoUrl", o.custom_domain AS "customDomain", o.is_active AS "isActive", o.approval_status AS "approvalStatus", o.updated_at AS "updatedAt" FROM organizations o JOIN admin_users au ON au.organization_id=o.id WHERE au.id=$1`, [req.admin.id]);
    const organization = result.rows[0];
    if (organization) organization.subdomain = subdomainForSlug(organization.slug);
    res.json({ data: organization || null });
  } catch (error) { console.error("Organization query failed", error); res.status(500).json({ error: "No se pudo cargar el perfil del concesionario" }); }
});

app.patch("/api/admin/organization", authenticate, requireRoles("admin"), async (req, res) => {
  const name = String(req.body.name || "").trim();
  const slug = String(req.body.slug || "").trim().toLowerCase();
  const logoUrl = String(req.body.logoUrl || "").trim() || null;
  const customDomain = String(req.body.customDomain || "").trim().toLowerCase() || null;
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return res.status(400).json({ error: "Nombre y slug válido son obligatorios" });
  if (customDomain && (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(customDomain) || customDomain === "localhost")) return res.status(400).json({ error: "El dominio personalizado no es válido" });
  try {
    const organization = await pool.query("SELECT o.id FROM organizations o JOIN admin_users au ON au.organization_id=o.id WHERE au.id=$1", [req.admin.id]);
    if (!organization.rowCount) return res.status(404).json({ error: "Organización no encontrada" });
    const duplicate = await pool.query("SELECT id FROM organizations WHERE slug=$1 AND id<>$2", [slug, organization.rows[0].id]);
    if (duplicate.rowCount) return res.status(409).json({ error: "Ese slug ya está en uso" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`UPDATE organizations SET name=$1, slug=$2, logo_url=$3, custom_domain=$4, updated_at=NOW() WHERE id=$5 RETURNING id, slug, name, logo_url AS "logoUrl", custom_domain AS "customDomain", is_active AS "isActive", updated_at AS "updatedAt"`, [name, slug, logoUrl, customDomain, organization.rows[0].id]);
      await client.query("UPDATE organization_settings SET business_name=$1, logo_url=$2, updated_at=NOW() WHERE organization_id=$3", [name, logoUrl, organization.rows[0].id]);
      await client.query("COMMIT");
      await writeAudit(req, "organization.update", "organization", organization.rows[0].id, { name, slug });
      res.json({ data: result.rows[0] });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } catch (error) { console.error("Organization update failed", error); res.status(500).json({ error: "No se pudo guardar el perfil del concesionario" }); }
});

app.get("/api/admin/onboarding", authenticate, requireRoles("admin", "editor"), async (req, res) => {
  try {
    const organizationId = adminOrganizationId(req);
    const result = await pool.query(`
      SELECT o.name, o.slug, o.custom_domain AS "customDomain", o.logo_url AS "logoUrl",
             os.business_name AS "businessName", os.phone, os.whatsapp, os.email,
             os.privacy_text AS "privacyText", os.terms_text AS "termsText",
             os.instagram_url AS "instagramUrl", os.facebook_url AS "facebookUrl",
             os.appointment_start AS "appointmentStart", os.appointment_end AS "appointmentEnd",
             os.appointment_days AS "appointmentDays",
             (SELECT COUNT(*)::int FROM vehicles v WHERE v.organization_id=o.id AND v.status IN ('published','reserved')) AS "publishedVehicles",
             (SELECT COUNT(*)::int FROM admin_users au WHERE au.organization_id=o.id AND au.is_active=TRUE) AS "activeUsers"
      FROM organizations o
      JOIN organization_settings os ON os.organization_id=o.id
      WHERE o.id=$1
    `, [organizationId]);
    if (!result.rowCount) return res.status(404).json({ error: "Organización no encontrada" });
    const row = result.rows[0];
    const steps = [
      { id: "identity", group: "brand", essential: true, label: "Nombre del concesionario", detail: "Así te verá el comprador en todo el sitio.", done: Boolean(row.name && row.slug) },
      { id: "logo", group: "brand", essential: true, label: "Logo", detail: "Aparece en la navegación y en cada ficha.", done: Boolean(row.logoUrl) },
      { id: "catalog", group: "showcase", essential: true, label: "Primer vehículo publicado", detail: "Sin inventario no hay nada que enseñar.", done: Number(row.publishedVehicles) > 0 },
      { id: "contact", group: "operation", essential: true, label: "Cómo te contactan", detail: "Teléfono, WhatsApp o correo.", done: Boolean(row.phone || row.whatsapp || row.email) },
      { id: "appointments", group: "operation", essential: false, label: "Horario para visitas", detail: "Deja que reserven sin llamarte.", done: Boolean(row.appointmentStart && row.appointmentEnd && row.appointmentDays?.length) },
      { id: "legal", group: "operation", essential: true, label: "Privacidad y términos", detail: "Revísalos antes de compartir el enlace.", done: Boolean(row.privacyText && row.termsText && !/borrador|pendiente de revisión/i.test(`${row.privacyText} ${row.termsText}`)) },
      { id: "social", group: "showcase", essential: false, label: "Instagram y Facebook", detail: "Opcional: enlaza tus redes.", done: Boolean(row.instagramUrl || row.facebookUrl) },
      { id: "domain", group: "brand", essential: false, label: "Dominio propio", detail: "Opcional: usa tu propia dirección web.", done: Boolean(row.customDomain) },
    ];
    const completed = steps.filter((step) => step.done).length;
    const essential = steps.filter((step) => step.essential);
    const essentialDone = essential.filter((step) => step.done).length;
    res.json({ data: { steps, completed, total: steps.length, progress: Math.round((completed / steps.length) * 100), essentialTotal: essential.length, essentialDone, readyToPublish: essentialDone === essential.length, activeUsers: Number(row.activeUsers) } });
  } catch (error) { console.error("Onboarding query failed", error); res.status(500).json({ error: "No se pudo cargar el estado de inicio" }); }
});

function platformSetupProgress(row) {
  const steps = [
    Boolean(row.name && row.slug),
    Boolean(row.logoUrl),
    Boolean(row.phone || row.whatsapp || row.email),
    Number(row.publishedVehicles) > 0,
    Boolean(row.appointmentStart && row.appointmentEnd && row.appointmentDays?.length),
    Boolean(row.instagramUrl || row.facebookUrl),
    Boolean(row.privacyText && row.termsText && !/borrador|pendiente de revisión/i.test(`${row.privacyText} ${row.termsText}`)),
    Boolean(row.customDomain),
  ];
  return Math.round((steps.filter(Boolean).length / steps.length) * 100);
}

function dealerApprovalCheck(row) {
  const blockers = [];
  const recommendations = [];
  if (!row.logoUrl) blockers.push("logo del concesionario");
  if (!(row.phone || row.whatsapp || row.email)) blockers.push("canal de contacto");
  if (Number(row.publishedVehicles) <= 0) blockers.push("al menos un vehículo publicado");
  if (!(row.appointmentStart && row.appointmentEnd && row.appointmentDays?.length)) blockers.push("horarios de citas");
  if (!(row.privacyText && row.termsText && !/borrador|pendiente de revisión/i.test(`${row.privacyText} ${row.termsText}`))) blockers.push("políticas de privacidad y términos");
  if (!(row.instagramUrl || row.facebookUrl)) recommendations.push("conectar Instagram o Facebook");
  if (!row.customDomain) recommendations.push("configurar el dominio personalizado");
  return { blockers, recommendations, ready: blockers.length === 0 };
}

app.get("/api/platform/overview", authenticate, requireRoles("platform_admin"), async (_req, res) => {
  try {
    const [plans, organizations] = await Promise.all([
      pool.query("SELECT code, name, description, monthly_amount AS \"monthlyAmount\", vehicle_limit AS \"vehicleLimit\", features, is_active AS \"isActive\" FROM platform_plans WHERE is_active=TRUE ORDER BY monthly_amount, code"),
      pool.query(`
        SELECT o.id, o.slug, o.name, o.logo_url AS "logoUrl", o.custom_domain AS "customDomain", o.is_active AS "isActive", o.approval_status AS "approvalStatus", o.created_at AS "createdAt",
               COALESCE(bs.plan_code, 'starter') AS "planCode", COALESCE(bs.status, 'trialing') AS "subscriptionStatus", COALESCE(bs.monthly_amount, 0)::numeric AS "monthlyAmount", bs.current_period_end AS "currentPeriodEnd",
               (SELECT COUNT(*)::int FROM admin_users au WHERE au.organization_id=o.id AND au.is_active=TRUE) AS "activeUsers",
               (SELECT COUNT(*)::int FROM vehicles v WHERE v.organization_id=o.id) AS "totalVehicles",
               (SELECT COUNT(*)::int FROM vehicles v WHERE v.organization_id=o.id AND v.status IN ('published','reserved')) AS "publishedVehicles",
               (SELECT COUNT(*)::int FROM leads l WHERE l.organization_id=o.id AND l.created_at >= NOW() - INTERVAL '30 days') AS "recentLeads",
               os.business_name AS "businessName", os.phone, os.whatsapp, os.email, os.privacy_text AS "privacyText", os.terms_text AS "termsText",
               os.instagram_url AS "instagramUrl", os.facebook_url AS "facebookUrl", os.appointment_start AS "appointmentStart", os.appointment_end AS "appointmentEnd", os.appointment_days AS "appointmentDays",
               os.primary_color AS "primaryColor", os.accent_color AS "accentColor", os.custom_css AS "customCss"
        FROM organizations o
        LEFT JOIN organization_settings os ON os.organization_id=o.id
        LEFT JOIN billing_subscriptions bs ON bs.organization_id=o.id
        ORDER BY o.created_at DESC
      `),
    ]);
    const items = organizations.rows.map((row) => {
      const approval = dealerApprovalCheck(row);
      return { ...row, subdomain: subdomainForSlug(row.slug), setupProgress: platformSetupProgress(row), approvalReady: approval.ready, approvalBlockers: approval.blockers, approvalRecommendations: approval.recommendations };
    });
    const active = items.filter((item) => item.isActive);
    const pending = items.filter((item) => item.approvalStatus === "pending");
    res.json({ data: { plans: plans.rows, organizations: items, pendingApproval: pending, summary: { total: items.length, active: active.length, paused: items.length - active.length, pendingApproval: pending.length, monthlyRecurring: active.reduce((total, item) => total + Number(item.monthlyAmount || 0), 0), attention: items.filter((item) => item.setupProgress < 75 || ["past_due", "cancelled"].includes(item.subscriptionStatus)).length } } });
  } catch (error) { console.error("Platform overview failed", error); res.status(500).json({ error: "No se pudo cargar el centro de dealers" }); }
});

app.post("/api/platform/organizations", authenticate, requireRoles("platform_admin"), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const slug = String(req.body?.slug || "").trim().toLowerCase();
  const adminName = String(req.body?.adminName || "").trim();
  const adminEmail = String(req.body?.adminEmail || "").trim().toLowerCase();
  const adminPassword = String(req.body?.adminPassword || "");
  const planCode = String(req.body?.planCode || "starter").trim();
  const logoUrl = String(req.body?.logoUrl || "").trim() || null;
  const customDomain = String(req.body?.customDomain || "").trim().toLowerCase() || null;
  const normalizeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback;
  const primaryColor = normalizeColor(req.body?.primaryColor, "#c8a24b");
  const accentColor = normalizeColor(req.body?.accentColor, "#b28b37");
  if (name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || adminName.length < 2 || !/^\S+@\S+\.\S+$/.test(adminEmail) || adminPassword.length < 8) return res.status(400).json({ error: "Nombre, slug, administrador, correo y contraseña válida son obligatorios" });
  if (customDomain && (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(customDomain) || customDomain === "localhost")) return res.status(400).json({ error: "El dominio personalizado no es válido" });
  try {
    const plan = await pool.query("SELECT code, monthly_amount AS \"monthlyAmount\" FROM platform_plans WHERE code=$1 AND is_active=TRUE", [planCode]);
    if (!plan.rowCount) return res.status(400).json({ error: "El plan seleccionado no existe" });
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const organization = await client.query("INSERT INTO organizations (slug, name, logo_url, custom_domain, approval_status) VALUES ($1,$2,$3,$4,'approved') RETURNING id, slug, name, logo_url AS \"logoUrl\", custom_domain AS \"customDomain\", is_active AS \"isActive\", approval_status AS \"approvalStatus\", created_at AS \"createdAt\"", [slug, name, logoUrl, customDomain]);
      const organizationId = organization.rows[0].id;
      await client.query("INSERT INTO organization_settings (organization_id, business_name, logo_url, primary_color, accent_color) VALUES ($1,$2,$3,$4,$5)", [organizationId, name, logoUrl, primaryColor, accentColor]);
      await client.query("INSERT INTO organization_integrations (organization_id, provider, mode, status, config) VALUES ($1,'google_calendar','local','local_export_ready',$2::jsonb),($1,'meta_social','local','drafts_ready',$3::jsonb),($1,'billing','local_demo','trialing',$4::jsonb)", [organizationId, JSON.stringify({ calendarName: `Agenda de ${name}` }), JSON.stringify({ publishing: "manual" }), JSON.stringify({ checkout: "pending_provider" })]);
      await client.query("INSERT INTO billing_subscriptions (organization_id, provider, mode, plan_code, status, monthly_amount, currency, current_period_end) VALUES ($1,'local','local_demo',$2,'trialing',$3,'USD',CURRENT_DATE + 14)", [organizationId, planCode, plan.rows[0].monthlyAmount]);
      const admin = await client.query("INSERT INTO admin_users (full_name, email, password_hash, role, organization_id) VALUES ($1,$2,$3,'admin',$4) RETURNING id, full_name AS \"name\", email, role", [adminName, adminEmail, passwordHash, organizationId]);
      await client.query("INSERT INTO organization_members (organization_id, admin_user_id, role) VALUES ($1,$2,'admin')", [organizationId, admin.rows[0].id]);
      await client.query("COMMIT");
      await writeAudit(req, "platform.organization.create", "organization", organizationId, { slug, planCode, adminEmail, customDomain, hasLogo: Boolean(logoUrl), primaryColor, accentColor });
      res.status(201).json({ data: { ...organization.rows[0], planCode, subscriptionStatus: "trialing", admin: admin.rows[0] } });
    } catch (error) { await client.query("ROLLBACK"); if (error.code === "23505") return res.status(409).json({ error: "El slug, dominio o correo del administrador ya está en uso" }); throw error; } finally { client.release(); }
  } catch (error) { console.error("Platform organization create failed", error); if (!res.headersSent) res.status(500).json({ error: "No se pudo crear el dealer" }); }
});

app.patch("/api/platform/organizations/:id/status", authenticate, requireRoles("platform_admin"), async (req, res) => {
  const isActive = Boolean(req.body?.isActive);
  try {
    const result = await pool.query("UPDATE organizations SET is_active=$1, updated_at=NOW() WHERE id=$2 RETURNING id, slug, name, is_active AS \"isActive\"", [isActive, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Dealer no encontrado" });
    await writeAudit(req, "platform.organization.status", "organization", req.params.id, { isActive });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Platform organization status failed", error); res.status(500).json({ error: "No se pudo actualizar el estado del dealer" }); }
});

app.patch("/api/platform/organizations/:id/approval", authenticate, requireRoles("platform_admin"), async (req, res) => {
  const decision = String(req.body?.decision || "").trim();
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "Decisión inválida" });
  try {
    if (decision === "approved") {
      const organization = await pool.query(`
        SELECT o.id, o.name, o.slug, o.logo_url AS "logoUrl",
               os.phone, os.whatsapp, os.email, os.privacy_text AS "privacyText", os.terms_text AS "termsText",
               os.appointment_start AS "appointmentStart", os.appointment_end AS "appointmentEnd", os.appointment_days AS "appointmentDays",
               os.instagram_url AS "instagramUrl", os.facebook_url AS "facebookUrl",
               (SELECT COUNT(*)::int FROM vehicles v WHERE v.organization_id=o.id AND v.status IN ('published','reserved')) AS "publishedVehicles"
        FROM organizations o
        LEFT JOIN organization_settings os ON os.organization_id=o.id
        WHERE o.id=$1
      `, [req.params.id]);
      if (!organization.rowCount) return res.status(404).json({ error: "Dealer no encontrado" });
      const approval = dealerApprovalCheck(organization.rows[0]);
      if (!approval.ready) return res.status(409).json({ error: "Completa el onboarding antes de aprobar este dealer", code: "DEALER_SETUP_INCOMPLETE", blockers: approval.blockers, recommendations: approval.recommendations });
    }
    const result = await pool.query("UPDATE organizations SET approval_status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, slug, name, approval_status AS \"approvalStatus\"", [decision, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Dealer no encontrado" });
    await writeAudit(req, "platform.organization.approval", "organization", req.params.id, { decision });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Platform organization approval failed", error); res.status(500).json({ error: "No se pudo actualizar la aprobación del dealer" }); }
});

app.post("/api/platform/organizations/:id/impersonate", authenticate, requireRoles("platform_admin"), async (req, res) => {
  try {
    const target = await pool.query(
      `SELECT id, full_name AS "name", email, role, organization_id AS "organizationId"
       FROM admin_users WHERE organization_id=$1 AND is_active=TRUE
       ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`,
      [req.params.id],
    );
    if (!target.rowCount) return res.status(404).json({ error: "Este dealer no tiene una cuenta administrativa activa" });
    const admin = target.rows[0];
    // Sesión de soporte de corta duración: nunca se persiste en el almacenamiento
    // compartido del navegador del admin de plataforma (ver App.jsx / Backoffice.jsx).
    const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role, name: admin.name, organizationId: admin.organizationId, mustChangePassword: false, impersonatedBy: req.admin.id }, jwtSecret, { expiresIn: "20m" });
    await writeAudit(req, "platform.organization.impersonate", "organization", req.params.id, { targetAdminId: admin.id, targetEmail: admin.email });
    res.json({ data: { token, user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role, organizationId: admin.organizationId, mustChangePassword: false } } });
  } catch (error) { console.error("Platform organization impersonate failed", error); res.status(500).json({ error: "No se pudo iniciar la vista de soporte" }); }
});

app.patch("/api/platform/organizations/:id/branding", authenticate, requireRoles("platform_admin"), async (req, res) => {
  const logoUrl = String(req.body?.logoUrl || "").trim() || null;
  const customDomain = String(req.body?.customDomain || "").trim().toLowerCase() || null;
  const normalizeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback;
  const primaryColor = normalizeColor(req.body?.primaryColor, "#c8a24b");
  const accentColor = normalizeColor(req.body?.accentColor, "#b28b37");
  if (customDomain && (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(customDomain) || customDomain === "localhost")) return res.status(400).json({ error: "El dominio personalizado no es válido" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const organization = await client.query(
      `UPDATE organizations SET logo_url=$1, custom_domain=$2, updated_at=NOW() WHERE id=$3
       RETURNING id, slug, name, logo_url AS "logoUrl", custom_domain AS "customDomain"`,
      [logoUrl, customDomain, req.params.id],
    );
    if (!organization.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Dealer no encontrado" }); }
    await client.query(
      `UPDATE organization_settings SET logo_url=$1, primary_color=$2, accent_color=$3, updated_at=NOW() WHERE organization_id=$4`,
      [logoUrl, primaryColor, accentColor, req.params.id],
    );
    await client.query("COMMIT");
    await writeAudit(req, "platform.organization.branding", "organization", req.params.id, { customDomain, primaryColor, accentColor, hasLogo: Boolean(logoUrl) });
    res.json({ data: { ...organization.rows[0], primaryColor, accentColor } });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "Ese dominio ya está en uso por otro dealer" });
    console.error("Platform organization branding failed", error);
    res.status(500).json({ error: "No se pudo actualizar la marca del dealer" });
  } finally { client.release(); }
});

app.patch("/api/platform/organizations/:id/custom-css", authenticate, requireRoles("platform_admin"), async (req, res) => {
  const customCss = String(req.body?.customCss || "").slice(0, 20000);
  try {
    const result = await pool.query("UPDATE organization_settings SET custom_css=$1, updated_at=NOW() WHERE organization_id=$2 RETURNING organization_id AS \"organizationId\"", [customCss || null, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Dealer no encontrado" });
    await writeAudit(req, "platform.organization.custom_css", "organization", req.params.id, { length: customCss.length });
    res.json({ data: { organizationId: req.params.id, customCss } });
  } catch (error) { console.error("Platform organization custom CSS failed", error); res.status(500).json({ error: "No se pudo actualizar el CSS del dealer" }); }
});

app.patch("/api/platform/organizations/:id/subscription", authenticate, requireRoles("platform_admin"), async (req, res) => {
  const planCode = String(req.body?.planCode || "starter").trim();
  const status = ["trialing", "active", "past_due", "cancelled"].includes(req.body?.status) ? req.body.status : "trialing";
  try {
    const plan = await pool.query("SELECT code, monthly_amount AS \"monthlyAmount\" FROM platform_plans WHERE code=$1 AND is_active=TRUE", [planCode]);
    if (!plan.rowCount) return res.status(400).json({ error: "El plan seleccionado no existe" });
    const result = await pool.query("UPDATE billing_subscriptions SET plan_code=$1, status=$2, monthly_amount=$3, updated_at=NOW() WHERE organization_id=$4 RETURNING organization_id AS \"organizationId\", plan_code AS \"planCode\", status, monthly_amount AS \"monthlyAmount\", currency, current_period_end AS \"currentPeriodEnd\"", [planCode, status, plan.rows[0].monthlyAmount, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Suscripción no encontrada para este dealer" });
    await writeAudit(req, "platform.subscription.update", "billing_subscription", req.params.id, { planCode, status });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Platform subscription update failed", error); res.status(500).json({ error: "No se pudo actualizar la suscripción" }); }
});

function icsText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsLocalDate(date, time = "00:00:00") {
  const datePart = String(date || "").slice(0, 10).replaceAll("-", "");
  const timePart = String(time || "00:00:00").slice(0, 8).replaceAll(":", "").padEnd(6, "0");
  return `${datePart}T${timePart}`;
}

app.get("/api/admin/calendar.ics", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
    const organizationId = adminOrganizationId(req);
    const result = await pool.query(`
      SELECT t.id, t.customer_name AS "customerName", t.customer_email AS "customerEmail", t.customer_phone AS "customerPhone",
             t.requested_date AS date, t.requested_time AS time, t.status, t.notes,
             v.model, v.variant, b.name AS brand
      FROM test_drive_requests t
      LEFT JOIN vehicles v ON v.id=t.vehicle_id AND v.organization_id=$1
      LEFT JOIN vehicle_brands b ON b.id=v.brand_id
      WHERE t.organization_id=$1 AND t.requested_date >= CURRENT_DATE AND t.status <> 'cancelled'
      ORDER BY t.requested_date, t.requested_time
    `, [organizationId]);
    const settings = await pool.query("SELECT business_name AS \"businessName\", appointment_duration_minutes AS \"durationMinutes\" FROM organization_settings WHERE organization_id=$1", [organizationId]);
    const duration = Number(settings.rows[0]?.durationMinutes || 60);
    const events = result.rows.map((appointment) => {
      const start = icsLocalDate(appointment.date, appointment.time);
      const [hours, minutes] = String(appointment.time || "00:00").split(":").map(Number);
      const endTotalMinutes = (hours || 0) * 60 + (minutes || 0) + duration;
      const endHours = String(Math.floor(endTotalMinutes / 60) % 24).padStart(2, "0");
      const endMinutes = String(endTotalMinutes % 60).padStart(2, "0");
      const end = icsLocalDate(appointment.date, `${endHours}:${endMinutes}:00`);
      const vehicleName = [appointment.brand, appointment.model, appointment.variant].filter(Boolean).join(" ") || "visita al showroom";
      const summary = `Visita · ${vehicleName}`;
      const description = [appointment.customerEmail, appointment.customerPhone, appointment.notes].filter(Boolean).join(" · ");
      return [
        "BEGIN:VEVENT", `UID:${appointment.id}@authentiq.local`, `DTSTAMP:${icsLocalDate(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(11, 19))}Z`, `DTSTART:${start}`, `DTEND:${end}`,
        `SUMMARY:${icsText(summary)}`, `DESCRIPTION:${icsText(description)}`, `STATUS:${appointment.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`, "END:VEVENT",
      ].join("\r\n");
    });
    const calendarName = settings.rows[0]?.businessName || "Agenda del showroom";
    const content = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AUTHENTIQ//Local showroom calendar//ES", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(calendarName)}`, ...events, "END:VCALENDAR", ""].join("\r\n");
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename=agenda-${String(calendarName).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics` }).send(content);
  } catch (error) { console.error("Calendar export failed", error); res.status(500).json({ error: "No se pudo exportar la agenda" }); }
});

app.get("/api/admin/export/leads.csv", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
    const result = await pool.query(`SELECT l.created_at AS "createdAt", l.status, l.lead_type AS "leadType", l.name, l.email, l.phone, l.source, l.message, l.notes, b.name AS brand, v.model, v.year FROM leads l LEFT JOIN vehicles v ON v.id=l.vehicle_id AND v.organization_id=$1 LEFT JOIN vehicle_brands b ON b.id=v.brand_id WHERE l.organization_id=$1 ORDER BY l.created_at DESC`, [adminOrganizationId(req)]);
    sendCsv(res, "interesados.csv", [
      { key: "createdAt", label: "Fecha" }, { key: "status", label: "Estado" }, { key: "leadType", label: "Tipo" }, { key: "name", label: "Nombre" }, { key: "email", label: "Correo" }, { key: "phone", label: "Teléfono" }, { key: "source", label: "Origen" }, { key: "brand", label: "Marca" }, { key: "model", label: "Modelo" }, { key: "year", label: "Año" }, { key: "message", label: "Mensaje" }, { key: "notes", label: "Notas" },
    ], result.rows);
  } catch (error) { console.error("Leads export failed", error); res.status(500).json({ error: "No se pudo exportar los interesados" }); }
});

app.get("/api/admin/export/appointments.csv", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
    const result = await pool.query(`SELECT t.created_at AS "createdAt", t.requested_date AS date, t.requested_time AS time, t.status, t.customer_name AS "customerName", t.customer_email AS "customerEmail", t.customer_phone AS "customerPhone", b.name AS brand, v.model, v.year, t.notes FROM test_drive_requests t LEFT JOIN vehicles v ON v.id=t.vehicle_id AND v.organization_id=$1 LEFT JOIN vehicle_brands b ON b.id=v.brand_id WHERE t.organization_id=$1 ORDER BY t.requested_date DESC, t.requested_time DESC`, [adminOrganizationId(req)]);
    sendCsv(res, "citas.csv", [
      { key: "createdAt", label: "Creada" }, { key: "date", label: "Fecha" }, { key: "time", label: "Hora" }, { key: "status", label: "Estado" }, { key: "customerName", label: "Cliente" }, { key: "customerEmail", label: "Correo" }, { key: "customerPhone", label: "Teléfono" }, { key: "brand", label: "Marca" }, { key: "model", label: "Modelo" }, { key: "year", label: "Año" }, { key: "notes", label: "Notas" },
    ], result.rows);
  } catch (error) { console.error("Appointments export failed", error); res.status(500).json({ error: "No se pudo exportar las citas" }); }
});

app.get("/api/admin/export/quotes.csv", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
    const result = await pool.query(`SELECT q.created_at AS "createdAt", q.quote_number AS "quoteNumber", q.status, q.customer_name AS "customerName", q.customer_email AS "customerEmail", q.customer_phone AS "customerPhone", q.base_price_usd AS "basePriceUsd", q.discount_usd AS "discountUsd", q.total_usd AS "totalUsd", q.currency, q.valid_until AS "validUntil", b.name AS brand, v.model, v.year FROM quotes q LEFT JOIN vehicles v ON v.id=q.vehicle_id AND v.organization_id=$1 LEFT JOIN vehicle_brands b ON b.id=v.brand_id WHERE q.organization_id=$1 ORDER BY q.created_at DESC`, [adminOrganizationId(req)]);
    sendCsv(res, "cotizaciones.csv", [
      { key: "createdAt", label: "Creada" }, { key: "quoteNumber", label: "Cotización" }, { key: "status", label: "Estado" }, { key: "customerName", label: "Cliente" }, { key: "customerEmail", label: "Correo" }, { key: "customerPhone", label: "Teléfono" }, { key: "basePriceUsd", label: "Precio base USD" }, { key: "discountUsd", label: "Descuento USD" }, { key: "totalUsd", label: "Total USD" }, { key: "currency", label: "Moneda" }, { key: "validUntil", label: "Válida hasta" }, { key: "brand", label: "Marca" }, { key: "model", label: "Modelo" }, { key: "year", label: "Año" },
    ], result.rows);
  } catch (error) { console.error("Quotes export failed", error); res.status(500).json({ error: "No se pudo exportar las cotizaciones" }); }
});

app.get("/api/admin/integrations", authenticate, requireRoles("admin"), async (req, res) => {
  try {
    const organizationId = adminOrganizationId(req);
    const [integrations, billing] = await Promise.all([
      pool.query("SELECT provider, mode, status, config, connected_at AS \"connectedAt\", updated_at AS \"updatedAt\" FROM organization_integrations WHERE organization_id=$1 ORDER BY provider", [organizationId]),
      pool.query("SELECT bs.provider, bs.mode, bs.plan_code AS \"planCode\", pp.name AS \"planName\", pp.vehicle_limit AS \"vehicleLimit\", bs.status, bs.monthly_amount AS \"monthlyAmount\", bs.currency, bs.current_period_end AS \"currentPeriodEnd\", bs.updated_at AS \"updatedAt\" FROM billing_subscriptions bs LEFT JOIN platform_plans pp ON pp.code=bs.plan_code WHERE bs.organization_id=$1", [organizationId]),
    ]);
    const organization = await pool.query("SELECT name, custom_domain AS \"customDomain\" FROM organizations WHERE id=$1", [organizationId]);
    const customDomain = String(organization.rows[0]?.customDomain || "").trim().toLowerCase();
    const requestHost = String(req.hostname || "").trim().toLowerCase();
    const safeIntegrations = integrations.rows.map((row) => ({ ...row, config: Object.fromEntries(Object.entries(row.config || {}).filter(([key]) => !["refreshTokenEncrypted"].includes(key))) }));
    res.json({ data: {
      integrations: safeIntegrations,
      billing: billing.rows[0] || null,
      localMode: true,
      health: {
        email: { provider: "resend", configured: emailDeliveryConfigured, status: emailDeliveryConfigured ? "ready" : "not_configured", detail: emailDeliveryConfigured ? "Emails transaccionales activos" : "Añade RESEND_API_KEY y RESEND_FROM_EMAIL" },
        googleCalendar: { provider: "google_calendar", configured: googleCalendarConfigured, status: googleCalendarConfigured ? "oauth_ready" : "local_export_ready", detail: googleCalendarConfigured ? "OAuth listo para completar la autorización" : "Exportación .ics disponible; falta OAuth" },
        metaSocial: { provider: "meta_social", configured: metaAppConfigured, status: metaAppConfigured ? "oauth_ready" : "drafts_ready", detail: metaAppConfigured ? "App Meta configurada; falta autorizar cada dealer" : "Borradores listos; falta App Meta y autorización" },
        billing: { provider: billingProvider, configured: Boolean(billingCheckoutUrl), status: billingCheckoutUrl ? "checkout_ready" : "local_demo", detail: billingCheckoutUrl ? "Checkout externo configurado" : "Modo demo; falta proveedor y webhook" },
        domain: { configured: Boolean(customDomain), status: !customDomain ? "not_configured" : requestHost === customDomain ? "verified" : "dns_pending", detail: !customDomain ? "Asigna un dominio desde Configuración" : requestHost === customDomain ? "La petición llegó por el dominio personalizado" : `Apunta DNS hacia el hosting y prueba ${customDomain}`, domain: customDomain || null },
      },
      organization: { name: organization.rows[0]?.name || "", customDomain: customDomain || null },
    } });
  } catch (error) { console.error("Integrations query failed", error); res.status(500).json({ error: "No se pudo cargar el centro de integraciones" }); }
});

app.get("/api/admin/integrations/google-calendar/connect", authenticate, requireRoles("admin"), async (req, res) => {
  if (!googleCalendarConfigured) return res.status(503).json({ error: "Google Calendar todavía no está configurado en el servidor" });
  if (!googleCalendarTokenKey) return res.status(503).json({ error: "Falta la llave de cifrado de Google Calendar en el servidor" });
  const state = jwt.sign({ purpose: "google_calendar_oauth", organizationId: adminOrganizationId(req), adminId: req.admin.id }, jwtSecret, { expiresIn: "10m" });
  res.json({ data: { authorizationUrl: googleCalendarAuthorizationUrl(state) } });
});

app.get("/api/integrations/google-calendar/callback", async (req, res) => {
  const redirectBase = publicSiteUrl || frontendOrigin || `http://localhost:5173`;
  try {
    const state = jwt.verify(String(req.query.state || ""), jwtSecret);
    if (state.purpose !== "google_calendar_oauth" || !state.organizationId) throw new Error("Estado OAuth inválido");
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const token = await googleTokenRequest({ code: String(req.query.code || ""), client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID, client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET, redirect_uri: googleCalendarRedirectUri, grant_type: "authorization_code" });
    const accessResponse = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", { headers: { Authorization: `Bearer ${token.access_token}` } });
    const calendar = await accessResponse.json().catch(() => ({}));
    if (!accessResponse.ok) throw new Error(calendar.error?.message || "No se pudo consultar el calendario principal");
    const existing = await pool.query("SELECT config FROM organization_integrations WHERE organization_id=$1 AND provider='google_calendar'", [state.organizationId]);
    const existingConfig = existing.rows[0]?.config || {};
    const refreshTokenEncrypted = encryptGoogleSecret(token.refresh_token) || existingConfig.refreshTokenEncrypted;
    if (!refreshTokenEncrypted) throw new Error("Google no devolvió un refresh token; desconecta la app en Google y vuelve a autorizarla");
    const config = { ...existingConfig, calendarId: calendar.id || "primary", calendarName: calendar.summary || "Google Calendar", googleEmail: calendar.id || null, timezone: calendar.timeZone || "America/Santo_Domingo", refreshTokenEncrypted, tokenExpiresAt: token.expiry_date ? new Date(token.expiry_date).toISOString() : null };
    await pool.query(`INSERT INTO organization_integrations (organization_id, provider, mode, status, config, connected_at, updated_at) VALUES ($1,'google_calendar','oauth','connected',$2::jsonb,NOW(),NOW()) ON CONFLICT (organization_id, provider) DO UPDATE SET mode='oauth', status='connected', config=EXCLUDED.config, connected_at=NOW(), updated_at=NOW()`, [state.organizationId, JSON.stringify(config)]);
    await pool.query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,'integration.google_calendar.connect','organization_integration',$2,$3::jsonb)", [state.adminId, state.organizationId, JSON.stringify({ provider: "google_calendar", calendarId: config.calendarId })]).catch(() => {});
    res.redirect(`${redirectBase}/?integration=google_calendar&status=connected`);
  } catch (error) {
    console.error("Google Calendar OAuth callback failed", error);
    res.redirect(`${redirectBase}/?integration=google_calendar&status=error&message=${encodeURIComponent(error.message || "No se pudo conectar Google Calendar")}`);
  }
});

app.delete("/api/admin/integrations/google-calendar", authenticate, requireRoles("admin"), async (req, res) => {
  await pool.query("UPDATE organization_integrations SET mode='local', status='local_export_ready', config=config - 'refreshTokenEncrypted' - 'calendarId' - 'googleEmail' - 'tokenExpiresAt', connected_at=NULL, updated_at=NOW() WHERE organization_id=$1 AND provider='google_calendar'", [adminOrganizationId(req)]);
  res.json({ data: { status: "local_export_ready" } });
});

app.patch("/api/admin/integrations/:provider", authenticate, requireRoles("admin"), async (req, res) => {
  const provider = String(req.params.provider || "").trim();
  if (!["google_calendar", "meta_social", "billing"].includes(provider)) return res.status(400).json({ error: "Proveedor de integración no válido" });
  const localStatuses = { google_calendar: "local_export_ready", meta_social: "drafts_ready", billing: "trialing" };
  const config = req.body?.config && typeof req.body.config === "object" && !Array.isArray(req.body.config) ? req.body.config : {};
  try {
    const result = await pool.query(`
      INSERT INTO organization_integrations (organization_id, provider, mode, status, config, connected_at, updated_at)
      VALUES ($1,$2,'local',$3,$4::jsonb,NOW(),NOW())
      ON CONFLICT (organization_id, provider) DO UPDATE SET status=EXCLUDED.status, config=EXCLUDED.config, connected_at=NOW(), updated_at=NOW()
      RETURNING provider, mode, status, config, connected_at AS "connectedAt", updated_at AS "updatedAt"
    `, [adminOrganizationId(req), provider, localStatuses[provider], JSON.stringify(config)]);
    await writeAudit(req, "integration.local_configure", "organization_integration", `${adminOrganizationId(req)}:${provider}`, { provider });
    res.json({ data: result.rows[0] });
  } catch (error) { console.error("Integration update failed", error); res.status(500).json({ error: "No se pudo guardar la integración" }); }
});

app.get("/api/admin/social/drafts", authenticate, requireRoles("admin", "editor", "content_editor"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.id, d.vehicle_id AS "vehicleId", d.platform, d.caption, d.hashtags, d.media_url AS "mediaUrl", d.status,
             d.created_at AS "createdAt", v.model, v.year, b.name AS brand
      FROM social_drafts d LEFT JOIN vehicles v ON v.id=d.vehicle_id AND v.organization_id=d.organization_id
      LEFT JOIN vehicle_brands b ON b.id=v.brand_id
      WHERE d.organization_id=$1 ORDER BY d.created_at DESC LIMIT 50
    `, [adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) { console.error("Social drafts query failed", error); res.status(500).json({ error: "No se pudieron cargar los borradores sociales" }); }
});

app.post("/api/admin/social/drafts", authenticate, requireRoles("admin", "editor", "content_editor"), async (req, res) => {
  const platform = ["instagram", "facebook", "both"].includes(req.body?.platform) ? req.body.platform : "both";
  const caption = String(req.body?.caption || "").trim().slice(0, 2200);
  const hashtags = Array.isArray(req.body?.hashtags) ? req.body.hashtags.map((tag) => String(tag).trim().replace(/^#/, "")).filter(Boolean).slice(0, 20) : [];
  const vehicleId = String(req.body?.vehicleId || "").trim() || null;
  if (!caption) return res.status(400).json({ error: "El texto de la publicación es obligatorio" });
  try {
    if (vehicleId) {
      const vehicle = await pool.query("SELECT id FROM vehicles WHERE id=$1 AND organization_id=$2", [vehicleId, adminOrganizationId(req)]);
      if (!vehicle.rowCount) return res.status(404).json({ error: "Vehículo no encontrado en esta organización" });
    }
    const result = await pool.query(`INSERT INTO social_drafts (organization_id, vehicle_id, platform, caption, hashtags, media_url, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,'ready',$7) RETURNING id, vehicle_id AS "vehicleId", platform, caption, hashtags, media_url AS "mediaUrl", status, created_at AS "createdAt"`, [adminOrganizationId(req), vehicleId, platform, caption, hashtags, String(req.body?.mediaUrl || "").trim() || null, req.admin.id]);
    await writeAudit(req, "social_draft.create", "social_draft", result.rows[0].id, { platform, vehicleId });
    res.status(201).json({ data: result.rows[0] });
  } catch (error) { console.error("Social draft creation failed", error); res.status(500).json({ error: "No se pudo crear el borrador social" }); }
});

app.get("/api/admin/billing", authenticate, requireRoles("admin"), async (req, res) => {
  try {
    const result = await pool.query("SELECT bs.provider, bs.mode, bs.plan_code AS \"planCode\", pp.name AS \"planName\", pp.vehicle_limit AS \"vehicleLimit\", bs.status, bs.monthly_amount AS \"monthlyAmount\", bs.currency, bs.current_period_end AS \"currentPeriodEnd\", bs.updated_at AS \"updatedAt\", (SELECT COUNT(*)::int FROM vehicles v WHERE v.organization_id=bs.organization_id AND v.status <> 'inactive') AS \"vehicleUsage\" FROM billing_subscriptions bs LEFT JOIN platform_plans pp ON pp.code=bs.plan_code WHERE bs.organization_id=$1", [adminOrganizationId(req)]);
    res.json({ data: { ...(result.rows[0] || { provider: "local", mode: "local_demo", planCode: "starter", planName: "Starter", status: "trialing", monthlyAmount: 0, currency: "USD", vehicleLimit: 40, vehicleUsage: 0 }), checkoutReady: Boolean(billingCheckoutUrl), providerConfigured: Boolean(billingCheckoutUrl), provider: billingProvider, message: billingCheckoutUrl ? "Checkout externo configurado; falta validar el webhook." : "Modo local: conecta Stripe o el proveedor elegido antes de cobrar." } });
  } catch (error) { console.error("Billing query failed", error); res.status(500).json({ error: "No se pudo cargar la suscripción" }); }
});

app.get("/api/admin/blog", authenticate, requireRoles("admin", "editor", "content_editor"), async (req, res) => {
  try {
     const result = await pool.query(`SELECT id, title, slug, summary, content, category, tags, cover_image_url AS "coverImageUrl", status, published_at AS "publishedAt", seo_title AS "seoTitle", seo_description AS "seoDescription", created_at AS "createdAt", updated_at AS "updatedAt" FROM blog_posts WHERE organization_id=$1 ORDER BY created_at DESC`, [adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) { console.error("Admin blog listing failed", error); res.status(500).json({ error: "No se pudo cargar el contenido" }); }
});

app.post("/api/admin/blog", authenticate, requireRoles("admin", "editor", "content_editor"), async (req, res) => {
  const post = blogPayload(req.body);
  if (!post.title || !post.slug || !post.content) return res.status(400).json({ error: "Título y contenido son obligatorios" });
  try {
     const result = await pool.query(`INSERT INTO blog_posts (organization_id, title, slug, summary, content, category, tags, cover_image_url, author_id, status, published_at, seo_title, seo_description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $10='published' THEN NOW() ELSE NULL END,$11,$12) RETURNING id`, [adminOrganizationId(req), post.title, post.slug, post.summary, post.content, post.category, post.tags, post.coverImageUrl, req.admin.id, post.status, post.seoTitle, post.seoDescription]);
    await writeAudit(req, "blog.create", "blog_post", result.rows[0].id, { status: post.status, slug: post.slug });
    res.status(201).json({ data: { id: result.rows[0].id, ...post } });
  } catch (error) { console.error("Blog creation failed", error); res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Ese slug ya existe" : "No se pudo crear el artículo" }); }
});

app.put("/api/admin/blog/:id", authenticate, requireRoles("admin", "editor", "content_editor"), async (req, res) => {
  const post = blogPayload(req.body);
  if (!post.title || !post.slug || !post.content) return res.status(400).json({ error: "Título y contenido son obligatorios" });
  try {
     const result = await pool.query(`UPDATE blog_posts SET title=$1, slug=$2, summary=$3, content=$4, category=$5, tags=$6, cover_image_url=$7, status=$8, published_at=CASE WHEN $8='published' AND published_at IS NULL THEN NOW() WHEN $8 <> 'published' THEN NULL ELSE published_at END, seo_title=$9, seo_description=$10, updated_at=NOW() WHERE id=$11 AND organization_id=$12 RETURNING id`, [post.title, post.slug, post.summary, post.content, post.category, post.tags, post.coverImageUrl, post.status, post.seoTitle, post.seoDescription, req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Artículo no encontrado" });
    await writeAudit(req, "blog.update", "blog_post", req.params.id, { status: post.status, slug: post.slug });
    res.json({ data: { id: result.rows[0].id, ...post } });
  } catch (error) { console.error("Blog update failed", error); res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Ese slug ya existe" : "No se pudo actualizar el artículo" }); }
});

app.delete("/api/admin/blog/:id", authenticate, requireRoles("admin", "editor", "content_editor"), async (req, res) => {
  try {
     const result = await pool.query("UPDATE blog_posts SET status='archived', updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING id", [req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Artículo no encontrado" });
    await writeAudit(req, "blog.archive", "blog_post", req.params.id);
    res.status(204).end();
  } catch (error) { console.error("Blog archive failed", error); res.status(500).json({ error: "No se pudo archivar el artículo" }); }
});

app.get("/api/admin/dashboard", authenticate, requireRoles("admin", "editor", "seller", "content_editor"), async (req, res) => {
  try {
    const [summary, brands, statuses, recentOffers, upcomingAppointments] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS "totalVehicles",
          COUNT(*) FILTER (WHERE status = 'published')::int AS "publishedVehicles",
          COALESCE(SUM(stock) FILTER (WHERE status = 'published'), 0)::int AS "availableStock",
          COALESCE(SUM(price_usd) FILTER (WHERE status = 'published'), 0)::numeric AS "inventoryValue",
           (SELECT COUNT(*)::int FROM leads WHERE organization_id=$1 AND status IN ('new', 'contacted', 'qualified')) AS "pendingLeads",
           (SELECT COUNT(*)::int FROM offers WHERE organization_id=$1 AND status = 'pending') AS "pendingOffers",
           (SELECT COUNT(*)::int FROM vehicles WHERE organization_id=$1 AND status = 'pending_review') AS "pendingReview"
        FROM vehicles WHERE organization_id=$1
      `, [adminOrganizationId(req)]),
      pool.query(`
        SELECT b.name, COUNT(v.id)::int AS vehicles, COALESCE(SUM(v.stock), 0)::int AS stock
        FROM vehicle_brands b
         LEFT JOIN vehicles v ON v.brand_id = b.id AND v.organization_id=$1 AND v.status <> 'inactive'
        GROUP BY b.id, b.name
        ORDER BY vehicles DESC, b.name ASC
       `, [adminOrganizationId(req)]),
      pool.query(`
        SELECT status, COUNT(*)::int AS count
         FROM vehicles WHERE organization_id=$1
        GROUP BY status
        ORDER BY status
       `, [adminOrganizationId(req)]),
      pool.query(`
        SELECT o.id, o.buyer_name AS "buyerName", o.amount_usd AS "amountUsd", o.status, o.created_at AS "createdAt",
               b.name AS brand, v.model, v.year
         FROM offers o
         JOIN vehicles v ON v.id = o.vehicle_id AND v.organization_id=$1
        JOIN vehicle_brands b ON b.id = v.brand_id
        WHERE o.organization_id=$1
        ORDER BY o.created_at DESC
        LIMIT 5
       `, [adminOrganizationId(req)]),
      pool.query(`
        SELECT t.id, t.customer_name AS "customerName", t.requested_date AS date, t.requested_time AS time, t.status,
               b.name AS brand, v.model, v.year
        FROM test_drive_requests t
        JOIN vehicles v ON v.id=t.vehicle_id AND v.organization_id=$1
        JOIN vehicle_brands b ON b.id=v.brand_id
        WHERE t.organization_id=$1 AND t.status IN ('pending', 'confirmed') AND t.requested_date >= CURRENT_DATE
        ORDER BY t.requested_date ASC, t.requested_time ASC
        LIMIT 5
      `, [adminOrganizationId(req)]),
    ]);
    res.json({ data: { summary: summary.rows[0], byBrand: brands.rows, byStatus: statuses.rows, recentOffers: recentOffers.rows, upcomingAppointments: upcomingAppointments.rows } });
  } catch (error) {
    console.error("Dashboard query failed", error);
    res.status(500).json({ error: "No se pudo cargar el dashboard" });
  }
});

app.get("/api/admin/offers", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.buyer_name AS "buyerName", o.buyer_email AS "buyerEmail", o.buyer_phone AS "buyerPhone",
             o.amount_usd AS "amountUsd", o.payment_method AS "paymentMethod", o.message, o.status,
             o.created_at AS "createdAt", o.reviewed_at AS "reviewedAt", b.name AS brand, v.model, v.year,
             v.price_usd AS "vehiclePriceUsd"
       FROM offers o
       JOIN vehicles v ON v.id = o.vehicle_id AND v.organization_id=$1
      JOIN vehicle_brands b ON b.id = v.brand_id
      WHERE o.organization_id=$1
      ORDER BY o.created_at DESC
    `, [adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) {
    console.error("Offers query failed", error);
    res.status(500).json({ error: "No se pudieron cargar las ofertas" });
  }
});

app.patch("/api/admin/offers/:id/status", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  const status = String(req.body.status || "");
  if (!["pending", "accepted", "rejected"].includes(status)) return res.status(400).json({ error: "Estado de oferta no válido" });
  try {
    const current = await pool.query("SELECT status, customer_id AS \"customerId\", vehicle_id AS \"vehicleId\" FROM offers WHERE id=$1 AND organization_id=$2", [req.params.id, adminOrganizationId(req)]);
    if (!current.rowCount) return res.status(404).json({ error: "Oferta no encontrada" });
    const result = await pool.query(
      "UPDATE offers SET status=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3 AND organization_id=$4 RETURNING id, status, customer_id AS \"customerId\", vehicle_id AS \"vehicleId\"",
      [status, req.admin.id, req.params.id, adminOrganizationId(req)],
    );
    await writeAudit(req, "offer.status_update", "offer", req.params.id, { status });
    if (current.rows[0].status !== status && status !== "pending" && result.rows[0].customerId) {
      const vehicle = await pool.query("SELECT b.name AS brand, v.model FROM vehicles v JOIN vehicle_brands b ON b.id=v.brand_id WHERE v.id=$1 AND v.organization_id=$2", [result.rows[0].vehicleId, adminOrganizationId(req)]);
      const vehicleName = vehicle.rows[0] ? `${vehicle.rows[0].brand} ${vehicle.rows[0].model}` : "tu vehículo";
      await notifyCustomer({ customerId: result.rows[0].customerId, type: "offer_status", title: status === "accepted" ? "Oferta aceptada" : "Oferta revisada", body: status === "accepted" ? `Tu oferta para ${vehicleName} fue aceptada.` : `Tu oferta para ${vehicleName} fue rechazada.`, entityType: "offer", entityId: result.rows[0].id });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error("Offer status update failed", error);
    res.status(500).json({ error: "No se pudo actualizar la oferta" });
  }
});

app.get("/api/admin/quotes", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT q.id, q.quote_number AS "quoteNumber", q.lead_id AS "leadId", q.vehicle_id AS "vehicleId",
             q.customer_name AS "customerName", q.customer_email AS "customerEmail", q.customer_phone AS "customerPhone",
             q.base_price_usd AS "basePriceUsd", q.discount_usd AS "discountUsd", q.total_usd AS "totalUsd",
             q.currency, q.valid_until AS "validUntil", q.notes, q.status, q.created_at AS "createdAt", q.updated_at AS "updatedAt",
             b.name AS brand, v.model, v.year, au.full_name AS "createdByName"
      FROM quotes q
      LEFT JOIN vehicles v ON v.id = q.vehicle_id AND v.organization_id=$1
      LEFT JOIN vehicle_brands b ON b.id = v.brand_id
      LEFT JOIN admin_users au ON au.id = q.created_by
      WHERE q.organization_id=$1
      ORDER BY q.created_at DESC
    `, [adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) {
    console.error("Quotes query failed", error);
    res.status(500).json({ error: "No se pudieron cargar las cotizaciones" });
  }
});

app.post("/api/admin/quotes/:id/share", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  try {
    const result = await pool.query("SELECT id, status, valid_until AS \"validUntil\" FROM quotes WHERE id=$1 AND organization_id=$2", [req.params.id, adminOrganizationId(req)]);
    if (!result.rowCount) return res.status(404).json({ error: "Cotización no encontrada" });
    const quote = result.rows[0];
    if (["cancelled", "expired"].includes(quote.status)) return res.status(400).json({ error: "Esta cotización ya no se puede compartir" });
    if (quote.validUntil && new Date(quote.validUntil) < new Date(new Date().toISOString().slice(0, 10))) return res.status(400).json({ error: "La cotización está vencida" });
    if (quote.status === "draft") await pool.query("UPDATE quotes SET status='sent', updated_at=NOW() WHERE id=$1 AND organization_id=$2", [req.params.id, adminOrganizationId(req)]);
    const token = jwt.sign({ kind: "public_quote", quoteId: quote.id, organizationId: adminOrganizationId(req) }, jwtSecret, { expiresIn: "30d" });
    const baseUrl = String(process.env.PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/$/, "");
    const url = `${baseUrl}/cotizaciones/${token}`;
    await writeAudit(req, "quote.share", "quote", quote.id, { status: quote.status, expiresIn: "30d" });
    res.json({ data: { url, status: quote.status === "draft" ? "sent" : quote.status, expiresInDays: 30 } });
  } catch (error) {
    console.error("Quote share failed", error);
    res.status(500).json({ error: "No se pudo generar el enlace de la cotización" });
  }
});

app.get("/api/public/quotes/:token", async (req, res) => {
  try {
    const payload = jwt.verify(req.params.token, jwtSecret);
    if (payload.kind !== "public_quote" || !payload.quoteId || !payload.organizationId) return res.status(401).json({ error: "Enlace de cotización inválido" });
    const result = await pool.query(`
      SELECT q.quote_number AS "quoteNumber", q.customer_name AS "customerName", q.base_price_usd AS "basePriceUsd",
             q.discount_usd AS "discountUsd", q.total_usd AS "totalUsd", q.currency, q.valid_until AS "validUntil",
             q.notes, q.status, q.created_at AS "createdAt", b.name AS brand, v.model, v.variant, v.year,
             v.engine, v.power, v.transmission,
             (SELECT image_url FROM vehicle_images WHERE vehicle_id=v.id ORDER BY sort_order ASC LIMIT 1) AS "imageUrl"
      FROM quotes q LEFT JOIN vehicles v ON v.id=q.vehicle_id LEFT JOIN vehicle_brands b ON b.id=v.brand_id
       WHERE q.id=$1 AND q.organization_id=$2 AND q.status IN ('sent','accepted')
    `, [payload.quoteId, payload.organizationId]);
    if (!result.rowCount) return res.status(404).json({ error: "La cotización no está disponible" });
    const quote = result.rows[0];
    if (quote.validUntil && new Date(quote.validUntil) < new Date(new Date().toISOString().slice(0, 10))) return res.status(410).json({ error: "La cotización ha vencido" });
    res.json({ data: quote });
  } catch {
    res.status(401).json({ error: "El enlace de cotización es inválido o expiró" });
  }
});

app.post("/api/public/quotes/:token/decision", async (req, res) => {
  try {
    const payload = jwt.verify(req.params.token, jwtSecret);
    if (payload.kind !== "public_quote" || !payload.quoteId || !payload.organizationId) return res.status(401).json({ error: "Enlace de cotización inválido" });
    const decision = String(req.body?.decision || "").trim().toLowerCase();
    const message = String(req.body?.message || "").trim().slice(0, 500);
    if (!["accepted", "changes"].includes(decision)) return res.status(400).json({ error: "Decisión no válida" });

    const result = await pool.query(`
      SELECT q.id, q.status, q.lead_id AS "leadId", q.quote_number AS "quoteNumber",
             q.customer_name AS "customerName", q.valid_until AS "validUntil",
             b.name AS brand, v.model
      FROM quotes q
      LEFT JOIN vehicles v ON v.id = q.vehicle_id
      LEFT JOIN vehicle_brands b ON b.id = v.brand_id
       WHERE q.id=$1 AND q.organization_id=$2
    `, [payload.quoteId, payload.organizationId]);
    if (!result.rowCount) return res.status(404).json({ error: "La cotización no está disponible" });
    const quote = result.rows[0];
    if (["cancelled", "expired"].includes(quote.status)) return res.status(410).json({ error: "La cotización ya no está disponible" });
    if (quote.validUntil && new Date(quote.validUntil) < new Date(new Date().toISOString().slice(0, 10))) return res.status(410).json({ error: "La cotización ha vencido" });
    if (quote.status !== "sent") return res.status(409).json({ error: quote.status === "accepted" ? "Esta cotización ya fue aceptada" : "Esta cotización no admite decisiones" });

    const note = `${decision === "accepted" ? "Cliente aceptó" : "Cliente solicitó cambios"} la cotización ${quote.quoteNumber}${message ? `: ${message}` : "."}`;
    if (decision === "accepted") await pool.query("UPDATE quotes SET status='accepted', updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND status='sent'", [quote.id, payload.organizationId]);
    if (quote.leadId) await pool.query("INSERT INTO lead_events (lead_id, actor_id, event_type, note) VALUES ($1, NULL, $2, $3)", [quote.leadId, decision === "accepted" ? "quote_accepted" : "quote_changes_requested", note]);
    await notifyAdmins({ organizationId: payload.organizationId, type: "quote", title: decision === "accepted" ? "Cotización aceptada" : "Cambios solicitados en cotización", body: `${quote.customerName || "El cliente"} ${decision === "accepted" ? "aceptó" : "solicitó cambios en"} ${quote.quoteNumber}.`, entityType: "quote", entityId: quote.id });
    res.json({ data: { decision, status: decision === "accepted" ? "accepted" : "sent", quoteNumber: quote.quoteNumber } });
  } catch (error) {
    if (error?.name === "JsonWebTokenError" || error?.name === "TokenExpiredError") return res.status(401).json({ error: "El enlace de cotización es inválido o expiró" });
    console.error("Public quote decision failed", error);
    res.status(500).json({ error: "No se pudo registrar la decisión" });
  }
});

app.post("/api/admin/quotes", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  const quote = quotePayload(req.body);
  const validationError = validateQuote(quote);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    if (quote.vehicleId) {
       const vehicle = await pool.query("SELECT id FROM vehicles WHERE id=$1 AND organization_id=$2", [quote.vehicleId, adminOrganizationId(req)]);
      if (!vehicle.rowCount) return res.status(404).json({ error: "Vehículo no encontrado" });
    }
    if (quote.leadId) {
       const lead = await pool.query("SELECT id FROM leads WHERE id=$1 AND organization_id=$2", [quote.leadId, adminOrganizationId(req)]);
      if (!lead.rowCount) return res.status(404).json({ error: "Lead no encontrado" });
    }
    const customer = quote.customerEmail ? await pool.query("SELECT id FROM customer_accounts WHERE LOWER(email)=LOWER($1) AND is_active=TRUE", [quote.customerEmail]) : { rows: [] };
    const customerId = customer.rows[0]?.id || null;
    const result = await pool.query(`
       INSERT INTO quotes (organization_id, quote_number, lead_id, vehicle_id, customer_name, customer_email, customer_phone, base_price_usd, discount_usd, total_usd, currency, valid_until, notes, customer_id, created_by)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11, $12::date, $13, $14::uuid, $15::uuid)
      RETURNING id, quote_number AS "quoteNumber", status, total_usd AS "totalUsd", created_at AS "createdAt"
    `, [adminOrganizationId(req), createQuoteNumber(), quote.leadId, quote.vehicleId, quote.customerName, quote.customerEmail, quote.customerPhone, quote.basePriceUsd, quote.discountUsd, quote.totalUsd, quote.currency || "USD", quote.validUntil, quote.notes, customerId, req.admin.id]);
    await writeAudit(req, "quote.create", "quote", result.rows[0].id, { leadId: quote.leadId, vehicleId: quote.vehicleId, totalUsd: quote.totalUsd });
    if (customerId) await notifyCustomer({ customerId, type: "quote_created", title: "Nueva cotización disponible", body: `AUTHENTIQ preparó una cotización por $${Number(quote.totalUsd).toLocaleString("en-US")} USD.`, entityType: "quote", entityId: result.rows[0].id });
    res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error("Quote creation failed", error);
    res.status(500).json({ error: "No se pudo crear la cotización" });
  }
});

app.patch("/api/admin/quotes/:id/status", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  const status = String(req.body.status || "");
  if (!["draft", "sent", "accepted", "expired", "cancelled"].includes(status)) return res.status(400).json({ error: "Estado de cotización no válido" });
  try {
    const current = await pool.query("SELECT status, customer_id AS \"customerId\", quote_number AS \"quoteNumber\" FROM quotes WHERE id=$1 AND organization_id=$2", [req.params.id, adminOrganizationId(req)]);
    if (!current.rowCount) return res.status(404).json({ error: "Cotización no encontrada" });
    const result = await pool.query("UPDATE quotes SET status=$1, updated_at=NOW() WHERE id=$2 AND organization_id=$3 RETURNING id, quote_number AS \"quoteNumber\", status, customer_id AS \"customerId\"", [status, req.params.id, adminOrganizationId(req)]);
    await writeAudit(req, "quote.status_update", "quote", req.params.id, { status });
    if (current.rows[0].status !== status && current.rows[0].customerId && status !== "draft") {
      const labels = { sent: ["Cotización enviada", `La cotización ${current.rows[0].quoteNumber} ya está disponible para revisión.`], accepted: ["Cotización aceptada", `La cotización ${current.rows[0].quoteNumber} fue aceptada.`], expired: ["Cotización vencida", `La cotización ${current.rows[0].quoteNumber} venció.`], cancelled: ["Cotización cancelada", `La cotización ${current.rows[0].quoteNumber} fue cancelada.`] };
      const [title, body] = labels[status];
      await notifyCustomer({ customerId: current.rows[0].customerId, type: "quote_status", title, body, entityType: "quote", entityId: result.rows[0].id });
    }
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error("Quote status update failed", error);
    res.status(500).json({ error: "No se pudo actualizar la cotización" });
  }
});


app.get("/api/admin/maintenance/orphan-media", authenticate, requireRoles("admin"), async (_req, res) => {
  try { res.json({ data: await cleanupOrphanUploads({ dryRun: true }) }); }
  catch (error) { console.error("Orphan media inspection failed", error); res.status(500).json({ error: "No se pudo revisar el almacenamiento" }); }
});

app.post("/api/admin/maintenance/orphan-media", authenticate, requireRoles("admin"), async (req, res) => {
  try {
    const result = await cleanupOrphanUploads({ dryRun: false });
    await writeAudit(req, "media.cleanup", "media", null, { removedCount: result.removed.length, freedBytes: result.freedBytes });
    res.json({ data: result });
  } catch (error) { console.error("Orphan media cleanup failed", error); res.status(500).json({ error: "No se pudo limpiar el almacenamiento" }); }
});

app.get("/api/admin/audit-logs", authenticate, requireRoles("admin"), async (req, res) => {
  try {
    const result = await pool.query(`SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.metadata, a.created_at AS "createdAt", u.email AS "actorEmail", u.full_name AS "actorName" FROM audit_logs a JOIN admin_users u ON u.id = a.actor_id AND u.organization_id=$1 ORDER BY a.created_at DESC LIMIT 100`, [adminOrganizationId(req)]);
    res.json({ data: result.rows });
  } catch (error) {
    console.error("Audit log query failed", error);
    res.status(500).json({ error: "No se pudo cargar la auditoría" });
  }
});

app.post("/api/events", async (req, res) => {
  const allowedEvents = new Set(["page_view", "catalog_view", "vehicle_view", "vehicle_share", "filter_used", "compare_used", "whatsapp_click", "offer_submitted", "contact_submitted", "appointment_submitted", "trade_in_submitted", "search_alert_submitted"]);
  const eventName = String(req.body.eventName || "").trim();
  const eventPath = String(req.body.path || "/").slice(0, 240);
  const vehicleId = String(req.body.vehicleId || "").trim() || null;
  const source = String(req.body.source || "website").slice(0, 80);
  const sessionId = String(req.body.sessionId || "").slice(0, 80) || null;
  const metadata = req.body.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata) ? req.body.metadata : {};
  if (!allowedEvents.has(eventName)) return res.status(400).json({ error: "Evento no permitido" });
  try { const organization = await getOrganizationContext(req); await pool.query("INSERT INTO analytics_events (organization_id, event_name, path, vehicle_id, source, session_id, metadata) VALUES ($1,$2,$3,$4::uuid,$5,$6,$7::jsonb)", [organization.id, eventName, eventPath, vehicleId, source, sessionId, JSON.stringify(metadata)]); } catch (error) { console.error("Analytics event failed", error); }
  res.status(204).end();
});

app.get("/api/admin/analytics", authenticate, requireRoles("admin", "editor", "seller"), async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days || 30), 1), 365);
  try {
    const result = await pool.query("SELECT event_name AS \"eventName\", COUNT(*)::int AS count FROM analytics_events WHERE organization_id=$1 AND created_at >= NOW() - ($2::int * INTERVAL '1 day') GROUP BY event_name ORDER BY count DESC", [adminOrganizationId(req), days]);
    res.json({ data: result.rows, days });
  } catch (error) { console.error("Analytics query failed", error); res.status(500).json({ error: "No se pudo cargar la analítica" }); }
});

app.get("/sitemap.xml", async (req, res) => {
  try {
    const organization = await getOrganizationContext(req);
    const baseUrl = String(organization.customDomain ? `https://${organization.customDomain}` : (process.env.PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`)).replace(/\/$/, "");
    const vehicles = await pool.query("SELECT v.id, v.model, v.variant, v.updated_at AS \"updatedAt\", b.name AS brand FROM vehicles v JOIN vehicle_brands b ON b.id=v.brand_id WHERE v.organization_id=$1 AND v.status IN ('published','reserved') ORDER BY v.updated_at DESC", [organization.id]);
    const posts = await pool.query("SELECT slug, updated_at AS \"updatedAt\" FROM blog_posts WHERE organization_id=$1 AND status='published' ORDER BY updated_at DESC", [organization.id]);
    const urls = [
      { loc: "/" },
      ...vehicles.rows.map((vehicle) => ({ loc: `/vehiculos/${vehicleSlug(vehicle)}`, lastmod: vehicle.updatedAt })),
      ...posts.rows.map((post) => ({ loc: `/blog/${post.slug}`, lastmod: post.updatedAt })),
    ];
    const escapeXml = (value) => String(value).replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char]);
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(({ loc, lastmod }) => `<url><loc>${escapeXml(baseUrl + loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`).join("")}</urlset>`);
  } catch (error) { if (isOrganizationNotFound(error)) return res.status(404).type("text/plain").send("sitemap unavailable"); res.status(500).type("text/plain").send("sitemap unavailable"); }
});

app.get("/robots.txt", async (req, res) => {
  try {
    const organization = await getOrganizationContext(req);
    const baseUrl = publicOriginForOrganization(req, organization).replace(/\/$/, "");
    res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /preview\nDisallow: /backoffice\nSitemap: ${baseUrl}/sitemap.xml\n`);
  } catch {
    res.status(503).type("text/plain").send("User-agent: *\nDisallow: /\n");
  }
});

const frontendDist = path.resolve(serverDir, "../../dist");
const frontendIndex = path.join(frontendDist, "index.html");
function metadataDescription(value, fallback) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, 180);
}

function publicNotFoundHtml({ businessName = "AUTHENTIQ", origin = "", title = "Página no encontrada", message = "Revisa el enlace o vuelve al showroom para continuar." } = {}) {
  const home = origin ? `${origin}/` : "/";
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)} · ${escapeHtml(businessName)}</title><meta name="robots" content="noindex, nofollow"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101212;color:#f2efe9;font-family:Arial,sans-serif}main{width:min(560px,calc(100% - 40px));padding:40px;border:1px solid #c8a24b;background:#171a1a}small{letter-spacing:.12em;color:#c8a24b}p{color:#b8bdb8;line-height:1.6}a{display:inline-block;margin-top:18px;padding:13px 18px;background:#c8a24b;color:#101212;text-decoration:none;font-weight:700}</style></head><body><main><small>${escapeHtml(businessName)} · SHOWROOM</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(home)}">Volver al showroom</a></main></body></html>`;
}

// Las mismas rutas que el catálogo sabe pintar. Cualquier otra cosa devolvía 200
// con "index, follow" y un título de catálogo: un 404 blando que permitía a Google
// indexar URLs inventadas de cada concesionario. Debe coincidir con `knownPath`
// en App.jsx.
function isKnownPublicRoute(pathname) {
  if (pathname === "/" || pathname === "/index.html" || pathname === "/presentacion" || pathname === "/preview") return true;
  return /^\/(vehiculos|blog|cotizaciones)\/[^/]+\/?$/i.test(pathname);
}

async function publicRouteMetadata(req, organization, { businessName, origin, defaultImage }) {
  const match = req.path.match(/^\/(vehiculos|blog)\/([^/]+)\/?$/i);
  const base = { title: `${businessName} · Vehículos seleccionados`, description: `Inventario de vehículos, atención comercial y citas de ${businessName}.`, image: defaultImage, ogType: "website", robots: "index, follow" };
  if (!match) {
    if (!isKnownPublicRoute(req.path)) return { ...base, notFound: true, notFoundTitle: "Página no encontrada", notFoundMessage: "Esta dirección no existe en el showroom. Vuelve al catálogo para ver los vehículos disponibles." };
    return base;
  }
  let slug;
  try { slug = decodeURIComponent(match[2]); } catch { return { ...base, notFound: true }; }
  if (!slug) return { ...base, notFound: true };

  if (match[1].toLowerCase() === "vehiculos") {
    const result = await pool.query(`${vehicleSelect} WHERE v.organization_id=$1 AND v.status IN ('published','reserved') GROUP BY v.id, b.name, b.logo_url, c.name ORDER BY v.created_at DESC LIMIT ${CATALOG_SAFETY_LIMIT}`, [organization.id]);
    const vehicle = result.rows.find((candidate) => vehicleSlug(candidate) === slug);
    if (!vehicle) return { ...base, notFound: true, notFoundTitle: "Vehículo no encontrado", notFoundMessage: "Este vehículo ya no está disponible en el showroom o el enlace está incompleto." };
    const vehicleName = [vehicle.brand, vehicle.model, vehicle.variant].filter(Boolean).join(" ");
    const firstImage = vehicle.images?.find((image) => image?.url)?.url || vehicle.media?.find((media) => media?.posterUrl)?.posterUrl || defaultImage;
    return {
      title: `${vehicleName}${vehicle.year ? ` ${vehicle.year}` : ""} · ${businessName}`,
      description: metadataDescription(vehicle.seoDescription || vehicle.description, `${vehicleName} disponible en ${businessName}. Consulta precio, especificaciones y agenda una visita.`),
      image: absolutePublicAsset(origin, firstImage),
      ogType: "product",
      robots: "index, follow",
      vehicle,
    };
  }

  const result = await pool.query('SELECT title, summary, cover_image_url AS "coverImageUrl", seo_title AS "seoTitle", seo_description AS "seoDescription" FROM blog_posts WHERE organization_id=$1 AND slug=$2 AND status=\'published\'', [organization.id, slug]);
  if (!result.rowCount) return { ...base, notFound: true, notFoundTitle: "Artículo no encontrado", notFoundMessage: "Este artículo ya no está publicado o el enlace está incompleto." };
  const post = result.rows[0];
  return {
    title: metadataDescription(post.seoTitle || post.title, `${businessName} · Noticias`),
    description: metadataDescription(post.seoDescription || post.summary, `Noticias y novedades de ${businessName}.`),
    image: absolutePublicAsset(origin, post.coverImageUrl || defaultImage),
    ogType: "article",
    robots: "index, follow",
  };
}

// Consulta ligera a proposito: el catalogo para buscadores solo necesita nombre,
// precio y cuatro datos, no el SELECT completo con agregados de imagenes y media.
const prerenderCatalogQuery = `
  SELECT v.id, v.model, v.variant, v.year, v.price_usd AS "priceUsd", v.fuel_type AS "fuelType",
         v.transmission, v.mileage_km AS "mileageKm", b.name AS brand, c.name AS category
  FROM vehicles v
  JOIN vehicle_brands b ON b.id = v.brand_id
  LEFT JOIN vehicle_categories c ON c.id = v.category_id
  WHERE v.organization_id = $1 AND v.status IN ('published', 'reserved')
  ORDER BY v.created_at DESC
  LIMIT 60`;

async function buildPrerender({ req, organization, businessName, origin, canonical, settings, metadata }) {
  const empty = { prerender: "", jsonLd: "" };
  try {
    const logoUrl = absolutePublicAsset(origin, settings.logoUrl || organization.logoUrl);
    if (metadata.vehicle) {
      return {
        prerender: vehiclePrerender({ businessName, vehicle: metadata.vehicle, settings }),
        jsonLd: vehicleJsonLd({ businessName, origin, settings, logoUrl, vehicle: metadata.vehicle, image: metadata.image, canonical }),
      };
    }
    // Solo la portada: las rutas internas (blog, cuenta, preview) no ganan nada
    // con un catalogo incrustado y anadirian una consulta por visita.
    if (req.path !== "/" && req.path !== "/index.html") return empty;
    const result = await pool.query(prerenderCatalogQuery, [organization.id]);
    const vehicles = result.rows.map((vehicle) => ({ ...vehicle, slug: vehicleSlug(vehicle) }));
    return {
      prerender: catalogPrerender({ businessName, vehicles, settings }),
      jsonLd: catalogJsonLd({ businessName, origin, settings, logoUrl, vehicles }),
    };
  } catch (error) {
    // El contenido para buscadores nunca debe impedir que la pagina se sirva.
    console.error("Prerender failed", error);
    return empty;
  }
}

async function sendTenantIndex(req, res, next) {
  try {
    const organization = await getOrganizationContext(req);
    const settings = await pool.query(
      'SELECT business_name AS "businessName", logo_url AS "logoUrl", phone, email, address, hours, currency, instagram_url AS "instagramUrl", facebook_url AS "facebookUrl" FROM organization_settings WHERE organization_id=$1',
      [organization.id],
    );
    const businessName = String(settings.rows[0]?.businessName || organization.name || "AUTHENTIQ").trim().slice(0, 120) || "AUTHENTIQ";
    const origin = publicOriginForOrganization(req, organization).replace(/\/$/, "");
    const canonicalPath = req.path === "/index.html" ? "/" : req.path;
    const canonical = `${origin}${canonicalPath}`;
    const defaultImage = absolutePublicAsset(origin, settings.rows[0]?.logoUrl || organization.logoUrl);
    const metadata = await publicRouteMetadata(req, organization, { businessName, origin, defaultImage });
    if (metadata.notFound) {
      res.status(404).type("html").send(publicNotFoundHtml({ businessName, origin, title: metadata.notFoundTitle || "Página no encontrada", message: metadata.notFoundMessage }));
      return;
    }
    const publicSettings = settings.rows[0] || {};
    const { prerender, jsonLd } = await buildPrerender({ req, organization, businessName, origin, canonical, settings: publicSettings, metadata });
    const html = await fs.readFile(frontendIndex, "utf8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.type("html").send(html
      .replaceAll("<!--__AUTHENTIQ_PRERENDER__-->", prerender)
      .replaceAll("<!--__AUTHENTIQ_JSONLD__-->", jsonLd)
      .replaceAll("__AUTHENTIQ_TITLE__", escapeHtml(metadata.title))
      .replaceAll("__AUTHENTIQ_DESCRIPTION__", escapeHtml(metadata.description))
      .replaceAll("__AUTHENTIQ_IMAGE__", escapeHtml(metadata.image))
      .replaceAll("__AUTHENTIQ_CANONICAL__", escapeHtml(canonical))
      .replaceAll("__AUTHENTIQ_ROBOTS__", escapeHtml(metadata.robots))
      .replaceAll("__AUTHENTIQ_OG_TYPE__", escapeHtml(metadata.ogType))
      .replaceAll("__AUTHENTIQ_SITE_NAME__", escapeHtml(businessName)));
  } catch (error) {
    if (isOrganizationNotFound(error)) {
      res.status(404).type("html").send(publicNotFoundHtml({ title: "Showroom no encontrado", message: "Revisa el enlace o vuelve al espacio principal para explorar los dealers disponibles." }));
      return;
    }
    next(error);
  }
}
app.get(["/", "/index.html"], sendTenantIndex);
app.use(express.static(frontendDist, {
  maxAge: "1h",
  setHeaders: (response, filePath) => {
    // El HTML debe descubrir siempre los chunks hash del último deploy;
    // los assets versionados mantienen la caché larga sin mezclar releases.
    if (path.basename(filePath) === "index.html") response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  },
}));
app.use("/api", (_req, res) => res.status(404).json({ error: "Recurso no encontrado" }));
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/uploads/") || req.path.startsWith("/api")) return next();
  sendTenantIndex(req, res, next);
});

// Último recurso: cualquier error no controlado responde JSON consistente y sin filtrar detalles internos.
app.use((error, req, res, _next) => {
  const clientInputError = error?.type === "entity.parse.failed" || error?.type === "entity.too.large";
  if (!clientInputError) {
    console.error("Unhandled request error", error);
    // Etiquetamos por concesionario y ruta: así se sabe qué dealer está roto.
    reportServerError(error, { tenant: req?.organizationContext?.slug || req?.admin?.organizationId, route: req?.originalUrl?.split("?")[0], method: req?.method, role: req?.admin?.role });
  }
  if (res.headersSent) return;
  if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "El cuerpo de la petición no es JSON válido" });
  if (error?.type === "entity.too.large") return res.status(413).json({ error: "La petición es demasiado grande" });
  res.status(500).json({ error: "Ocurrió un error inesperado" });
});

initMonitoring();
process.on("unhandledRejection", (reason) => { console.error("Unhandled promise rejection", reason); reportServerError(reason instanceof Error ? reason : new Error(String(reason)), { route: "unhandledRejection" }); });
process.on("uncaughtException", (error) => { console.error("Uncaught exception", error); reportServerError(error, { route: "uncaughtException" }); });

const isVercelRuntime = Boolean(process.env.VERCEL);
const server = isVercelRuntime ? null : app.listen(port, () => console.log(`AUTHENTIQ API running on http://localhost:${port}`));
const reminderTimer = isVercelRuntime ? null : setInterval(() => dispatchAppointmentReminders().catch((error) => console.error("Appointment reminders failed", error)), 5 * 60 * 1000);
if (!isVercelRuntime) dispatchAppointmentReminders().catch((error) => console.error("Initial appointment reminders failed", error));
const shutdown = (signal) => {
  console.log(`AUTHENTIQ API shutting down (${signal})`);
  if (reminderTimer) clearInterval(reminderTimer);
  if (!server) return;
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

export default app;

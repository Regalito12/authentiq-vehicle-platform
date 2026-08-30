import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || "";
const databaseUrl = new URL(connectionString);
if (!/[.]?(localhost|127[.]0[.]0[.]1)$/.test(databaseUrl.hostname)) {
  throw new Error("Este seed solo puede ejecutarse contra una base de datos local (localhost/127.0.0.1).");
}

const pool = new Pool({ connectionString });
let databaseClient;
const demoPassword = process.env.LOCAL_DEMO_ADMIN_PASSWORD || "12345678";
const demoDealers = [
  {
    slug: "dealer-demo", name: "Aurea Motors", email: process.env.LOCAL_DEMO_ADMIN_EMAIL || "demo@dealer.local",
    adminName: "Aurea Motors Admin", primaryColor: "#c8a24b", accentColor: "#b28b37", sampleOffset: 0,
  },
  {
    slug: "velocity-demo", name: "Velocity Motors", email: process.env.LOCAL_VELOCITY_ADMIN_EMAIL || "velocity@dealer.local",
    adminName: "Velocity Motors Admin", primaryColor: "#3db8ad", accentColor: "#1b776f", sampleOffset: 1,
  },
];

async function upsertTaxonomy(organizationId, sample) {
  const brand = await databaseClient.query(
    `INSERT INTO vehicle_brands (organization_id, name, logo_url, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (organization_id, name) DO UPDATE SET is_active=TRUE, logo_url=COALESCE(EXCLUDED.logo_url, vehicle_brands.logo_url)
     RETURNING id`,
    [organizationId, sample.brandName, sample.brandLogoUrl],
  );
  const category = await databaseClient.query(
    `INSERT INTO vehicle_categories (organization_id, name, is_active)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (organization_id, name) DO UPDATE SET is_active=TRUE
     RETURNING id`,
    [organizationId, sample.categoryName || "otros"],
  );
  return { brandId: brand.rows[0].id, categoryId: category.rows[0].id };
}

async function copyVehicle(organizationId, sample) {
  if (!sample) return null;
  const taxonomy = await upsertTaxonomy(organizationId, sample);
  const existing = await databaseClient.query(
    `SELECT id FROM vehicles
     WHERE organization_id=$1 AND (stock_number LIKE '%-DEMO' OR stock_number LIKE '%-DEALE' OR stock_number LIKE '%-VELOC')
     ORDER BY created_at ASC LIMIT 1`,
    [organizationId],
  );
  if (existing.rowCount) {
    await databaseClient.query("UPDATE vehicles SET brand_id=$1, category_id=$2 WHERE id=$3", [taxonomy.brandId, taxonomy.categoryId, existing.rows[0].id]);
    return existing.rows[0].id;
  }
  const copied = await databaseClient.query(
    `INSERT INTO vehicles (
       organization_id, brand_id, category_id, model, variant, year, condition, price_usd, engine, power,
       transmission, drive, fuel_type, exterior_color, interior_color, doors, seats, location, stock_number,
       warranty, features, mileage_km, description, seo_title, seo_description, stock, status, max_discount_percent
     )
     SELECT $1, $2, $3, model, variant, year, condition, price_usd, engine, power,
       transmission, drive, fuel_type, exterior_color, interior_color, doors, seats, location,
       COALESCE(NULLIF(stock_number, '') || '-' || upper(substr($4, 1, 5)), upper(substr($4, 1, 5)) || '-' || substr(id::text, 1, 8)),
       warranty, features, mileage_km, description, seo_title, seo_description, stock, 'published', max_discount_percent
     FROM vehicles
     WHERE id=$5 AND NOT EXISTS (SELECT 1 FROM vehicles WHERE organization_id=$1)
     RETURNING id`,
    [organizationId, taxonomy.brandId, taxonomy.categoryId, sample.slug, sample.id],
  );
  const vehicleId = copied.rows[0]?.id || null;
  if (!vehicleId) return null;
  await databaseClient.query("INSERT INTO vehicle_images (vehicle_id, image_url, alt_text, sort_order) SELECT $1, image_url, alt_text, sort_order FROM vehicle_images WHERE vehicle_id=$2", [vehicleId, sample.id]);
  await databaseClient.query("INSERT INTO vehicle_media (vehicle_id, media_type, url, poster_url, alt_text, sort_order, is_active, metadata) SELECT $1, media_type, url, poster_url, alt_text, sort_order, is_active, metadata FROM vehicle_media WHERE vehicle_id=$2", [vehicleId, sample.id]);
  return vehicleId;
}

async function seedDealer(dealer, sourceOrganizationId, passwordHash) {
  const organization = await databaseClient.query(
    `INSERT INTO organizations (slug, name, logo_url)
     VALUES ($1, $2, NULL)
     ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, is_active=TRUE, updated_at=NOW()
     RETURNING id`,
    [dealer.slug, dealer.name],
  );
  const organizationId = organization.rows[0].id;
  await databaseClient.query(
    `INSERT INTO organization_settings (
       organization_id, business_name, logo_url, phone, whatsapp, email, address, hours,
       instagram_url, facebook_url, currency, privacy_text, terms_text,
       appointment_timezone, appointment_start, appointment_end, appointment_duration_minutes,
       appointment_min_notice_hours, appointment_max_days_ahead, appointment_days, appointment_capacity
     )
     SELECT $1, $2, logo_url, phone, whatsapp, $3, address, hours,
       instagram_url, facebook_url, currency, privacy_text, terms_text,
       appointment_timezone, appointment_start, appointment_end, appointment_duration_minutes,
       appointment_min_notice_hours, appointment_max_days_ahead, appointment_days, appointment_capacity
     FROM organization_settings WHERE organization_id=$4
     ON CONFLICT (organization_id) DO UPDATE SET business_name=EXCLUDED.business_name, email=EXCLUDED.email, updated_at=NOW()`,
    [organizationId, dealer.name, dealer.email, sourceOrganizationId],
  );
  await databaseClient.query(
    "UPDATE organization_settings SET primary_color=$1, accent_color=$2, updated_at=NOW() WHERE organization_id=$3",
    [dealer.primaryColor, dealer.accentColor, organizationId],
  );
  const admin = await databaseClient.query(
    `INSERT INTO admin_users (full_name, email, password_hash, role, organization_id, must_change_password, is_active)
     VALUES ($1, $2, $3, 'admin', $4, FALSE, TRUE)
     ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name, organization_id=EXCLUDED.organization_id, password_hash=EXCLUDED.password_hash,
       role='admin', must_change_password=FALSE, is_active=TRUE, updated_at=NOW()
     RETURNING id`,
    [dealer.adminName, dealer.email, passwordHash, organizationId],
  );
  await databaseClient.query(
    `INSERT INTO organization_members (organization_id, admin_user_id, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (organization_id, admin_user_id) DO UPDATE SET role='admin'`,
    [organizationId, admin.rows[0].id],
  );
  const source = await databaseClient.query(
    `SELECT v.id, b.name AS "brandName", b.logo_url AS "brandLogoUrl", c.name AS "categoryName"
     FROM vehicles v
     JOIN vehicle_brands b ON b.id=v.brand_id
     LEFT JOIN vehicle_categories c ON c.id=v.category_id
     WHERE v.organization_id=$1
     ORDER BY v.created_at ASC
     OFFSET $2 LIMIT 1`,
    [sourceOrganizationId, dealer.sampleOffset],
  );
  const fallback = source.rowCount ? source.rows[0] : (await databaseClient.query(
    `SELECT v.id, b.name AS "brandName", b.logo_url AS "brandLogoUrl", c.name AS "categoryName"
     FROM vehicles v JOIN vehicle_brands b ON b.id=v.brand_id LEFT JOIN vehicle_categories c ON c.id=v.category_id
     WHERE v.organization_id=$1 ORDER BY v.created_at ASC LIMIT 1`, [sourceOrganizationId],
  )).rows[0];
  const copiedVehicleId = await copyVehicle(organizationId, { ...fallback, slug: dealer.slug });
  return { organization: dealer.slug, host: `${dealer.slug}.localhost`, adminEmail: dealer.email, copiedVehicleId };
}

try {
  databaseClient = await pool.connect();
  await databaseClient.query("BEGIN");
  const zevroa = await databaseClient.query("SELECT id FROM organizations WHERE slug='zevroa' FOR UPDATE");
  if (!zevroa.rowCount) throw new Error("No existe la organización zevroa. Aplica primero las migraciones.");
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const dealers = [];
  for (const dealer of demoDealers) dealers.push(await seedDealer(dealer, zevroa.rows[0].id, passwordHash));
  await databaseClient.query("COMMIT");
  console.log(JSON.stringify({ ok: true, password: demoPassword, dealers }, null, 2));
} catch (error) {
  await databaseClient?.query("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  databaseClient?.release();
  await pool.end();
}

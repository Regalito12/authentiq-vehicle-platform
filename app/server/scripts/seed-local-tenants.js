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
const demoPassword = process.env.LOCAL_DEMO_ADMIN_PASSWORD || "12345678";
const demoEmail = process.env.LOCAL_DEMO_ADMIN_EMAIL || "demo@dealer.local";

try {
  await pool.query("BEGIN");
  const authentiq = await pool.query("SELECT id FROM organizations WHERE slug='authentiq' FOR UPDATE");
  if (!authentiq.rowCount) throw new Error("No existe la organización authentiq. Aplica primero las migraciones.");

  const organization = await pool.query(
    `INSERT INTO organizations (slug, name, logo_url)
     VALUES ('dealer-demo', 'Dealer Demo', NULL)
     ON CONFLICT (slug) DO UPDATE SET is_active=TRUE, updated_at=NOW()
     RETURNING id`,
  );
  const organizationId = organization.rows[0].id;
  const sourceId = authentiq.rows[0].id;

  await pool.query(
    `INSERT INTO organization_settings (
       organization_id, business_name, logo_url, phone, whatsapp, email, address, hours,
       instagram_url, facebook_url, currency, privacy_text, terms_text,
       appointment_timezone, appointment_start, appointment_end, appointment_duration_minutes,
       appointment_min_notice_hours, appointment_max_days_ahead, appointment_days, appointment_capacity
     )
     SELECT $1, 'Dealer Demo', logo_url, phone, whatsapp, email, address, hours,
       instagram_url, facebook_url, currency, privacy_text, terms_text,
       appointment_timezone, appointment_start, appointment_end, appointment_duration_minutes,
       appointment_min_notice_hours, appointment_max_days_ahead, appointment_days, appointment_capacity
     FROM organization_settings WHERE organization_id=$2
     ON CONFLICT (organization_id) DO UPDATE SET business_name='Dealer Demo', updated_at=NOW()`,
    [organizationId, sourceId],
  );

  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const admin = await pool.query(
    `INSERT INTO admin_users (full_name, email, password_hash, role, organization_id, must_change_password, is_active)
     VALUES ('Dealer Demo Admin', $1, $2, 'admin', $3, FALSE, TRUE)
     ON CONFLICT (email) DO UPDATE SET organization_id=EXCLUDED.organization_id, password_hash=EXCLUDED.password_hash,
       role='admin', must_change_password=FALSE, is_active=TRUE, updated_at=NOW()
     RETURNING id`,
    [demoEmail, passwordHash, organizationId],
  );
  await pool.query(
    `INSERT INTO organization_members (organization_id, admin_user_id, role)
     VALUES ($1,$2,'admin')
     ON CONFLICT (organization_id, admin_user_id) DO UPDATE SET role='admin'`,
    [organizationId, admin.rows[0].id],
  );

  const sample = await pool.query("SELECT id FROM vehicles WHERE organization_id=$1 ORDER BY created_at ASC LIMIT 1", [sourceId]);
  let copiedVehicleId = null;
  if (sample.rowCount) {
    const copied = await pool.query(
      `INSERT INTO vehicles (
         organization_id, brand_id, category_id, model, variant, year, condition, price_usd, engine, power,
         transmission, drive, fuel_type, exterior_color, interior_color, doors, seats, location, stock_number,
         warranty, features, mileage_km, description, seo_title, seo_description, stock, status, max_discount_percent
       )
       SELECT $1, brand_id, category_id, model, variant, year, condition, price_usd, engine, power,
         transmission, drive, fuel_type, exterior_color, interior_color, doors, seats, location,
         COALESCE(NULLIF(stock_number, '') || '-DEMO', 'DEMO-' || substr(id::text, 1, 8)),
         warranty, features, mileage_km, description, seo_title, seo_description, stock, status, max_discount_percent
       FROM vehicles
       WHERE id=$2 AND NOT EXISTS (SELECT 1 FROM vehicles WHERE organization_id=$1)
       RETURNING id`,
      [organizationId, sample.rows[0].id],
    );
    copiedVehicleId = copied.rows[0]?.id || null;
    if (copiedVehicleId) {
      await pool.query("INSERT INTO vehicle_images (vehicle_id, image_url, alt_text, sort_order) SELECT $1, image_url, alt_text, sort_order FROM vehicle_images WHERE vehicle_id=$2", [copiedVehicleId, sample.rows[0].id]);
      await pool.query("INSERT INTO vehicle_media (vehicle_id, media_type, url, poster_url, alt_text, sort_order, is_active, metadata) SELECT $1, media_type, url, poster_url, alt_text, sort_order, is_active, metadata FROM vehicle_media WHERE vehicle_id=$2", [copiedVehicleId, sample.rows[0].id]);
    }
  }

  await pool.query("COMMIT");
  console.log(JSON.stringify({ ok: true, organization: "dealer-demo", host: "dealer-demo.localhost", adminEmail: demoEmail, adminPassword: demoPassword, copiedVehicleId }, null, 2));
} catch (error) {
  await pool.query("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

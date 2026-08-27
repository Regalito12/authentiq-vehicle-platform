import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(scriptDir, "../../database");
const expectedFiles = [
  "029_appointments_foundation.sql",
  "030_appointment_blocks.sql",
  "031_appointment_reminders.sql",
  "032_multitenancy_foundation.sql",
  "034_white_label_domain.sql",
  "035_organization_settings.sql",
  "036_local_integrations.sql",
  "037_white_label_branding.sql",
  "038_taxonomy_multitenancy.sql",
  "039_platform_dealer_hub.sql",
  "040_vehicle_3d_generation.sql",
  "041_dealer_approval_workflow.sql",
  "042_platform_admin_overrides.sql",
  "043_dealer_storefront_customization.sql",
  "044_google_calendar.sql",
  "045_storefront_trust_content.sql",
  "046_password_recovery_and_sessions.sql",
  "047_billing_events_and_email_outbox.sql",
  "048_public_request_idempotency.sql",
  "049_rebrand_zevroa.sql",
];
const expectedTables = ["appointment_blocks", "organizations", "organization_members", "organization_settings", "organization_integrations", "social_drafts", "billing_subscriptions", "platform_plans", "vehicle_3d_jobs", "password_reset_tokens", "billing_webhook_events", "email_delivery_log", "public_request_idempotency"];
const expectedColumns = [
  ["organizations", "custom_domain"],
  ["business_settings", "appointment_capacity"],
  ["test_drive_requests", "lead_id"],
  ["test_drive_requests", "reminder_24h_sent_at"],
  ["test_drive_requests", "reminder_2h_sent_at"],
  ["admin_users", "organization_id"],
  ["business_settings", "organization_id"],
  ["vehicles", "organization_id"],
  ["leads", "organization_id"],
  ["test_drive_requests", "organization_id"],
  ["offers", "organization_id"],
  ["quotes", "organization_id"],
  ["blog_posts", "organization_id"],
  ["appointment_blocks", "organization_id"],
  ["analytics_events", "organization_id"],
  ["social_drafts", "organization_id"],
  ["billing_subscriptions", "organization_id"],
  ["organization_settings", "primary_color"],
  ["organization_settings", "accent_color"],
  ["organization_settings", "favicon_url"],
  ["vehicle_brands", "organization_id"],
  ["vehicle_categories", "organization_id"],
  ["organizations", "approval_status"],
  ["organization_settings", "custom_css"],
  ["organization_settings", "hero_headline"],
  ["organization_settings", "show_financing"],
  ["test_drive_requests", "google_event_id"],
  ["organization_settings", "faq_items"],
  ["organization_settings", "testimonials"],
  ["admin_users", "session_version"],
  ["customer_accounts", "session_version"],
];

const missingFiles = [];
for (const file of expectedFiles) {
  try { await fs.access(path.join(databaseDir, file)); } catch { missingFiles.push(file); }
}
if (missingFiles.length) {
  console.error(`MIGRATIONS FAIL · faltan archivos: ${missingFiles.join(", ")}`);
  process.exit(1);
}
if (!String(process.env.DATABASE_URL || "").trim()) {
  console.error("MIGRATIONS FAIL · falta DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const tableResult = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [expectedTables],
  );
  const foundTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = expectedTables.filter((table) => !foundTables.has(table));

  const columnResult = await pool.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (SELECT * FROM unnest($1::text[], $2::text[]))",
    [expectedColumns.map(([table]) => table), expectedColumns.map(([, column]) => column)],
  );
  const foundColumns = new Set(columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missingColumns = expectedColumns.filter(([table, column]) => !foundColumns.has(`${table}.${column}`));

  if (missingTables.length || missingColumns.length) {
    if (missingTables.length) console.error(`MIGRATIONS FAIL · faltan tablas: ${missingTables.join(", ")}`);
    if (missingColumns.length) console.error(`MIGRATIONS FAIL · faltan columnas: ${missingColumns.map(([table, column]) => `${table}.${column}`).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`MIGRATIONS PASS · archivos ${expectedFiles.join(" → ")}`);
    console.log(`tablas=${expectedTables.length} columnas=${expectedColumns.length} database=connected`);
  }
} finally {
  await pool.end();
}

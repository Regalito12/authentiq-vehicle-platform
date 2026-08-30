import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const { Pool } = pg;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.resolve(scriptDir, "../../database");
const manifestCheck = spawnSync(process.execPath, [path.join(scriptDir, "check-migration-manifest.mjs")], { stdio: "inherit" });
if (manifestCheck.status !== 0) process.exit(manifestCheck.status || 1);
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
  "050_rebrand_public_seo.sql",
  "051_tenant_safe_customer_notifications.sql",
  "052_crm_contacts_and_timeline.sql",
  "053_invitations_and_mfa.sql",
  "054_reconcile_google_calendar_schema.sql",
  "055_crm_contact_relationships.sql",
];
const expectedTables = ["appointment_blocks", "organizations", "organization_members", "organization_settings", "organization_integrations", "social_drafts", "billing_subscriptions", "platform_plans", "vehicle_3d_jobs", "password_reset_tokens", "billing_webhook_events", "email_delivery_log", "public_request_idempotency", "customer_notifications", "crm_contacts", "crm_contact_events", "admin_invitations"];
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
  ["customer_notifications", "organization_id"],
  ["leads", "contact_id"],
  ["test_drive_requests", "contact_id"],
  ["quotes", "contact_id"],
  ["offers", "contact_id"],
  ["admin_users", "mfa_enabled"],
  ["admin_users", "mfa_secret_encrypted"],
  ["admin_users", "mfa_recovery_codes"],
];
const expectedRoutines = [
  "zevroa_resolve_crm_contact",
  "zevroa_sync_lead_contact",
  "zevroa_sync_appointment_contact",
  "zevroa_sync_offer_contact",
  "zevroa_sync_quote_contact",
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
  const routineResult = await pool.query("SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name = ANY($1::text[])", [expectedRoutines]);
  const foundRoutines = new Set(routineResult.rows.map((row) => row.routine_name));
  const missingRoutines = expectedRoutines.filter((routine) => !foundRoutines.has(routine));

  if (missingTables.length || missingColumns.length || missingRoutines.length) {
    if (missingTables.length) console.error(`MIGRATIONS FAIL · faltan tablas: ${missingTables.join(", ")}`);
    if (missingColumns.length) console.error(`MIGRATIONS FAIL · faltan columnas: ${missingColumns.map(([table, column]) => `${table}.${column}`).join(", ")}`);
    if (missingRoutines.length) console.error(`MIGRATIONS FAIL · faltan rutinas: ${missingRoutines.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`MIGRATIONS PASS · archivos ${expectedFiles.join(" → ")}`);
    console.log(`tablas=${expectedTables.length} columnas=${expectedColumns.length} rutinas=${expectedRoutines.length} database=connected`);
  }
} finally {
  await pool.end();
}

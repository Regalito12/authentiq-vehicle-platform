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
];
const expectedTables = ["appointment_blocks", "organizations", "organization_members"];
const expectedColumns = [
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

import "dotenv/config";
import fs from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const migrationName = process.argv[2] || "003_leads.sql";
const sqlPath = new URL(`../../database/${migrationName}`, import.meta.url);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const sql = await fs.readFile(sqlPath, "utf8");
  await pool.query(sql);
  console.log(`Migración aplicada: ${migrationName}`);
} finally {
  await pool.end();
}

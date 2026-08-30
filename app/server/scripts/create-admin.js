import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const rl = readline.createInterface({ input, output });

try {
  const email = (process.argv.find((arg) => arg.startsWith("--email=")) || "--email=admin@zevroa.local").slice(8);
  const fullName = process.argv.find((arg) => arg.startsWith("--name="))?.slice(7) || "Administrador";
  const password = await rl.question(`Contraseña para ${email}: `);
  if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admin_users (full_name, email, password_hash, role, organization_id)
     VALUES ($1, $2, $3, 'admin', (SELECT id FROM organizations WHERE slug='zevroa' LIMIT 1))
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, organization_id = COALESCE(admin_users.organization_id, EXCLUDED.organization_id), is_active = TRUE, must_change_password = FALSE, updated_at = NOW()`,
    [fullName, email, passwordHash],
  );
  console.log(`Administrador listo: ${email}`);
} finally {
  rl.close();
  await pool.end();
}

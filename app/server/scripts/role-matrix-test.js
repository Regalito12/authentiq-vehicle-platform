import "dotenv/config";

const apiUrl = process.env.SMOKE_API_URL || process.env.API_URL || "http://localhost:3001";
const adminEmail = process.env.SMOKE_EMAIL || "admin@authentiq.local";
const adminPassword = process.env.SMOKE_PASSWORD || "12345678";
const qaPassword = "QA-Authentiq-2026!";
const stamp = Date.now();
const createdUsers = [];

async function call(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, options);
  const raw = response.status === 204 ? "" : await response.text();
  let body = raw;
  try { body = raw ? JSON.parse(raw) : null; } catch {}
  return { response, body };
}

function headers(token) { return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }; }
function assert(condition, message) { if (!condition) throw new Error(message); }

const adminLogin = await call("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
assert(adminLogin.response.ok, "No se pudo iniciar sesión como admin");
const adminToken = adminLogin.body.token;

const roleRules = {
  editor: [["/api/admin/vehicles", 200], ["/api/admin/blog", 200], ["/api/admin/settings", 200], ["/api/admin/settings", 403, "PATCH"], ["/api/admin/audit-logs", 403]],
  seller: [["/api/admin/leads", 200], ["/api/admin/quotes", 200], ["/api/admin/dashboard", 200], ["/api/admin/settings", 403], ["/api/admin/blog", 403]],
  content_editor: [["/api/admin/blog", 200], ["/api/admin/dashboard", 200], ["/api/admin/leads", 403], ["/api/admin/settings", 200], ["/api/admin/settings", 403, "PATCH"]],
};

try {
  for (const role of Object.keys(roleRules)) {
    const email = `qa-${role}-${stamp}@authentiq.local`;
    const created = await call("/api/admin/users", { method: "POST", headers: headers(adminToken), body: JSON.stringify({ name: `QA ${role}`, email, password: qaPassword, role }) });
    assert(created.response.ok, `No se pudo crear usuario ${role}`);
    createdUsers.push(created.body.data);
    const login = await call("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: qaPassword }) });
    assert(login.response.ok, `No se pudo iniciar sesión como ${role}`);
    for (const [path, expected, method = "GET"] of roleRules[role]) {
      const result = await call(path, { method, headers: headers(login.body.token), ...(method === "PATCH" ? { body: JSON.stringify({}) } : {}) });
      assert(result.response.status === expected, `${role} en ${path}: esperado ${expected}, recibido ${result.response.status}`);
    }
    console.log(`PASS  ${role}: permisos permitidos y bloqueados correctos`);
  }
} finally {
  for (const user of createdUsers) {
    await call(`/api/admin/users/${user.id}`, { method: "PATCH", headers: headers(adminToken), body: JSON.stringify({ name: user.name, role: user.role, isActive: false }) });
  }
  console.log(`QA: ${createdUsers.length} cuentas temporales desactivadas`);
}

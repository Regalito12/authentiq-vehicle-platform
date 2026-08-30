import "dotenv/config";
import { assertSafeQaTarget, isLocalUrl, qaDatabaseUrl } from "./qa-safety.mjs";

const apiUrl = process.env.QA_TEST_URL || process.env.SMOKE_API_URL || process.env.API_URL || "http://localhost:3001";
if (!isLocalUrl(apiUrl)) assertSafeQaTarget({ target: apiUrl, operation: "La matriz de roles", databaseUrl: qaDatabaseUrl() });
const adminEmail = process.env.SMOKE_EMAIL || "admin@authentiq.local";
const adminPassword = process.env.SMOKE_PASSWORD || "12345678";
const qaPassword = "QA-Authentiq-2026!";
const stamp = Date.now();
const createdUsers = [];
let sessionCookie = "";

function rememberSessionCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(?:^|,\s*)(authentiq_admin_session)=[^;,]*/);
  if (match) sessionCookie = match[0].trim();
}

async function call(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (sessionCookie && !headers.Cookie) headers.Cookie = sessionCookie;
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers });
  rememberSessionCookie(response);
  const raw = response.status === 204 ? "" : await response.text();
  let body = raw;
  try { body = raw ? JSON.parse(raw) : null; } catch {}
  return { response, body };
}

function headers(token) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(sessionCookie ? { Cookie: sessionCookie } : {}),
  };
}
function assert(condition, message) { if (!condition) throw new Error(message); }

const adminLogin = await call("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
assert(adminLogin.response.ok, "No se pudo iniciar sesión como admin");
const adminToken = adminLogin.body?.token || "";
const adminCookie = sessionCookie;
assert(adminToken || adminCookie, "El login no devolvió token ni cookie de sesión");

const roleRules = {
  editor: [["/api/admin/vehicles", 200], ["/api/admin/blog", 200], ["/api/admin/settings", 200], ["/api/admin/settings", 200, "PATCH"], ["/api/admin/social/drafts", 200], ["/api/admin/calendar.ics", 200], ["/api/admin/onboarding", 200], ["/api/admin/audit-logs", 403]],
  seller: [["/api/admin/leads", 200], ["/api/admin/quotes", 200], ["/api/admin/dashboard", 200], ["/api/admin/settings", 403], ["/api/admin/blog", 403], ["/api/admin/onboarding", 403]],
  content_editor: [["/api/admin/blog", 200], ["/api/admin/dashboard", 200], ["/api/admin/social/drafts", 200], ["/api/admin/leads", 403], ["/api/admin/settings", 200], ["/api/admin/settings", 403, "PATCH"]],
};

try {
  for (const role of Object.keys(roleRules)) {
    const email = `qa-${role}-${stamp}@authentiq.local`;
    sessionCookie = adminCookie;
    const created = await call("/api/admin/users", { method: "POST", headers: headers(adminToken), body: JSON.stringify({ name: `QA ${role}`, email, password: qaPassword, role }) });
    assert(created.response.ok, `No se pudo crear usuario ${role}`);
    createdUsers.push(created.body.data);
    sessionCookie = "";
    const login = await call("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: qaPassword }) });
    assert(login.response.ok, `No se pudo iniciar sesión como ${role}`);
    const roleToken = login.body?.token || "";
    const roleCookie = sessionCookie;
    assert(roleToken || roleCookie, `El login de ${role} no devolvió token ni cookie de sesión`);
    sessionCookie = roleCookie;
    for (const [path, expected, method = "GET"] of roleRules[role]) {
      const currentSettings = method === "PATCH" && path === "/api/admin/settings" ? await call(path, { headers: headers(roleToken) }) : null;
      const result = await call(path, { method, headers: headers(roleToken), ...(method === "PATCH" ? { body: JSON.stringify(currentSettings?.body?.data || {}) } : {}) });
      assert(result.response.status === expected, `${role} en ${path}: esperado ${expected}, recibido ${result.response.status}`);
    }
    console.log(`PASS  ${role}: permisos permitidos y bloqueados correctos`);
  }
} finally {
  sessionCookie = adminCookie;
  let removed = 0;
  for (const user of createdUsers) {
    const deleted = await call(`/api/admin/users/${user.id}`, { method: "DELETE", headers: headers(adminToken) });
    if (deleted.response.ok || deleted.response.status === 204) { removed += 1; continue; }
    await call(`/api/admin/users/${user.id}`, { method: "PATCH", headers: headers(adminToken), body: JSON.stringify({ name: user.name, role: user.role, isActive: false }) });
  }
  console.log(`QA: ${removed} de ${createdUsers.length} cuentas temporales eliminadas${removed < createdUsers.length ? " (el resto quedaron desactivadas)" : ""}`);
}

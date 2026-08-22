import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = process.env.LOCAL_TEST_URL || "http://localhost:3001";
const demoPassword = process.env.LOCAL_DEMO_ADMIN_PASSWORD || "12345678";
const tenants = [
  { host: "authentiq.localhost", businessName: "AUTHENTIQ" },
  { host: "dealer-demo.localhost", businessName: "Aurea Motors", email: process.env.LOCAL_DEMO_ADMIN_EMAIL || "demo@dealer.local" },
  { host: "velocity-demo.localhost", businessName: "Velocity Motors", email: process.env.LOCAL_VELOCITY_ADMIN_EMAIL || "velocity@dealer.local" },
];

async function request(host, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "X-Forwarded-Host": host, ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.equal(response.ok, true, `${host} ${path} respondió ${response.status}: ${text}`);
  return data;
}

async function assertLoginRejected(host, email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-Host": host },
    body: JSON.stringify({ email, password: demoPassword }),
  });
  assert.equal(response.status, 401, `${email} no debe poder iniciar sesión bajo ${host}`);
}

const publicData = [];
for (const tenant of tenants) {
  const [settings, vehicles] = await Promise.all([
    request(tenant.host, "/api/settings"),
    request(tenant.host, "/api/vehicles"),
  ]);
  assert.equal(settings.data.businessName, tenant.businessName, `${tenant.host} resolvió una marca equivocada`);
  publicData.push({ ...tenant, settings: settings.data, vehicles: vehicles.data });
}

for (let index = 0; index < publicData.length; index += 1) {
  for (let compare = index + 1; compare < publicData.length; compare += 1) {
    const ids = new Set(publicData[index].vehicles.map((vehicle) => vehicle.id));
    assert.equal(publicData[compare].vehicles.some((vehicle) => ids.has(vehicle.id)), false, `${publicData[index].host} y ${publicData[compare].host} comparten vehículos`);
  }
}

for (const tenant of publicData.filter((item) => item.email)) {
  const login = await request(tenant.host, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: tenant.email, password: demoPassword }),
  });
  const [adminSettings, adminVehicles, adminQuotes] = await Promise.all([
    request(tenant.host, "/api/admin/settings", { headers: { Authorization: `Bearer ${login.token}` } }),
    request(tenant.host, "/api/admin/vehicles", { headers: { Authorization: `Bearer ${login.token}` } }),
    request(tenant.host, "/api/admin/quotes", { headers: { Authorization: `Bearer ${login.token}` } }),
  ]);
  assert.equal(adminSettings.data.businessName, tenant.businessName);
  assert.equal(adminVehicles.data.length, tenant.vehicles.length);
  tenant.adminQuotes = adminQuotes.data;
}

for (let index = 0; index < publicData.length; index += 1) {
  for (let compare = index + 1; compare < publicData.length; compare += 1) {
    const ids = new Set((publicData[index].adminQuotes || []).map((quote) => quote.id));
    assert.equal((publicData[compare].adminQuotes || []).some((quote) => ids.has(quote.id)), false, `${publicData[index].host} y ${publicData[compare].host} comparten cotizaciones`);
  }
}

await assertLoginRejected("dealer-demo.localhost", process.env.LOCAL_VELOCITY_ADMIN_EMAIL || "velocity@dealer.local");
await assertLoginRejected("velocity-demo.localhost", process.env.LOCAL_DEMO_ADMIN_EMAIL || "demo@dealer.local");

console.log(`TENANT ISOLATION PASS · ${publicData.map((tenant) => `${tenant.host}=${tenant.vehicles.length}`).join(" · ")} · marcas, inventarios, cotizaciones e inicios de sesión sin solapamiento`);

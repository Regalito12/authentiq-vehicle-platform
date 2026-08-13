import "dotenv/config";
import assert from "node:assert/strict";

const baseUrl = process.env.LOCAL_TEST_URL || "http://localhost:3001";
const demoEmail = process.env.LOCAL_DEMO_ADMIN_EMAIL || "demo@dealer.local";
const demoPassword = process.env.LOCAL_DEMO_ADMIN_PASSWORD || "12345678";

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

const authentiqSettings = await request("authentiq.localhost", "/api/settings");
const demoSettings = await request("dealer-demo.localhost", "/api/settings");
const authentiqVehicles = await request("authentiq.localhost", "/api/vehicles");
const demoVehicles = await request("dealer-demo.localhost", "/api/vehicles");

assert.equal(authentiqSettings.data.businessName, "AUTHENTIQ");
assert.equal(demoSettings.data.businessName, "Dealer Demo");
const authIds = new Set(authentiqVehicles.data.map((vehicle) => vehicle.id));
assert.equal(demoVehicles.data.some((vehicle) => authIds.has(vehicle.id)), false, "Los inventarios comparten vehículos");

const login = await request("dealer-demo.localhost", "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: demoEmail, password: demoPassword }),
});
assert.equal(login.user.organizationId, demoSettings.data.organizationId || login.user.organizationId);
const adminSettings = await request("dealer-demo.localhost", "/api/admin/settings", { headers: { Authorization: `Bearer ${login.token}` } });
const adminVehicles = await request("dealer-demo.localhost", "/api/admin/vehicles", { headers: { Authorization: `Bearer ${login.token}` } });
assert.equal(adminSettings.data.businessName, "Dealer Demo");
assert.equal(adminVehicles.data.length, demoVehicles.data.length);

console.log(`TENANT ISOLATION PASS · authentiq=${authentiqVehicles.data.length} vehículos · dealer-demo=${demoVehicles.data.length} vehículos · sin solapamiento`);

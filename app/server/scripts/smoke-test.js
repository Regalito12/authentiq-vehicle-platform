import "dotenv/config";

const apiUrl = process.env.SMOKE_API_URL || process.env.API_URL || "http://localhost:3001";
const email = process.env.SMOKE_EMAIL || "admin@authentiq.local";
const password = process.env.SMOKE_PASSWORD || "12345678";

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, options);
  const raw = response.status === 204 ? "" : await response.text();
  let body = raw;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* XML/text responses stay strings. */ }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const checks = [];
async function check(name, callback) {
  try { await callback(); checks.push(`PASS  ${name}`); }
  catch (error) { checks.push(`FAIL  ${name}: ${error.message}`); }
}

await check("API health", async () => {
  const { response, body } = await request("/api/health");
  assert(response.ok && body?.ok && body?.database === "connected", "API o PostgreSQL no disponible");
});

await check("Sitemap público", async () => {
  const { response, body } = await request("/sitemap.xml");
  assert(response.ok && String(body).includes("<urlset"), "Sitemap inválido");
});

await check("Robots público", async () => {
  const { response, body } = await request("/robots.txt");
  assert(response.ok && String(body).includes("Sitemap:"), "robots.txt no incluye sitemap");
});

let token = "";
await check("Login administrativo", async () => {
  const { response, body } = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert(response.ok && body?.token && body?.user?.role, "Credenciales o respuesta de login inválidas");
  token = body.token;
});

await check("Ruta protegida sin token", async () => {
  const { response } = await request("/api/admin/dashboard");
  assert(response.status === 401, `respondió ${response.status} en vez de 401`);
});

const authHeaders = () => ({ Authorization: `Bearer ${token}` });
for (const [name, path] of [["Dashboard", "/api/admin/dashboard"], ["Inventario", "/api/admin/vehicles"], ["Leads", "/api/admin/leads"], ["Cotizaciones", "/api/admin/quotes"], ["Analítica", "/api/admin/analytics?days=30"]]) {
  await check(`Backoffice · ${name}`, async () => {
    const { response } = await request(path, { headers: authHeaders() });
    assert(response.ok, `respondió ${response.status}`);
  });
}

await check("Eventos rechazan nombres no permitidos", async () => {
  const { response } = await request("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventName: "internal_password_dump" }) });
  assert(response.status === 400, `respondió ${response.status}`);
});

await check("Eventos comerciales aceptados", async () => {
  const { response } = await request("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventName: "page_view", path: "/smoke-test", source: "smoke-test" }) });
  assert(response.status === 204, `respondió ${response.status}`);
});

// El catálogo es una SPA: si el servidor deja de escribir el HTML dentro de #root,
// Google vuelve a recibir un contenedor vacío y el concesionario pierde indexación
// sin que nada más falle. Por eso se comprueba aquí.
await check("Portada entrega HTML real para buscadores", async () => {
  const { response, body } = await request("/");
  assert(response.ok, `respondió ${response.status}`);
  const html = String(body || "");
  assert(!html.includes("__AUTHENTIQ_PRERENDER__"), "el marcador de prerender quedó sin reemplazar");
  assert(/<div id="root"><main/.test(html), "no hay contenido dentro de #root");
  assert(/<h1>/.test(html), "falta el encabezado principal");
  assert(html.includes("application/ld+json") && html.includes("AutoDealer"), "falta el dato estructurado del concesionario");
});

console.log(checks.join("\n"));
const failures = checks.filter((item) => item.startsWith("FAIL"));
if (failures.length) process.exitCode = 1;

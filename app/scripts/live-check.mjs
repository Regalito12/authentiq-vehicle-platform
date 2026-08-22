const input = String(process.env.LIVE_URL || process.argv[2] || "").trim();

if (!input) {
  console.error("LIVE CHECK FAIL · indica LIVE_URL o pasa la URL como primer argumento");
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = new URL(input.endsWith("/") ? input : `${input}/`);
  baseUrl.pathname = "/";
  baseUrl.search = "";
  baseUrl.hash = "";
} catch {
  console.error("LIVE CHECK FAIL · URL inválida");
  process.exit(1);
}

const checks = [
  ["API health", "/api/health", 200],
  ["Frontend", "/", 200],
  ["Robots", "/robots.txt", 200],
  ["Sitemap", "/sitemap.xml", 200],
  ["Presentación", "/presentacion", 200],
];
let failed = 0;

for (const [label, path, expectedStatus] of checks) {
  const url = new URL(path, baseUrl);
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    const passed = response.status === expectedStatus && body.trim().length > 0;
    console.log(`${passed ? "PASS" : "FAIL"} ${label} · HTTP ${response.status} · ${url.pathname}`);
    if (!passed) failed += 1;
    if (path === "/api/health" && response.ok) {
      try {
        const health = JSON.parse(body);
        const database = health.data?.database || health.database;
        const storage = health.data?.storage || health.storage;
        // The API reports `available` for temporary local storage and
        // `supabase` when the production media provider is active. Both are
        // healthy states; only `unavailable` means the service cannot persist
        // media.
        const storageReady = storage === "available" || storage === "supabase";
        const dependenciesReady = database === "connected" && storageReady;
        console.log(`${dependenciesReady ? "PASS" : "FAIL"} Dependencias live · database=${database || "desconocida"} storage=${storage || "desconocida"}`);
        if (!dependenciesReady) failed += 1;
      } catch {
        console.log("FAIL Dependencias live · /api/health no devolvió JSON válido");
        failed += 1;
      }
    }
  } catch (error) {
    console.log(`FAIL ${label} · ${error.message}`);
    failed += 1;
  }
}

if (failed) {
  console.error(`LIVE CHECK FAIL · ${failed} comprobación${failed === 1 ? " fallida" : "es fallidas"}`);
  process.exit(1);
}

console.log(`LIVE CHECK PASS · ${baseUrl.origin}`);

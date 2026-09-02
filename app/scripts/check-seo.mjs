import { chromium } from "@playwright/test";

const baseUrl = String(process.env.SEO_BASE_URL || process.argv.find((arg) => arg.startsWith("--url="))?.slice(6) || "http://127.0.0.1:5173").replace(/\/$/, "");
const routes = [
  ["/", true],
  ["/para-dealers", true],
  ["/contacto", true],
  ["/ubicacion", true],
  ["/privacidad", false],
  ["/terminos", false],
  ["/presentacion", false],
  ["/backoffice", false],
];

const failures = [];
const pass = (message) => console.log(`PASS ${message}`);
const fail = (message) => { failures.push(message); console.error(`FAIL ${message}`); };

function assert(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const [route, shouldIndex] of routes) {
    const page = await browser.newPage();
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => null);
    // Metadata is applied by the route component. Waiting for the actual
    // canonical/title state avoids a false negative when a cold Vite build or
    // a slower device needs more than one animation frame to mount the route.
    await page.waitForFunction(() => Boolean(document.title.trim()) && Boolean(document.querySelector('link[rel="canonical"]')?.href), null, { timeout: 5_000 }).catch(() => null);
    await page.waitForTimeout(250);
    assert(response && response.ok(), `${route} responde ${response?.status() || "sin respuesta"}`);
    const snapshot = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || "",
      robots: document.querySelector('meta[name="robots"]')?.content || "",
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      schemas: [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => { try { return JSON.parse(node.textContent); } catch { return null; } }).filter(Boolean),
      visibleText: document.body.innerText,
    }));
    assert(snapshot.title.trim().length >= 10, `${route} tiene title`);
    assert(snapshot.description.length >= 50 && snapshot.description.length <= 180, `${route} tiene description de longitud válida`);
    assert(snapshot.canonical === `${baseUrl}${route}`, `${route} tiene canonical limpio`);
    assert(snapshot.robots === (shouldIndex ? "index, follow" : "noindex, nofollow"), `${route} tiene robots ${shouldIndex ? "indexable" : "privado"}`);
    assert(snapshot.schemas.length > 0, `${route} contiene JSON-LD válido`);
    if (route === "/para-dealers") assert(snapshot.schemas.some((schema) => schema["@type"] === "FAQPage" || schema["@graph"]?.some((node) => node["@type"] === "FAQPage")), `${route} contiene FAQPage`);
    assert(!/authentiq/i.test(snapshot.visibleText), `${route} no muestra la marca heredada`);
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\nSEO check failed: ${failures.length} assertion(s).`);
  process.exitCode = 1;
} else {
  console.log(`\nSEO check passed: ${routes.length} routes.`);
}

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Verificación en navegador real sin añadir dependencias: lanza el Chrome ya instalado
// con el puerto de depuración abierto y lo conduce por Chrome DevTools Protocol
// usando el WebSocket nativo de Node 22.
//
//   node scripts/browser-check.js [--url http://127.0.0.1:5173] [--headful]
//
// Comprueba, por cada viewport: errores de consola, peticiones fallidas,
// desbordamiento horizontal, objetivos táctiles pequeños y metadatos SEO.

const args = process.argv.slice(2);
const siteUrl = (args.includes("--url") ? args[args.indexOf("--url") + 1] : process.env.SITE_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const headful = args.includes("--headful");
const outputDir = path.resolve(process.cwd(), "browser-check");
const port = 9333;

const browsers = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

const viewports = [
  { name: "movil-390x844", width: 390, height: 844, mobile: true },
  { name: "tablet-768x1024", width: 768, height: 1024, mobile: true },
  { name: "laptop-1280x800", width: 1280, height: 800, mobile: false },
  { name: "desktop-1440x900", width: 1440, height: 900, mobile: false },
];

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
};

// --- Cliente CDP mínimo -----------------------------------------------------
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else if (message.method) {
        this.listeners.forEach((listener) => listener(message.method, message.params));
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`Timeout en ${method}`)); }, 30000);
    });
  }
  on(listener) { this.listeners.push(listener); }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Error al evaluar");
    return result.result.value;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findBrowser() {
  for (const candidate of browsers) {
    try { await fs.access(candidate); return candidate; } catch { /* siguiente */ }
  }
  return null;
}

async function main() {
  const browserPath = await findBrowser();
  if (!browserPath) { console.error("FAIL  No se encontró Chrome ni Edge instalado."); process.exit(1); }

  // Comprueba que el sitio responde antes de arrancar el navegador.
  try {
    const probe = await fetch(siteUrl, { signal: AbortSignal.timeout(5000) });
    if (!probe.ok) throw new Error(`status ${probe.status}`);
  } catch (error) {
    console.error(`FAIL  El frontend no responde en ${siteUrl} — ${error.message}`);
    console.error("      Levántalo con:  cd app && npm.cmd run dev");
    process.exit(1);
  }

  await fs.mkdir(outputDir, { recursive: true });
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "authentiq-cdp-"));
  const chrome = spawn(browserPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    ...(headful ? [] : ["--headless=new"]),
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--hide-scrollbars", "--mute-audio", "about:blank",
  ], { stdio: "ignore" });

  let cdp;
  try {
    // Espera a que el puerto de depuración esté listo.
    let targets = null;
    for (let attempt = 0; attempt < 40 && !targets; attempt += 1) {
      await wait(250);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
        const list = await response.json();
        if (list.some((item) => item.type === "page")) targets = list;
      } catch { /* todavía arrancando */ }
    }
    if (!targets) throw new Error("El navegador no expuso el puerto de depuración");

    const page = targets.find((item) => item.type === "page");
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("No se pudo abrir el WebSocket CDP")), { once: true });
    });
    cdp = new Cdp(socket);

    const consoleErrors = [];
    const failedRequests = [];
    cdp.on((method, params) => {
      if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ").slice(0, 300));
      }
      if (method === "Runtime.exceptionThrown") {
        consoleErrors.push(`EXCEPCIÓN: ${params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || ""}`.slice(0, 300));
      }
      if (method === "Network.loadingFailed" && !params.canceled) {
        failedRequests.push(`${params.type} — ${params.errorText}`);
      }
      if (method === "Network.responseReceived" && params.response.status >= 400) {
        failedRequests.push(`${params.response.status} ${params.response.url.slice(0, 140)}`);
      }
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    const navigate = async (url) => {
      consoleErrors.length = 0;
      failedRequests.length = 0;
      const loaded = new Promise((resolve) => {
        const listener = (method) => { if (method === "Page.loadEventFired") resolve(); };
        cdp.on(listener);
      });
      await cdp.send("Page.navigate", { url });
      await Promise.race([loaded, wait(15000)]);
      await wait(1800); // margen para el render de React y las llamadas al API
    };

    const setViewport = (viewport) => cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile,
    });

    const shoot = async (name) => {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await fs.writeFile(path.join(outputDir, `${name}.png`), Buffer.from(data, "base64"));
    };

    // ---- Catálogo en los cuatro viewports --------------------------------
    console.log(`\n== CATÁLOGO · ${siteUrl} ==`);
    for (const viewport of viewports) {
      await setViewport(viewport);
      await navigate(`${siteUrl}/`);
      const metrics = await cdp.evaluate(`(() => {
        const doc = document.documentElement;
        const overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - window.innerWidth;
        const wide = [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2)
          .slice(0, 4)
          .map((el) => (el.tagName + '.' + String(el.className || '')).slice(0, 70));
        const small = [...document.querySelectorAll('button, a[href], select, input')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 28; }).length;
        return {
          overflow, wide, small,
          cards: document.querySelectorAll('.vehicle-card').length,
          title: document.title,
          root: (document.getElementById('root')?.innerHTML || '').length,
        };
      })()`);
      await shoot(`catalogo-${viewport.name}`);
      check(`${viewport.name} · la página monta contenido real`, metrics.root > 2000, `${metrics.root} bytes en #root`);
      check(`${viewport.name} · sin desbordamiento horizontal`, metrics.overflow <= 1, `sobresale ${metrics.overflow}px · ${metrics.wide.join(" | ")}`);
      check(`${viewport.name} · el catálogo pinta vehículos`, metrics.cards > 0, `${metrics.cards} tarjetas`);
      check(`${viewport.name} · sin errores de consola`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" || "));
      check(`${viewport.name} · sin peticiones fallidas`, failedRequests.length === 0, failedRequests.slice(0, 2).join(" || "));
      if (metrics.small > 0) console.log(`      nota: ${metrics.small} controles con menos de 28px de alto`);
    }

    // ---- Ficha de vehículo con modelo 3D ---------------------------------
    // ---- Presentación guiada ----------------------------------------------
    console.log("\n== PRESENTACIÓN GUIADA ==");
    await setViewport(viewports[3]);
    await navigate(`${siteUrl}/presentacion`);
    const presentation = await cdp.evaluate(`(() => ({
      root: (document.getElementById('root')?.innerHTML || '').length,
      stage: Boolean(document.querySelector('.presentation-stage')),
      story: document.querySelector('.presentation-story')?.textContent || '',
      controls: document.querySelectorAll('.presentation-control, .presentation-vehicle').length,
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    }))()`);
    check("La presentación guiada monta contenido real", presentation.root > 1800, `${presentation.root} bytes en #root`);
    check("La presentación tiene escenario visual", presentation.stage);
    check("La presentación explica el recorrido comercial", /Descubre.*Compara.*Decide/s.test(presentation.story));
    check("La presentación ofrece controles", presentation.controls > 1, `${presentation.controls} controles`);
    check("Presentación sin desbordamiento horizontal", presentation.overflow <= 1, `sobresale ${presentation.overflow}px`);
    check("Presentación sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" || "));
    check("Presentación sin peticiones fallidas", failedRequests.length === 0, failedRequests.slice(0, 2).join(" || "));
    await shoot("presentacion-desktop-1440x900");

    console.log("\n== FICHA DE VEHÍCULO (con 3D real) ==");
    await setViewport(viewports[3]);
    const apiUrl = process.env.API_BASE_URL || "http://127.0.0.1:3001";
    const catalog = await (await fetch(`${apiUrl}/api/vehicles`)).json();
    const target = catalog.data.find((item) => item.media?.some((media) => media.type === "model_3d")) || catalog.data[0];
    const slugify = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const slug = `${slugify(`${target.brand}-${target.model}${target.variant ? `-${target.variant}` : ""}`)}-${String(target.id).replace(/-/g, "").slice(0, 8)}`;

    await navigate(`${siteUrl}/vehiculos/${slug}`);
    const detail = await cdp.evaluate(`(() => ({
      title: document.title,
      canonical: document.querySelector('link[rel=canonical]')?.href || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
      robots: document.querySelector('meta[name=robots]')?.content || '',
      hasDetail: Boolean(document.querySelector('.detail-page')),
      hasViewer: Boolean(document.querySelector('#vehicle-3d-viewer')),
      hasDecisionBar: Boolean(document.querySelector('.detail-decision-bar')),
      jsonLd: Boolean(document.querySelector('script[type="application/ld+json"]')),
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    }))()`);
    check("La ficha del vehículo renderiza", detail.hasDetail);
    check("El título refleja el vehículo, no el genérico", detail.title.includes(target.model), `título: "${detail.title}"`);
    check("Open Graph refleja el vehículo", detail.ogTitle.includes(target.model), `og:title: "${detail.ogTitle}"`);
    check("Canonical apunta a la ficha", detail.canonical.includes(slug), detail.canonical);
    check("La ficha es indexable", detail.robots.startsWith("index"), detail.robots);
    check("Hay datos estructurados schema.org", detail.jsonLd);
    check("La barra de decisión está presente", detail.hasDecisionBar);
    check("La sección del visor 3D existe con su ancla", detail.hasViewer);
    check("Ficha sin desbordamiento horizontal", detail.overflow <= 1, `sobresale ${detail.overflow}px`);
    check("Ficha sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
    check("Ficha sin peticiones fallidas", failedRequests.length === 0, failedRequests.slice(0, 3).join(" || "));

    // El modelo 3D es pesado: se le da tiempo real de descarga.
    console.log("      esperando la carga del modelo 3D…");
    // Las escenas GLTF incluyen binarios y texturas; el componente público
    // conserva el estado de carga hasta 30 s antes de mostrar fallback.
    await wait(30000);
    const viewer = await cdp.evaluate(`(() => {
      const el = document.querySelector('model-viewer');
      return el ? { present: true, loaded: Boolean(el.loaded), src: el.getAttribute('src') || '', status: document.querySelector('.vehicle-3d-status')?.textContent || '', fallback: Boolean(document.querySelector('.vehicle-3d-fallback')) } : { present: false };
    })()`);
    if (viewer.present) {
      check("El modelo 3D real carga en el navegador", viewer.loaded === true, `estado en pantalla: "${viewer.status}"`);
      check("El visor no cayó al estado de error", viewer.fallback === false);
    } else {
      console.log("      (este vehículo no tiene modelo 3D)");
    }
    await shoot("ficha-desktop-1440x900");

    await setViewport(viewports[0]);
    await navigate(`${siteUrl}/vehiculos/${slug}`);
    const mobileDetail = await cdp.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth");
    check("Ficha en móvil sin desbordamiento horizontal", mobileDetail <= 1, `sobresale ${mobileDetail}px`);
    await shoot("ficha-movil-390x844");

    // ---- Backoffice -------------------------------------------------------
    console.log("\n== BACKOFFICE (login) ==");
    await setViewport(viewports[2]);
    await navigate(`${siteUrl}/`);
    const backoffice = await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((el) => /BACKOFFICE/i.test(el.textContent));
      if (button) button.click();
      return Boolean(button);
    })()`);
    await wait(2500);
    const loginState = await cdp.evaluate(`(() => ({
      hasLogin: Boolean(document.querySelector('.admin-login')),
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    }))()`);
    check("El backoffice se abre desde el catálogo", backoffice && loginState.hasLogin);
    check("Login del backoffice sin desbordamiento", loginState.overflow <= 1, `sobresale ${loginState.overflow}px`);
    check("Backoffice sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
    await shoot("backoffice-login-1280x800");

    // ---- Backoffice autenticado, módulo por módulo, en móvil y escritorio -----
    const adminEmail = process.env.E2E_EMAIL || process.env.SMOKE_EMAIL || "admin@authentiq.local";
    const adminPassword = process.env.E2E_PASSWORD || process.env.SMOKE_PASSWORD || "12345678";
    const session = await fetch(`${apiUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
    if (!session.ok) {
      console.log("      (sin credenciales válidas: se omite la auditoría del backoffice autenticado)");
    } else {
      const { token, user } = await session.json();
      const modules = [["dashboard", "Resumen"], ["inventory", "Inventario"], ["leads", "Leads"], ["quotes", "Cotizaciones"], ["blog", "Blog"], ["offers", "Ofertas"], ["reports", "Reportes"], ["audit", "Actividad"], ["users", "Usuarios"], ["settings", "Configuración"]];
      for (const [width, height, label, mobile] of [[390, 844, "movil", true], [1280, 800, "escritorio", false]]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
        // Inyecta la sesión antes de cargar para entrar directo al backoffice.
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('authentiq_admin_token',${JSON.stringify(token)});localStorage.setItem('authentiq_admin_user',${JSON.stringify(JSON.stringify(user))});}catch(e){}` });
        await navigate(`${siteUrl}/`);
        await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(el=>/BACKOFFICE/i.test(el.textContent)); if(b) b.click(); return true; })()`);
        await wait(2500);

        for (const [key, labelText] of modules) {
          const opened = await cdp.evaluate(`(() => { const b=[...document.querySelectorAll('.admin-nav-item')].find(el=>el.textContent.trim()===${JSON.stringify(labelText)}); if(!b) return false; b.click(); return true; })()`);
          if (!opened) continue;
          await wait(1400);
          const state = await cdp.evaluate(`(() => {
            const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth;
            const offenders = [...document.querySelectorAll('main *')]
              .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2 && !el.closest('.table-scroll, .lead-pipeline'))
              .slice(0, 3).map((el) => (el.tagName + '.' + String(el.className || '')).slice(0, 60));
            return { overflow, offenders, blank: (document.querySelector('.admin-module-transition')?.innerText || '').trim().length < 15 };
          })()`);
          check(`backoffice/${label} · ${labelText} sin desbordamiento`, state.overflow <= 1, `sobresale ${state.overflow}px · ${state.offenders.join(" | ")}`);
          check(`backoffice/${label} · ${labelText} muestra contenido`, !state.blank);
          check(`backoffice/${label} · ${labelText} sin errores de consola`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" || "));
          consoleErrors.length = 0;
        }
        await shoot(`backoffice-inventario-${label}`);
      }
    }

    console.log(`\nCapturas guardadas en: ${outputDir}`);
  } finally {
    try { await cdp?.send("Browser.close"); } catch { /* ya cerrado */ }
    chrome.kill();
    await wait(500);
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error(`FAIL  Excepción — ${error.message}`);
} finally {
  console.log(`\nResultado navegador: ${passed} pasaron, ${failed} fallaron.`);
  process.exit(failed ? 1 : 0);
}

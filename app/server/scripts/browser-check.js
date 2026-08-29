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
const skip3d = args.includes("--skip-3d");
const siteOrigin = new URL(`${siteUrl}/`);
const configuredDemoTenant = process.env.BROWSER_TENANT;
const demoTenant = String(configuredDemoTenant !== undefined
  ? configuredDemoTenant
  : (siteOrigin.hostname === "localhost" || siteOrigin.hostname === "127.0.0.1" ? "dealer-demo" : "")).trim().toLowerCase();
const apiHeaders = demoTenant ? { "X-Authentiq-Tenant": demoTenant } : {};
const appUrl = (pathname = "/") => {
  const url = new URL(pathname, `${siteUrl}/`);
  if (demoTenant) url.searchParams.set("dealer", demoTenant);
  return url.toString();
};
const consoleWarnings = [];
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

async function waitFor(cdp, expression, { timeout = 12000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await cdp.evaluate(expression)) return true;
    } catch { /* la ruta todavía está montando */ }
    await wait(interval);
  }
  return false;
}

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
    // Las advertencias no rompen nada, pero avisan de cosas que conviene mirar:
    // texturas mal formadas, APIs en desuso, atributos que el navegador ignora.
    // No hacen fallar la comprobacion; se listan al final para poder decidir.
    const failedRequests = [];
    const requestUrls = new Map();
    cdp.on((method, params) => {
      if (method === "Runtime.consoleAPICalled" && (params.type === "warning" || params.type === "warn")) {
        const texto = params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ").slice(0, 220);
        if (texto && !consoleWarnings.includes(texto)) consoleWarnings.push(texto);
      }
      if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ").slice(0, 300));
      }
      if (method === "Runtime.exceptionThrown") {
        consoleErrors.push(`EXCEPCIÓN: ${params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || ""}`.slice(0, 300));
      }
      if (method === "Network.loadingFailed" && !params.canceled) {
        failedRequests.push(`${params.type} — ${params.errorText || "error desconocido"}${requestUrls.get(params.requestId) ? ` — ${requestUrls.get(params.requestId).slice(0, 140)}` : ""}`);
      }
      if (method === "Network.requestWillBeSent") requestUrls.set(params.requestId, params.request.url);
      if (method === "Network.responseReceived" && params.response.status >= 400) {
        // El showroom comprueba en segundo plano si existe una sesión de
        // comprador basada en cookie HttpOnly. Para un visitante anónimo, el
        // 401 de este endpoint privado es el resultado esperado, no un recurso
        // roto; los 4xx/5xx de cualquier otra ruta sí deben hacer fallar el test.
        const optionalCustomerBootstrap = params.response.status === 401
          && /\/api\/customer\/(me|favorites|activity)(?:\?|$)/.test(params.response.url);
        if (optionalCustomerBootstrap) return;
        failedRequests.push(`${params.response.status} ${params.response.url.slice(0, 140)}`);
      }
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    const navigate = async (url, readyExpression = "document.getElementById('root')?.innerText.trim().length > 100") => {
      consoleErrors.length = 0;
      failedRequests.length = 0;
      const loaded = new Promise((resolve) => {
        const listener = (method) => { if (method === "Page.loadEventFired") resolve(); };
        cdp.on(listener);
      });
      await cdp.send("Page.navigate", { url });
      await Promise.race([loaded, wait(15000)]);
      await waitFor(cdp, readyExpression);
    };

    // La portada de plataforma puede empezar en el landing y abrir el catálogo
    // bajo demanda. El test antiguo esperaba tarjetas directamente en "/" y
    // convertía ese flujo válido en un falso negativo.
    const navigateHomeWithCatalog = async () => {
      await navigate(appUrl("/"), "Boolean(document.querySelector('.studio-hero')) || document.querySelectorAll('.vehicle-card').length > 0");
      const landing = await cdp.evaluate("Boolean(document.querySelector('.studio-hero'))");
      if (landing) {
        await cdp.evaluate(`(() => {
          const button = [...document.querySelectorAll('button')].find((item) => /ver demo|explorar una demo/i.test(item.textContent || ''));
          button?.click();
        })()`);
        await waitFor(cdp, "document.querySelectorAll('.vehicle-card').length > 0");
      }
      return landing;
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
      const startedOnLanding = await navigateHomeWithCatalog();
      const metrics = await cdp.evaluate(`(() => {
        const doc = document.documentElement;
        const overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - window.innerWidth;
        const wide = [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 2)
          .slice(0, 4)
          .map((el) => (el.tagName + '.' + String(el.className || '')).slice(0, 70));
        const smallEls = [...document.querySelectorAll('button, a[href], select, input')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 28; });
        const small = smallEls.length;
        // Contar no basta: hay que poder localizar el control para arreglarlo.
        const smallList = smallEls.slice(0, 6).map((el) => {
          const r = el.getBoundingClientRect();
          const name = (el.tagName + (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : '')).slice(0, 60);
          const text = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24);
          return name + ' "' + text + '" ' + Math.round(r.width) + 'x' + Math.round(r.height);
        });
        return {
          overflow, wide, small, smallList,
          cards: document.querySelectorAll('.vehicle-card').length,
          landing: Boolean(document.querySelector('.studio-hero')),
          title: document.title,
          root: (document.getElementById('root')?.innerHTML || '').length,
        };
      })()`);
      await shoot(`catalogo-${viewport.name}`);
      check(`${viewport.name} · la página monta contenido real`, metrics.root > 2000, `${metrics.root} bytes en #root`);
      check(`${viewport.name} · sin desbordamiento horizontal`, metrics.overflow <= 1, `sobresale ${metrics.overflow}px · ${metrics.wide.join(" | ")}`);
      check(`${viewport.name} · landing o catálogo disponibles`, startedOnLanding || metrics.cards > 0, startedOnLanding ? "landing detectado; catálogo abierto para continuar" : `${metrics.cards} tarjetas`);
      check(`${viewport.name} · el catálogo pinta vehículos`, metrics.cards > 0, `${metrics.cards} tarjetas`);
      check(`${viewport.name} · sin errores de consola`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" || "));
      check(`${viewport.name} · sin peticiones fallidas`, failedRequests.length === 0, failedRequests.slice(0, 2).join(" || "));
      if (metrics.small > 0) console.log(`      nota: ${metrics.small} controles con menos de 28px de alto — ${(metrics.smallList || []).join(" | ")}`);
    }

    // ---- Transición catálogo → ficha --------------------------------------
    // La navegación va envuelta en document.startViewTransition. Si esa envoltura
    // se rompe con un error, la ficha podría no abrirse: aquí se comprueba que
    // la transición arranca Y que el comprador acaba en la ficha correcta.
    await setViewport(viewports[2]);
    // Chrome sin interfaz reporta prefers-reduced-motion: reduce, y la app respeta
    // esa preferencia saltándose la transición. Para probar el camino normal hay
    // que emular a un comprador que no la ha pedido.
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    await navigateHomeWithCatalog();
    await cdp.evaluate(`(() => {
      window.__vt = 0;
      const original = document.startViewTransition?.bind(document);
      if (original) document.startViewTransition = (cb) => { window.__vt += 1; return original(cb); };
    })()`);
    const clicked = await cdp.evaluate(`(() => {
      const button = document.querySelector('.vehicle-card-image-button');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    await wait(1400);
    const afterClick = await cdp.evaluate(`(() => ({ transitions: window.__vt || 0, reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches, hasApi: typeof document.startViewTransition === 'function', path: location.pathname, heading: document.querySelector('.vehicle-detail h1, .detail-heading h1')?.textContent || document.querySelector('h1')?.textContent || '' }))()`);
    check("Pulsar una tarjeta abre la ficha", clicked && afterClick.path.startsWith("/vehiculos/"), `ruta ${afterClick.path}`);
    check("La apertura usa transición de vista", afterClick.transitions > 0, `llamadas=${afterClick.transitions} api=${afterClick.hasApi} reducirMovimiento=${afterClick.reduced}`);
    check("La ficha abierta muestra el vehículo", Boolean(afterClick.heading.trim()), afterClick.heading);

    // Y con la preferencia de reducir movimiento activa NO debe animarse, pero la
    // ficha tiene que abrirse igual: la accesibilidad no puede romper la navegación.
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await navigateHomeWithCatalog();
    await wait(1200);
    await cdp.evaluate(`(() => { window.__vt = 0; const original = document.startViewTransition?.bind(document); if (original) document.startViewTransition = (cb) => { window.__vt += 1; return original(cb); }; })()`);
    await cdp.evaluate(`document.querySelector('.vehicle-card-image-button')?.click()`);
    await wait(1000);
    const reducedRun = await cdp.evaluate(`(() => ({ transitions: window.__vt || 0, path: location.pathname }))()`);
    check("Con movimiento reducido la ficha abre sin animar", reducedRun.path.startsWith("/vehiculos/") && reducedRun.transitions === 0, `ruta ${reducedRun.path}, llamadas ${reducedRun.transitions}`);
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });

    // ---- Ficha de vehículo con modelo 3D ---------------------------------
    // ---- Presentación guiada ----------------------------------------------
    console.log("\n== PRESENTACIÓN GUIADA ==");
    await setViewport(viewports[3]);
    await navigate(appUrl("/presentacion"), "Boolean(document.querySelector('.presentation-stage')) && document.querySelectorAll('.presentation-control, .presentation-vehicle').length > 1");
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
    const apiUrl = process.env.API_BASE_URL || (siteOrigin.hostname === "localhost" || siteOrigin.hostname === "127.0.0.1" ? `http://${siteOrigin.hostname}:3001` : siteUrl);
    const catalog = await (await fetch(`${apiUrl}/api/vehicles`, { headers: apiHeaders })).json();
    const target = catalog.data.find((item) => item.media?.some((media) => media.type === "model_3d")) || catalog.data[0];
    const slugify = (value) => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const slug = `${slugify(`${target.brand}-${target.model}${target.variant ? `-${target.variant}` : ""}`)}-${String(target.id).replace(/-/g, "").slice(0, 8)}`;

    await navigate(appUrl(`/vehiculos/${slug}`), "Boolean(document.querySelector('.detail-page'))");
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
    if (!skip3d) await wait(30000);
    const viewer = await cdp.evaluate(`(() => {
      const el = document.querySelector('model-viewer');
      return el ? { present: true, hotspots: el.querySelectorAll('[slot^="hotspot-"]').length, hotspotToggle: Boolean(document.querySelector('.vehicle-3d-hotspot-toggle')), loaded: Boolean(el.loaded), src: el.getAttribute('src') || '', status: document.querySelector('.vehicle-3d-status')?.textContent || '', fallback: Boolean(document.querySelector('.vehicle-3d-fallback')) } : { present: false };
    })()`);
    if (viewer.present && !skip3d) {
      check("El modelo 3D real carga en el navegador", viewer.loaded === true, `estado en pantalla: "${viewer.status}"`);
      // Los puntos de interés se calculan desde la caja del modelo al terminar la
      // carga: si esa derivación se rompe, el 3D sigue cargando y nada más falla.
      if (viewer.loaded) {
        check("El modelo 3D muestra puntos de interés", viewer.hotspots > 0, `encontrados ${viewer.hotspots}`);
        check("Los puntos de interés se pueden ocultar", viewer.hotspotToggle === true);
        // El interruptor debe hacer algo de verdad, no solo existir.
        await cdp.evaluate(`document.querySelector('.vehicle-3d-hotspot-toggle')?.click()`);
        // React actualiza en el siguiente ciclo: medir en el mismo tick leería el DOM anterior.
        await wait(400);
        const toggled = await cdp.evaluate(`(() => ({ after: document.querySelectorAll('[slot^="hotspot-"]').length, label: (document.querySelector('.vehicle-3d-hotspot-toggle')?.textContent || '').trim() }))()`);
        check("Ocultar detalles retira los puntos del modelo", toggled.after === 0, `quedaron ${toggled.after}, botón dice "${toggled.label}"`);
        await cdp.evaluate(`document.querySelector('.vehicle-3d-hotspot-toggle')?.click()`);
      }
      check("El visor no cayó al estado de error", viewer.fallback === false);
    } else if (!viewer.present) {
      console.log("      (este vehículo no tiene modelo 3D)");
    } else {
      console.log("      (carga 3D omitida en esta pasada rápida)");
    }
    await shoot("ficha-desktop-1440x900");

    await setViewport(viewports[0]);
    await navigate(appUrl(`/vehiculos/${slug}`), "Boolean(document.querySelector('.detail-page'))");
    const mobileDetail = await cdp.evaluate("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth");
    check("Ficha en móvil sin desbordamiento horizontal", mobileDetail <= 1, `sobresale ${mobileDetail}px`);
    await shoot("ficha-movil-390x844");

    // La agenda pública es una acción comercial crítica: verificar que el
    // comprador puede descubrir el selector visual sin enviar una solicitud.
    await setViewport(viewports[0]);
    await navigate(appUrl(`/vehiculos/${slug}`), "Boolean(document.querySelector('.detail-page'))");
    const openedAppointment = await cdp.evaluate(`(() => { const button = document.querySelector('.test-drive-link'); if (!button) return false; button.click(); return true; })()`);
    await waitFor(cdp, "Boolean(document.querySelector('.test-drive-modal'))", { timeout: 5000 });
    const appointmentUi = await cdp.evaluate(`(() => ({
      modal: Boolean(document.querySelector('.test-drive-modal')),
      steps: document.querySelectorAll('.appointment-flow-steps span').length,
      dates: document.querySelectorAll('.appointment-date-strip button').length,
      times: Boolean(document.querySelector('.appointment-time-grid')),
      mobileOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    }))()`);
    check("La ficha ofrece agendar una visita", openedAppointment && appointmentUi.modal);
    check("La agenda pública explica sus pasos", appointmentUi.steps === 3, `pasos=${appointmentUi.steps}`);
    check("La agenda pública muestra días seleccionables", appointmentUi.dates >= 7, `días=${appointmentUi.dates}`);
    check("La agenda pública no se desborda en móvil", appointmentUi.mobileOverflow <= 1, `sobresale ${appointmentUi.mobileOverflow}px`);
    check("La agenda pública no registra nada al abrirse", consoleErrors.length === 0 && failedRequests.length === 0, consoleErrors.slice(0, 2).join(" || ") || failedRequests.slice(0, 2).join(" || "));
    await cdp.evaluate("document.querySelector('.test-drive-modal .modal-close')?.click()");

    // ---- Backoffice -------------------------------------------------------
    console.log("\n== BACKOFFICE (login) ==");
    await setViewport(viewports[2]);
    await navigateHomeWithCatalog();
    const backoffice = await cdp.evaluate(`(() => {
      const button = document.querySelector('.nav-backoffice-link') || [...document.querySelectorAll('button')].find((el) => /BACKOFFICE|PANEL\s+DE\s+CONTROL/i.test(el.textContent));
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

    // La ruta oficial debe funcionar aunque el usuario la guarde, la abra desde
    // un correo o la escriba directamente: no puede depender de un botón del
    // catálogo ni de parámetros de desarrollo.
    console.log("\n== BACKOFFICE (ruta directa) ==");
    await setViewport(viewports[0]);
    await navigate(`${siteUrl}/backoffice`, "Boolean(document.querySelector('.admin-login'))");
    const directBackoffice = await cdp.evaluate(`(() => ({
      login: Boolean(document.querySelector('.admin-login')),
      title: document.title,
      robots: document.querySelector('meta[name=robots]')?.content || '',
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    }))()`);
    check("/backoffice abre el acceso directo", directBackoffice.login);
      check("/backoffice no se indexa", /noindex/i.test(directBackoffice.robots), directBackoffice.robots);
      check("/backoffice móvil sin desbordamiento", directBackoffice.overflow <= 1, `sobresale ${directBackoffice.overflow}px`);
      check("/backoffice sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));

    // Los enlaces de recuperación se abren normalmente desde Gmail o WhatsApp
    // en un navegador móvil nuevo: deben entregar la pantalla de cambio de
    // contraseña aunque el token de prueba no se vaya a enviar.
    console.log("\n== RECUPERACIÓN (ruta directa) ==");
    await navigate(`${siteUrl}/backoffice/restablecer-contrasena?token=browser-check-token`, "Boolean(document.querySelector('.admin-login'))");
    const recoveryRoute = await cdp.evaluate(`(() => ({
      form: Boolean(document.querySelector('.admin-login')),
      heading: document.body.innerText.includes('nueva contraseña'),
      robots: document.querySelector('meta[name=robots]')?.content || '',
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    }))()`);
    check("La recuperación abre directamente", recoveryRoute.form && recoveryRoute.heading);
    check("La recuperación no se indexa", /noindex/i.test(recoveryRoute.robots), recoveryRoute.robots);
    check("Recuperación móvil sin desbordamiento", recoveryRoute.overflow <= 1, `sobresale ${recoveryRoute.overflow}px`);
    check("Recuperación sin errores de consola", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));

    // ---- Backoffice autenticado, módulo por módulo, en móvil y escritorio -----
    const localTarget = ["localhost", "127.0.0.1"].includes(siteOrigin.hostname);
    const adminEmail = process.env.E2E_EMAIL || process.env.SMOKE_EMAIL || (localTarget ? (demoTenant === "dealer-demo" ? "demo@dealer.local" : "admin@authentiq.local") : "");
    const adminPassword = process.env.E2E_PASSWORD || process.env.SMOKE_PASSWORD || (localTarget ? "12345678" : "");
    const session = adminEmail && adminPassword
      ? await fetch(`${apiUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) })
      : null;
    if (!session?.ok) {
      console.log("      (sin credenciales válidas: se omite la auditoría del backoffice autenticado)");
    } else {
      const { token, user } = await session.json();
      console.log(`      sesión de verificación: ${user.role}`);
      // La aplicación ya no lee tokens administrativos desde localStorage.
      // Reutilizamos el handoff temporal que usa el centro de plataforma y que
      // App.jsx elimina de la barra de direcciones al arrancar.
      const authenticatedAppUrl = (pathname = "/") => {
        const url = new URL(appUrl(pathname));
        url.searchParams.set("impersonate", JSON.stringify({ token, user }));
        return url.toString();
      };
      const commonOperations = [["dashboard", "Inicio"], ["inventory", "Mi inventario"], ["taxonomy", "Marcas y categorías"], ["leads", "Clientes"], ["appointments", "Citas"], ["quotes", "Cotizaciones"], ["blog", "Contenido"], ["offers", "Ofertas"], ["reports", "Estadísticas"]];
      const modules = user.role === "editor" ? [...commonOperations, ["settings", "Perfil y ajustes"]] : user.role === "admin" ? [...commonOperations, ["audit", "Actividad"], ["users", "Usuarios"], ["subscription", "Plan y facturación"], ["integrations", "Conexiones"], ["settings", "Perfil y ajustes"]] : commonOperations;
      const moduleReadyText = { dashboard: "Prioridad", inventory: "inventario", taxonomy: "Marcas y categorías", leads: "Clientes", appointments: "Citas", quotes: "Cotizaciones", blog: "Contenido", offers: "Ofertas", reports: "Estadísticas", audit: "Actividad", users: "Usuarios", subscription: "Tu plan, claro desde el primer día.", integrations: "Agenda", settings: "Tu showroom, a tu manera" };
      for (const [width, height, label, mobile] of [[390, 844, "movil", true], [1280, 800, "escritorio", false]]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
        await navigate(authenticatedAppUrl("/"), "document.querySelectorAll('.vehicle-card').length > 0");
        await cdp.evaluate(`(() => { const b=document.querySelector('.nav-backoffice-link') || [...document.querySelectorAll('button')].find(el=>/BACKOFFICE|PANEL\s+DE\s+CONTROL/i.test(el.textContent)); if(b) b.click(); return true; })()`);
        await wait(2500);

        for (const [key, labelText] of modules) {
          let opened = await cdp.evaluate(`(() => {
            const b=[...document.querySelectorAll('.admin-nav-item')].find(el=>el.textContent.trim()===${JSON.stringify(labelText)});
            if (!b) return false;
            b.click();
            return true;
          })()`);
          if (!opened) {
            await cdp.evaluate("document.querySelector('.admin-nav-more-toggle')?.click()");
            await wait(160);
            opened = await cdp.evaluate(`(() => {
              const b=[...document.querySelectorAll('.admin-nav-item')].find(el=>el.textContent.trim()===${JSON.stringify(labelText)});
              if (!b) return false;
              b.click();
              return true;
            })()`);
          }
          check(`backoffice/${label} · ${labelText} abre el módulo`, opened);
          if (!opened) continue;
          await waitFor(cdp, `(() => { const text = document.querySelector('.admin-module-transition')?.innerText || ''; return text.includes(${JSON.stringify(moduleReadyText[key] || labelText)}); })()`, { timeout: 3000 });
          await wait(220);
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
          // El estudio de flyers estuvo inalcanzable durante meses porque el único
          // módulo que lo renderizaba quedó sin usar y nadie lo notó: compilaba
          // igual. Esta comprobación impide que vuelva a desaparecer en silencio.
          if (key === "integrations") {
            const flyer = await cdp.evaluate(`(() => {
              const studio = document.querySelector('.social-flyer-studio');
              if (!studio) return { present: false };
              const canvas = studio.querySelector('canvas');
              return { present: true, formats: studio.querySelectorAll('.flyer-format-btn').length, canvas: Boolean(canvas), painted: canvas ? canvas.width > 0 && canvas.height > 0 : false };
            })()`);
            check(`backoffice/${label} · el estudio de flyers está accesible`, flyer.present === true);
            if (flyer.present) {
              check(`backoffice/${label} · el flyer se dibuja`, flyer.canvas && flyer.painted, `canvas=${flyer.canvas} pintado=${flyer.painted}`);
              check(`backoffice/${label} · ofrece los formatos de red social`, flyer.formats >= 3, `encontrados ${flyer.formats}`);
            }
          }
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
  if (consoleWarnings.length) {
    console.log(`
Advertencias de consola (no hacen fallar): ${consoleWarnings.length}`);
    for (const aviso of consoleWarnings.slice(0, 8)) console.log(`  · ${aviso}`);
  }
  console.log(`\nResultado navegador: ${passed} pasaron, ${failed} fallaron.`);
  process.exit(failed ? 1 : 0);
}

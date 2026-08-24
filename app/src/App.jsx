import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import { TurnstileField, turnstileSiteKey } from "./utils/turnstile.jsx";
import { flushSync } from "react-dom";
import { contrastSafeShade } from "./utils/color.js";
import { reportError } from "./utils/monitoring.js";
import { AnimatedNumber, BlurFade, Disclosure, ProgressiveBlur, TextReveal } from "./ui/MotionPrimitives.jsx";
import { AnimatedThemeTogglerStarDemo } from "./components/ui/animated-theme-toggler-star-demo.jsx";

class SectionBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error(`[AUTHENTIQ] Fallo en la sección "${this.props.name || "desconocida"}"`, error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;
    return <section className="section-fallback" role="status"><span className="eyebrow">{getBrandName()}</span><p>{this.props.message || "Esta sección no pudo mostrarse. El resto de la página sigue disponible."}</p></section>;
  }
}

const Backoffice = lazy(() => import("./admin/Backoffice.jsx"));

// Conserva el subdominio local del dealer (p. ej. dealer-demo.localhost). Así la
// API puede resolver la organización por host también durante una demostración.
const localApiOrigin = `${window.location.protocol}//${window.location.hostname}:3001`;
const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? localApiOrigin : window.location.origin);
const requestedDealerSlug = new URLSearchParams(window.location.search).get("dealer")?.trim().toLowerCase() || "";
const localDemoTenant = import.meta.env.DEV ? requestedDealerSlug : "";
// Vista previa privada: un dealer logueado puede abrir "/?preview=1" (mismo origen,
// misma sesión) y ver su propio showroom aunque todavía no tenga dominio propio o
// esté pendiente de aprobación. El servidor resuelve la organización por el JWT, no
// por nada que mande el cliente aquí, así que esto nunca expone a otro dealer.
const isPreviewMode = new URLSearchParams(window.location.search).get("preview") === "1";
// Modo soporte: el admin de plataforma abre "/?impersonate=<token+user>" desde
// PlatformCenter en una pestaña nueva. Se guarda solo en memoria (nunca en
// localStorage) para no pisar la sesión del admin de plataforma en otra pestaña.
const impersonatePayload = (() => {
  try {
    const raw = new URLSearchParams(window.location.search).get("impersonate");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
})();
if (impersonatePayload) window.history.replaceState({}, "", window.location.pathname);
const nativeFetch = window.fetch.bind(window);
function fetch(input, options = {}) {
  const headers = new Headers(options.headers || {});
  let target = input;
  let mutated = false;
  if (/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(localDemoTenant || "")) { headers.set("X-Authentiq-Tenant", localDemoTenant); mutated = true; }
  if (isPreviewMode && !headers.has("Authorization")) {
    const previewToken = localStorage.getItem("authentiq_admin_token") || "";
    if (previewToken) { headers.set("X-Preview-Mode", "1"); headers.set("Authorization", `Bearer ${previewToken}`); mutated = true; }
  }
  if (/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(requestedDealerSlug) && typeof input === "string") {
    try {
      const url = new URL(input, window.location.href);
      if (url.pathname.startsWith("/api/") && !url.searchParams.has("dealer")) { url.searchParams.set("dealer", requestedDealerSlug); target = url.href; }
    } catch { /* El navegador resolverá el destino original si no es una URL válida. */ }
  }
  return mutated || target !== input ? nativeFetch(target, { ...options, headers }) : nativeFetch(input, options);
}

// `activo` permite usarlo en diálogos que viven montados y solo se muestran al
// abrirse (galería ampliada, importador, editor de fotos). Sin él, el foco
// quedaría atrapado en un diálogo invisible.
function useAccessibleDialog(onClose, activo = true) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!activo) return undefined;
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
    const dialog = dialogRef.current || dialogs[dialogs.length - 1];
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const focusables = () => [...dialog.querySelectorAll(selector)];
    const firstField = dialog.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || dialog.querySelector(selector);
    window.requestAnimationFrame(() => firstField?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current?.(); return; }
      if (event.key !== "Tab") return;
      const current = focusables();
      if (!current.length) return;
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [activo]);
  return dialogRef;
}

function publicMediaUrl(url) {
  if (!url) return url;
  if (String(url).startsWith("/uploads/")) return `${apiUrl}${url}`;
  // Los datos locales heredados guardaban el host de desarrollo. En una URL
  // pública el navegador del cliente no debe intentar cargar archivos desde
  // su propio localhost: se resuelven contra la API configurada.
  return String(url).replace(/^https?:\/\/(?:localhost|127\.0\.0\.1):3001(?=\/uploads\/)/i, apiUrl);
}

const analyticsSessionId = (() => { const key = "authentiq_analytics_session"; const current = localStorage.getItem(key); if (current) return current; const next = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(key, next); return next; })();
function publicRequestKey(prefix) { return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
function trackEvent(eventName, payload = {}) { if (localStorage.getItem("authentiq_cookie_consent") !== "accepted") return; const query = new URLSearchParams(window.location.search); const source = payload.source || query.get("utm_source") || query.get("source") || "direct"; fetch(`${apiUrl}/api/events`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventName, path: window.location.pathname, source, sessionId: analyticsSessionId, metadata: { utmMedium: query.get("utm_medium") || "", utmCampaign: query.get("utm_campaign") || "", utmContent: query.get("utm_content") || "" }, ...payload }) }).catch(() => {}); }

function formatPrice(value) {
  return `$${Number(value).toLocaleString("en-US")} USD`;
}

function formatFinancePrice(value) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

let publicBrandName = "AUTHENTIQ";
function getBrandName() { return publicBrandName; }

function ensurePreload(url, as = "fetch") {
  if (!url || String(url).startsWith("procedural://")) return;
  let absoluteUrl;
  try { absoluteUrl = new URL(url, window.location.href).href; } catch { return; }
  const existing = [...document.head.querySelectorAll("link[data-authentiq-preload]")].find((link) => link.href === absoluteUrl && link.as === as);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = as;
  link.href = absoluteUrl;
  link.dataset.authentiqPreload = as;
  if (as === "fetch") link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

function Reveal({ children, className = "" }) {
  return <BlurFade className={className}>{children}</BlurFade>;
}

function AnimatedMetric({ value, suffix = "", duration = 1100 }) {
  const ref = useRef(null);
  const visible = useInView(ref, { once: true, amount: 0.8 });
  const reduceMotion = useReducedMotion();
  const target = Number(value) || 0;
  const [current, setCurrent] = useState(reduceMotion ? target : 0);
  useEffect(() => {
    if (!visible || reduceMotion) { setCurrent(target); return undefined; }
    let frame;
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, reduceMotion, target, visible]);
  return <span ref={ref} className="animated-metric" aria-label={`${target}${suffix}`}>{current.toLocaleString("en-US")}{suffix}</span>;
}

function slugify(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function setMeta(selector, attribute, content) {
  let tag = document.querySelector(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(selector.startsWith("meta[name") ? "name" : "property", attribute);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function setCanonical(href) {
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
  canonical.href = href;
}

function setRobots(shouldIndex) {
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) { robots = document.createElement("meta"); robots.setAttribute("name", "robots"); document.head.appendChild(robots); }
  robots.setAttribute("content", shouldIndex ? "index, follow" : "noindex, nofollow");
}

// El slug incluye un sufijo del id: dos vehículos con la misma marca y modelo
// (p. ej. dos "Porsche 911") deben tener URLs distintas y alcanzables.
function vehicleSlug(vehicle) {
  const base = slugify(`${vehicle.brand}-${vehicle.model}${vehicle.variant ? `-${vehicle.variant}` : ""}`);
  const suffix = String(vehicle.id || "").replace(/-/g, "").slice(0, 8);
  return suffix ? `${base}-${suffix}` : base;
}

function vehiclePath(vehicle) {
  return `/vehiculos/${vehicleSlug(vehicle)}`;
}

function findVehicleByPath(vehicles, pathname) {
  if (!pathname.startsWith("/vehiculos/")) return null;
  const slug = pathname.slice("/vehiculos/".length).replace(/\/+$/, "");
  if (!slug) return null;
  return vehicles.find((vehicle) => vehicleSlug(vehicle) === slug)
    // Compatibilidad con enlaces antiguos sin sufijo de id.
    || vehicles.find((vehicle) => slugify(`${vehicle.brand}-${vehicle.model}`) === slug)
    || null;
}

function ShareAction({ vehicle }) {
  const [shared, setShared] = useState(false);
  const share = async (event) => {
    event.stopPropagation();
    const url = `${window.location.origin}${vehiclePath(vehicle)}`;
    try {
      if (navigator.share) await navigator.share({ title: `${vehicle.brand} ${vehicle.model}`, text: `Mira este ${vehicle.brand} ${vehicle.model} en ${getBrandName()}`, url });
      else await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
      trackEvent("vehicle_share", { vehicleId: vehicle.id });
    } catch { setShared(false); }
  };
  return <button className="detail-utility-action" type="button" onClick={share}>{shared ? "Enlace copiado ✓" : "Compartir vehículo ↗"}</button>;
}

function localIsoDate(value = new Date()) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
async function shareOrCopyUrl(url, title) {
  if (navigator.share) { await navigator.share({ title, url }); return "shared"; }
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); return "copied"; }
  return "unavailable";
}

function Breadcrumbs({ vehicle }) {
  return <nav className="breadcrumbs" aria-label="Ruta de navegación"><a href="#catalog">Inventario</a><span aria-hidden="true">/</span><a href="#catalog">{vehicle.brand}</a><span aria-hidden="true">/</span><span aria-current="page">{vehicle.model}</span></nav>;
}

function NotFoundPage({ onBack }) {
  return <main className="article-page not-found-page"><span className="eyebrow">{getBrandName()} · 404</span><h1>Esta ruta no lleva a ningún vehículo.</h1><p>Puede que el enlace haya cambiado o que la página ya no esté disponible. Regresa al catálogo para continuar explorando.</p><button className="primary-action" type="button" onClick={onBack}>Volver al catálogo →</button></main>;
}

function TenantNotFoundPage() {
  return <main className="article-page not-found-page"><span className="eyebrow">AUTHENTIQ · SHOWROOM</span><h1>Este showroom no existe.</h1><p>El enlace del dealer no es válido o el showroom todavía no está disponible. Revisa la dirección o vuelve al inicio.</p><a className="primary-action" href="/">Volver al inicio →</a></main>;
}

function LandingPage({ onCreateShowroom, onDealerLogin, onViewDemo, onOpenPrivacy, onOpenTerms }) {
  const reduceMotion = useReducedMotion();
  // Un archivo local evita depender de hotlinks de terceros. Un dealer puede
  // sustituirlo por su propio reel mediante VITE_HERO_VIDEO_URL.
  const landingVideoUrl = String(import.meta.env.VITE_HERO_VIDEO_URL || "/assets/authentiq-cinematic-drive.mp4").trim();
  const landingVideoRef = useRef(null);
  const showcaseRef = useRef(null);
  const showcaseMediaVisible = useInView(showcaseRef, { once: true, amount: 0.12 });
  const [landingVideoPlaying, setLandingVideoPlaying] = useState(Boolean(landingVideoUrl) && !reduceMotion);
  const [landingVideoProgress, setLandingVideoProgress] = useState(12);
  const pillars = [
    { title: "Tu marca, tu showroom", body: "Logo, colores y dominio propio. Cada dealer se ve como su propio negocio, no como una plantilla compartida." },
    { title: "Inventario y clientes en un solo lugar", body: "Publica vehículos, recibe ofertas, agenda citas y da seguimiento a cada cliente desde un panel hecho para vender." },
    { title: "Revisión antes de publicar", body: "Personaliza todo desde el primer minuto en una vista previa privada. Tu showroom sale al aire cuando el equipo lo aprueba." },
  ];
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Navegación de AUTHENTIQ">
        <a href="#landing-top" className="landing-brand">AUTHENTIQ<span>°</span></a>
        <div className="landing-nav-links"><a href="#landing-story">Cómo vende</a><a href="#landing-product">Experiencia cliente</a><a href="#landing-demo">Ver demo</a></div>
        <div className="landing-nav-actions"><button type="button" className="landing-nav-login" onClick={onDealerLogin}>Iniciar sesión</button><button type="button" className="landing-nav-cta" onClick={onCreateShowroom}>Crear mi showroom <span>↗</span></button></div>
      </nav>
      <section className="landing-hero" id="landing-top">
        <motion.div className="landing-hero-copy" initial={reduceMotion ? false : { opacity: 0, y: 24 }} animate={reduceMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: .7, ease: [0.22, 1, 0.36, 1] }}>
          <span className="eyebrow">LA VITRINA DIGITAL PARA CONCESIONARIOS</span>
          <h1>Tu inventario.<br /><em>Una experiencia</em><br />que se mueve.</h1>
          <p>Presenta cada vehículo con la claridad de una buena visita al lote y la fuerza de una marca que el cliente recuerda.</p>
          <div className="landing-actions"><button className="primary-action vui-shine-action" type="button" onClick={onCreateShowroom}>Crear mi showroom <span>↗</span></button><button className="landing-quiet-action" type="button" onClick={onViewDemo}>Explorar una demo real <span>↓</span></button></div>
          <div className="landing-hero-proof"><span><b>01</b> Marca blanca</span><span><b>02</b> Inventario vivo</span><span><b>03</b> Leads y citas</span></div>
        </motion.div>
        <motion.div className="landing-hero-visual" initial={reduceMotion ? false : { opacity: 0, scale: .96 }} animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }} transition={{ duration: .9, delay: .12, ease: [0.22, 1, 0.36, 1] }}>
          <div className="landing-visual-status"><span><i /> SHOWROOM EN VIVO</span><span>AUTHENTIQ / 2026</span></div>
          <div className="landing-visual-media">{landingVideoUrl ? <video ref={landingVideoRef} autoPlay={!reduceMotion} muted loop playsInline preload="metadata" poster="/assets/authentiq-cinematic-drive-poster.jpg" aria-label="Vehículo en movimiento dentro de un showroom digital" onPlay={() => setLandingVideoPlaying(true)} onPause={() => setLandingVideoPlaying(false)} onTimeUpdate={(event) => { const duration = event.currentTarget.duration || 0; setLandingVideoProgress(duration ? (event.currentTarget.currentTime / duration) * 100 : 12); }}><source src={landingVideoUrl} /></video> : <img src="/assets/authentiq-hero-v1.webp" alt="Vehículo premium presentado en el showroom digital de AUTHENTIQ" />}<div className="landing-visual-wash" /></div>
          <div className="landing-visual-caption"><span className="eyebrow">EXPERIENCIA 360°</span><strong>Lo que vendes<br /><em>se siente.</em></strong><small>Fotos · video · 3D · ficha · cita</small></div>
          <div className="landing-visual-card"><span>MODELO DESTACADO</span><strong>Porsche<br />Taycan Turbo S</strong><small>Ver ficha <b>↗</b></small></div>
          <div className="landing-visual-ring" aria-hidden="true" />
          <div className="landing-reel-controls">
            <button type="button" aria-label={landingVideoUrl ? (landingVideoPlaying ? "Pausar video" : "Reproducir video") : "Abrir demo"} onClick={async () => { if (!landingVideoUrl) { onViewDemo(); return; } if (landingVideoRef.current?.paused) await landingVideoRef.current.play(); else landingVideoRef.current?.pause(); }}>{landingVideoUrl && landingVideoPlaying ? "Ⅱ" : "▶"}</button>
            <div className="landing-reel-progress" aria-hidden="true"><span style={{ width: `${landingVideoProgress}%` }} /></div>
            <span>{landingVideoUrl ? "SHOWROOM / REEL 01" : "SHOWROOM / PREVIEW"}</span>
          </div>
        </motion.div>
      </section>
      <div className="landing-scroll-strip"><span>NO TE LO CONTAMOS</span><b>TE LO ENSEÑAMOS</b><span>SCROLL PARA EXPLORAR ↓</span></div>
      <LandingMotionReel reduceMotion={reduceMotion} landingVideoUrl={landingVideoUrl} />
      <LandingStory reduceMotion={reduceMotion} onViewDemo={onViewDemo} />
      <section className="landing-showcase" id="landing-product" aria-label="Demostración de AUTHENTIQ" ref={showcaseRef}>
        <div className="landing-showcase-copy">
          <span className="eyebrow">DE LA PROMESA A LA EXPERIENCIA</span>
          <h2>No tienes que explicar la plataforma. Puedes enseñarla.</h2>
          <p>Abre un showroom de ejemplo y recorre lo que verá cada cliente: inventario, fichas de vehículo, comparación, citas, ofertas y una experiencia 3D preparada para cada modelo.</p>
          <div className="landing-showcase-actions">
            <button className="primary-action vui-shine-action" type="button" onClick={onViewDemo}>Abrir showroom de ejemplo ↗</button>
            <a className="landing-presentation-link" href="/presentacion">Iniciar presentación guiada <span>→</span></a>
            <span className="landing-showcase-note"><b>01</b> Demo guiada · 02 Inventario · 03 Conversión</span>
          </div>
        </div>
        <motion.div className="landing-showcase-frame" initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }} viewport={{ once: true, amount: .28 }} transition={{ duration: .75, ease: [0.22, 1, 0.36, 1] }}>
          <div className="landing-showcase-topbar"><span><i /> SHOWROOM DEMO · ONLINE</span><span>AUTHENTIQ / 01</span></div>
          <div className="landing-showcase-visual">
            {landingVideoUrl ? <video autoPlay={!reduceMotion && showcaseMediaVisible} muted loop playsInline preload="none" poster="/assets/authentiq-cinematic-drive-poster.jpg" aria-label="Presentación de un showroom de vehículos">{showcaseMediaVisible && <source src={landingVideoUrl} />}</video> : <img src="/assets/authentiq-hero-v1.webp" alt="Vehículo premium dentro de un showroom digital" />}
            <div className="landing-showcase-glow" />
            <div className="landing-showcase-model"><span className="eyebrow">EXPERIENCIA 3D</span><strong>Gira. Compara.<br />Decide.</strong><small>Modelo interactivo · ficha · cita</small></div>
            <div className="landing-showcase-cursor" aria-hidden="true">↗</div>
          </div>
          <div className="landing-showcase-footer"><span><b>03</b> modelos activos</span><span><b>360°</b> experiencia visual</span><span><b>1:1</b> atención privada</span></div>
        </motion.div>
      </section>
      <section className="landing-pillars">
        {pillars.map((pillar) => <article key={pillar.title}><h2>{pillar.title}</h2><p>{pillar.body}</p></article>)}
      </section>
      <section className="landing-flow" id="landing-flow" aria-label="Flujo de trabajo para dealers">
        <div className="landing-flow-heading"><span className="eyebrow">UN CENTRO PARA CADA DEALER</span><h2>Todo lo que pasa entre publicar y vender.</h2></div>
        <div className="landing-flow-list">
          {[{ n: "01", title: "Tu marca", body: "Logo, colores, dominio y showroom propio desde el primer acceso." }, { n: "02", title: "Tu inventario", body: "Fotos, videos, ficha técnica y modelos interactivos en una sola vista." }, { n: "03", title: "Tus clientes", body: "Leads, ofertas, citas y seguimiento sin perder conversaciones." }].map((item) => <motion.article key={item.n} whileHover={reduceMotion ? undefined : { y: -6 }} transition={{ duration: .22 }}><span>{item.n}</span><h3>{item.title}</h3><p>{item.body}</p><i>↗</i></motion.article>)}
        </div>
      </section>
      <section className="landing-cta" id="landing-demo">
        <h2>¿Tienes un lote de vehículos y quieres venderlos online?</h2>
        <p>Empieza en una vista privada: personaliza tu marca, carga el inventario y comparte tu showroom cuando estés listo.</p>
        <button className="primary-action vui-shine-action" type="button" onClick={onCreateShowroom}>Crear mi showroom →</button>
      </section>
      <footer className="landing-footer">
        <div><span className="brand-mark">AUTHENTIQ<span>°</span></span><p>Showrooms digitales para dealers que quieren vender mejor.</p></div>
        <nav aria-label="Enlaces legales"><button type="button" onClick={onOpenPrivacy}>Privacidad</button><button type="button" onClick={onOpenTerms}>Términos</button><button type="button" onClick={onCreateShowroom}>Solicitar demo</button></nav>
        <small>© {new Date().getFullYear()} AUTHENTIQ · Plataforma para dealers</small>
      </footer>
    </main>
  );
}

function LandingMotionReel({ reduceMotion, landingVideoUrl }) {
  const reelRef = useRef(null);
  const reelMediaVisible = useInView(reelRef, { once: true, amount: 0.12 });
  const { scrollYProgress } = useScroll({ target: reelRef, offset: ["start end", "end start"] });
  const roadY = useTransform(scrollYProgress, [0, 1], reduceMotion ? ["0%", "0%"] : ["-9%", "9%"]);
  const carY = useTransform(scrollYProgress, [0, 1], reduceMotion ? ["0%", "0%"] : ["13%", "-13%"]);
  const carX = useTransform(scrollYProgress, [0, 1], reduceMotion ? ["0%", "0%"] : ["-4%", "5%"]);
  const copyY = useTransform(scrollYProgress, [0, 1], reduceMotion ? ["0%", "0%"] : ["8%", "-8%"]);
  const lineScale = useTransform(scrollYProgress, [0, 1], [0.25, 1]);

  return <section className="landing-motion-reel" ref={reelRef} aria-label="Experiencia visual de AUTHENTIQ">
    <div className="landing-motion-reel-sticky">
      <motion.div className="landing-motion-road" style={{ y: roadY }} aria-hidden="true">
        {landingVideoUrl ? <video autoPlay={!reduceMotion && reelMediaVisible} muted loop playsInline preload="none" poster="/assets/authentiq-cinematic-drive-poster.jpg">{reelMediaVisible && <source src={landingVideoUrl} />}</video> : <img src="/assets/hero-highway.webp" alt="" />}
      </motion.div>
      <div className="landing-motion-shade" aria-hidden="true" />
      <motion.img className="landing-motion-car" style={{ x: carX, y: carY }} src="/assets/porsche-911-three-quarter.jpg" alt="Porsche presentado en un showroom de vehículos" />
      <motion.div className="landing-motion-copy" style={{ y: copyY }}>
        <span>UNA VITRINA QUE AVANZA CONTIGO</span>
        <h2>Haz que cada vehículo tenga presencia antes de que el cliente llegue.</h2>
        <p>Un recorrido con fotos, video, detalles y una próxima acción clara. El movimiento acompaña la historia; la venta sigue siendo fácil de entender.</p>
        <motion.div className="landing-motion-line" style={{ scaleX: lineScale }} aria-hidden="true" />
      </motion.div>
      <div className="landing-motion-legend" aria-hidden="true"><span>01 / DESCUBRE</span><span>02 / EXPLORA</span><span>03 / CONTACTA</span></div>
    </div>
  </section>;
}

function LandingStory({ reduceMotion, onViewDemo }) {
  const [activeStep, setActiveStep] = useState(0);
  const steps = [
    { label: "Publica", title: "Tu inventario, listo para vender.", body: "Carga fotos, ficha técnica, precio y disponibilidad. Cada vehículo sale con una experiencia propia." },
    { label: "Conecta", title: "Cada interés llega al equipo correcto.", body: "Cuando un cliente pregunta, el concesionario ve qué quiere, quién lo atiende y cuál es la próxima acción." },
    { label: "Convierte", title: "De la conversación a la cita.", body: "Agenda una visita, prepara una cotización y mantén el seguimiento hasta que la venta se cierre." },
  ];
  const stage = [
    { status: "INVENTARIO ACTIVO", title: "Porsche Taycan Turbo S", detail: "Publicado · 14 visitas hoy", metric: "12", metricLabel: "vehículos publicados", icon: "▣" },
    { status: "NUEVO LEAD", title: "María Rodríguez", detail: "Interesada en Taycan · hace 4 min", metric: "3", metricLabel: "clientes para contactar", icon: "◉" },
    { status: "PRÓXIMA ACCIÓN", title: "Cita confirmada", detail: "Hoy · 3:30 PM · Sala principal", metric: "86%", metricLabel: "avance del seguimiento", icon: "✓" },
  ][activeStep];
  return <section className="landing-story" id="landing-story" aria-label="Cómo funciona AUTHENTIQ">
    <div className="landing-story-heading"><div><span className="eyebrow">DEL ANUNCIO AL CIERRE</span><h2>Una operación que se entiende mientras avanzas.</h2></div><p>AUTHENTIQ conecta lo que el cliente ve con lo que tu equipo debe hacer después.</p></div>
    <div className="landing-story-grid">
      <div className="landing-story-steps" role="tablist" aria-label="Etapas de venta">
        {steps.map((step, index) => <motion.article key={step.label} className={`landing-story-step${activeStep === index ? " is-active" : ""}`} onViewportEnter={() => setActiveStep(index)} viewport={{ amount: .65 }} initial={reduceMotion ? false : { opacity: .65, y: 18 }} whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }} transition={{ duration: .45, ease: [0.22, 1, 0.36, 1] }}>
          <button type="button" role="tab" aria-selected={activeStep === index} onClick={() => setActiveStep(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step.label}</strong><i aria-hidden="true">↗</i></button>
          <div className="landing-story-step-copy"><h3>{step.title}</h3><p>{step.body}</p></div>
        </motion.article>)}
      </div>
      <div className="landing-story-stage-wrap"><div className="landing-story-stage" aria-live="polite">
        <div className="landing-story-stage-top"><span><i /> AUTHENTIQ · BACKOFFICE</span><span>{String(activeStep + 1).padStart(2, "0")} / 03</span></div>
        <div className="landing-story-stage-body"><div className="landing-story-stage-label">{stage.status}</div><div className="landing-story-record"><span className="landing-story-record-icon">{stage.icon}</span><div><strong>{stage.title}</strong><small>{stage.detail}</small></div><b>↗</b></div><div className="landing-story-stage-line"><span style={{ width: `${(activeStep + 1) * 33.33}%` }} /></div><div className="landing-story-stage-footer"><span>{stage.metricLabel}</span><strong>{stage.metric}</strong></div></div>
        <button type="button" className="landing-story-demo" onClick={onViewDemo}>Ver este flujo en la demo <span>↗</span></button>
      </div></div>
    </div>
  </section>;
}

function FinanceCalculator({ price, vehicle, onApplyFinancing }) {
  const numPrice = Number(price) || 0;
  const [downPercent, setDownPercent] = useState(20);
  const [months, setMonths] = useState(60);
  const [rate, setRate] = useState(9.5);

  const downPayment = Math.round((numPrice * downPercent) / 100);
  const principal = Math.max(numPrice - downPayment, 0);
  const monthlyRate = Number(rate) / 100 / 12;
  const payment = principal && monthlyRate
    ? (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1)
    : (months ? principal / months : 0);
  const totalInterest = Math.max(0, (payment * months) - principal);

  return (
    <div className="financing-calc-card" aria-label="Simulador financiero">
      <div>
        <span className="eyebrow">PLAN FINANCIERO · SIMULADOR</span>
        <h3>Calcula tu <em>cuota mensual.</em></h3>
        <div className="financing-controls">
          <div className="calc-field">
            <div className="calc-field-head">
              <span>Pago Inicial ({downPercent}%)</span>
              <strong>{formatFinancePrice(downPayment)}</strong>
            </div>
            <input
              type="range"
              className="calc-range-slider"
              min="10"
              max="70"
              step="5"
              value={downPercent}
              onChange={(e) => setDownPercent(Number(e.target.value))}
            />
          </div>

          <div className="calc-field">
            <div className="calc-field-head">
              <span>Plazo de financiamiento</span>
              <strong>{months} Meses ({Math.round(months / 12)} Años)</strong>
            </div>
            <div className="calc-term-pills">
              {[24, 36, 48, 60, 72].map((term) => (
                <button
                  key={term}
                  type="button"
                  className={`calc-term-pill ${months === term ? "is-active" : ""}`}
                  onClick={() => setMonths(term)}
                >
                  {term}m
                </button>
              ))}
            </div>
          </div>

          <div className="calc-field">
            <div className="calc-field-head">
              <span>Tasa Anual Estimada</span>
              <strong>{rate}% APR</strong>
            </div>
            <input
              type="range"
              className="calc-range-slider"
              min="5.0"
              max="18.0"
              step="0.5"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="financing-result-box" aria-live="polite" aria-atomic="true">
        <div className="financing-monthly-highlight">
          <span>Cuota mensual estimada</span>
          <div className="financing-monthly-amount">{formatFinancePrice(payment)}</div>
          <small style={{ color: "var(--auth-muted)", fontSize: "14px" }}>{months} pagos mensuales fijos</small>
        </div>

        <div className="financing-breakdown">
          <div className="financing-breakdown-row">
            <span>Monto a financiar:</span>
            <strong>{formatFinancePrice(principal)}</strong>
          </div>
          <div className="financing-breakdown-row">
            <span>Interés total estimado:</span>
            <strong>{formatFinancePrice(totalInterest)}</strong>
          </div>
          <div className="financing-breakdown-row">
            <span>Costo total estimado:</span>
            <strong>{formatFinancePrice(downPayment + (payment * months))}</strong>
          </div>
        </div>

        <button
          className="primary-action"
          type="button"
          onClick={() => onApplyFinancing?.({ downPayment, months, rate, monthlyPayment: payment })}
          style={{ width: "100%" }}
        >
          Solicitar financiamiento →
        </button>
      </div>
    </div>
  );
}

function PriceAlertModal({ vehicle, onClose }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", targetPrice: "", privacyConsent: false });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: false });
  const dialogRef = useAccessibleDialog(onClose);

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ loading: true, error: "", success: false });
    try {
      const response = await fetch(`${apiUrl}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("price-alert") },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          vehicleId: vehicle.id,
          message: `[ALERTA DE PRECIO] Interesado en ${vehicle.brand} ${vehicle.model} (${formatPrice(vehicle.priceUsd)}). Precio objetivo: ${form.targetPrice ? formatPrice(form.targetPrice) : "Cualquier rebaja"}`,
          turnstileToken,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo registrar la alerta");
      trackEvent("price_alert_submitted", { vehicleId: vehicle.id });
      setStatus({ loading: false, error: "", success: true });
    } catch (err) {
      setStatus({ loading: false, error: err.message, success: false });
    }
  };

  return (
    <motion.div className="lead-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section ref={dialogRef} className="lead-modal" role="dialog" aria-modal="true" aria-labelledby="price-alert-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        {status.success ? (
          <div className="lead-success">
            <span className="eyebrow">SOLICITUD REGISTRADA</span>
            <h2>Te tendremos en cuenta.</h2>
            <p>Registramos tu interés en este {vehicle.brand} {vehicle.model}. Un asesor revisará cualquier rebaja o promoción y se pondrá en contacto contigo.</p>
            <button className="primary-action" type="button" onClick={onClose}>Listo</button>
          </div>
        ) : (
          <>
            <span className="eyebrow">OPORTUNIDAD · {getBrandName()}</span>
            <h2 id="price-alert-title">Avisarme si baja de precio.</h2>
            <p className="modal-vehicle">{vehicle.brand} {vehicle.model} · Precio actual: {formatPrice(vehicle.priceUsd)}</p>
            <form className="lead-form" onSubmit={submit}>
              <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
              <div className="lead-form-grid">
                <label>Correo<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
                <label>WhatsApp / Teléfono<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></label>
              </div>
              <label>
                Precio deseado en USD <span>(Opcional)</span>
                <input
                  type="number"
                  placeholder={`Ej. ${Math.round(Number(vehicle.priceUsd) * 0.9)}`}
                  value={form.targetPrice}
                  onChange={(e) => setForm({ ...form, targetPrice: e.target.value })}
                />
              </label>
              <TurnstileField onTokenChange={setTurnstileToken} />
              <label className="consent-check">
                <input type="checkbox" checked={form.privacyConsent} onChange={(e) => setForm({ ...form, privacyConsent: e.target.checked })} required />
                <span>Acepto recibir notificaciones comerciales sobre este vehículo.</span>
              </label>
              {status.error && <p className="state-message error">{status.error}</p>}
              <button className="primary-action" type="submit" disabled={status.loading}>
                {status.loading ? "Activando alerta…" : "Activar alerta de precio"}
              </button>
            </form>
          </>
        )}
      </motion.section>
    </motion.div>
  );
}

function BuyerRequestModal({ kind, vehicle = null, onClose }) {
  const isTradeIn = kind === "trade-in";
  const [form, setForm] = useState({ name: "", email: "", phone: "", currentVehicle: "", year: "", mileage: "", note: "", privacyConsent: false });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: false });
  const [step, setStep] = useState(1);
  useAccessibleDialog(onClose);
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const title = isTradeIn ? "Valora tu vehículo actual." : "Avísame cuando llegue algo para mí.";
  const subtitle = isTradeIn
    ? "Cuéntanos lo esencial. Un asesor revisará los datos y te explicará el siguiente paso; esta solicitud no es una tasación definitiva."
    : "Dinos qué buscas. Te avisaremos cuando aparezca una unidad que encaje con tu búsqueda.";
  const advance = () => {
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
      setStatus({ loading: false, error: "Completa tu nombre, correo y teléfono para continuar.", success: false });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setStatus({ loading: false, error: "Revisa el correo antes de continuar.", success: false });
      return;
    }
    setStatus({ loading: false, error: "", success: false });
    setStep(2);
  };
  const submit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "", success: false });
    const requestMessage = isTradeIn
      ? `[TASACIÓN] Vehículo actual: ${form.currentVehicle}. Año: ${form.year || "No indicado"}. Kilometraje: ${form.mileage || "No indicado"} km.${vehicle ? ` Interesado además en: ${vehicle.brand} ${vehicle.model}.` : ""}${form.note ? ` Nota: ${form.note}` : ""}`
      : `[ALERTA DE BÚSQUEDA] Busca: ${form.currentVehicle}.${form.year ? ` Año desde: ${form.year}.` : ""}${form.note ? ` Preferencias: ${form.note}` : ""}`;
    try {
      const response = await fetch(`${apiUrl}/api/leads`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("vehicle-lead") }, body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone, vehicleId: vehicle?.id || null, message: requestMessage, privacyConsent: form.privacyConsent, turnstileToken }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo registrar tu solicitud");
      trackEvent(isTradeIn ? "trade_in_submitted" : "search_alert_submitted", vehicle ? { vehicleId: vehicle.id } : {});
      setStatus({ loading: false, error: "", success: true });
    } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  return <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.section className="lead-modal buyer-request-modal" role="dialog" aria-modal="true" aria-labelledby="buyer-request-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
      {status.success ? <div className="lead-success"><span className="eyebrow">SOLICITUD RECIBIDA</span><h2>{isTradeIn ? "Revisaremos tu vehículo." : "Te avisaremos cuando aparezca."}</h2><p>{isTradeIn ? "Un asesor revisará la información y te contactará para conocer el estado y la mejor forma de avanzar." : "Guardamos tu búsqueda. El equipo te escribirá cuando haya una opción relevante."}</p><button className="primary-action" type="button" onClick={onClose}>Listo</button></div> : <>
        <span className="eyebrow">{isTradeIn ? "RENUEVA TU VEHÍCULO" : "BÚSQUEDA PERSONALIZADA"}</span>
        <h2 id="buyer-request-title">{title}</h2>
        <p className="buyer-request-intro">{subtitle}</p>
        <div className="buyer-request-progress" aria-label={`Paso ${step} de 2`}><span className={step === 1 ? "is-active" : "is-done"}>1. Tus datos</span><i aria-hidden="true" /><span className={step === 2 ? "is-active" : ""}>2. Lo que necesitas</span></div>
        <form className="lead-form" onSubmit={(event) => { if (step === 1) { event.preventDefault(); advance(); } else submit(event); }}>
          {step === 1 ? <>
            <p className="buyer-request-step-note">Primero deja una forma de contactarte. Toma menos de un minuto.</p>
            <label>Nombre<input value={form.name} onChange={(event) => change("name", event.target.value)} autoComplete="name" required /></label>
            <div className="lead-form-grid"><label>Correo<input type="email" value={form.email} onChange={(event) => change("email", event.target.value)} autoComplete="email" required /></label><label>WhatsApp / Teléfono<input value={form.phone} onChange={(event) => change("phone", event.target.value)} autoComplete="tel" required /></label></div>
            {status.error && <p className="state-message error" role="alert">{status.error}</p>}
            <button className="primary-action" type="button" onClick={advance}>Continuar →</button>
          </> : <>
            <p className="buyer-request-step-note">Cuéntanos lo esencial para que el asesor llegue preparado.</p>
            <label>{isTradeIn ? "Marca y modelo de tu vehículo" : "Qué vehículo estás buscando"}<input value={form.currentVehicle} onChange={(event) => change("currentVehicle", event.target.value)} placeholder={isTradeIn ? "Ej. Toyota RAV4 Limited" : "Ej. SUV familiar, 3 filas, automático"} required /></label>
            <div className="lead-form-grid"><label>{isTradeIn ? "Año" : "Año desde (opcional)"}<input type="number" min="1900" max="2100" value={form.year} onChange={(event) => change("year", event.target.value)} /></label>{isTradeIn && <label>Kilometraje aproximado<input type="number" min="0" value={form.mileage} onChange={(event) => change("mileage", event.target.value)} /></label>}</div>
            <label>{isTradeIn ? "Estado o detalles relevantes (opcional)" : "Presupuesto, uso o preferencias (opcional)"}<textarea value={form.note} onChange={(event) => change("note", event.target.value)} placeholder={isTradeIn ? "Mantenimiento, daños, versión o extras…" : "Rango de precio, combustible, uso familiar, etc."} /></label>
            <TurnstileField onTokenChange={setTurnstileToken} />
            <label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => change("privacyConsent", event.target.checked)} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para responder esta solicitud.</span></label>
            {status.error && <p className="state-message error" role="alert">{status.error}</p>}
            <div className="buyer-request-actions"><button className="text-button" type="button" onClick={() => setStep(1)}>← Volver</button><button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando…" : isTradeIn ? "Solicitar orientación" : "Guardar mi búsqueda"}</button></div>
          </>}
        </form>
      </>}
    </motion.section>
  </motion.div>;
}

function QuoteModal({ vehicle, financingTerms, onClose }) {
  const dialogRef = useAccessibleDialog(onClose);
  return (
    <motion.div className="quote-overlay" role="dialog" aria-modal="true" aria-label="Cotización del vehículo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <section ref={dialogRef} className="quote-modal">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar cotización">×</button>
        <div className="quote-brand">{getBrandName()} <span>COTIZACIÓN DE VEHÍCULO</span></div>
        <div className="quote-heading">
          <span className="eyebrow">PROPUESTA COMERCIAL</span>
          <h2><TextReveal>{vehicle.brand}</TextReveal> <em><TextReveal delay={0.06}>{vehicle.model}</TextReveal></em></h2>
          <p>{vehicle.year} · {vehicle.condition === "new" ? "Nuevo" : "Certificado"}</p>
        </div>
        <div className="quote-price">
          <span>Precio de lista</span>
          <strong><AnimatedNumber value={vehicle.priceUsd} format={(number) => `$${number.toLocaleString("en-US")} USD`} /></strong>
        </div>
        {financingTerms && <Disclosure title="Simulación financiera incluida" defaultOpen>
          <div className="quote-financing-summary">
            <span>Inicial: <strong><AnimatedNumber value={financingTerms.downPayment} format={(number) => `$${number.toLocaleString("en-US")} USD`} /></strong></span>
            <span>Plazo: <strong><AnimatedNumber value={financingTerms.months} suffix=" meses" /></strong></span>
            <span>Cuota: <strong><AnimatedNumber value={financingTerms.monthlyPayment} format={formatFinancePrice} />/mes</strong></span>
          </div>
        </Disclosure>}
        <div className="quote-specs">
          <span>Motor <b>{vehicle.engine || "—"}</b></span>
          <span>Potencia <b>{vehicle.power || "—"}</b></span>
          <span>Transmisión <b>{vehicle.transmission || "—"}</b></span>
        </div>
        <p className="quote-note">Esta cotización es informativa y está sujeta a disponibilidad, inspección y aprobación comercial.</p>
        <div className="quote-actions">
          <button className="primary-action" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button>
          <button className="secondary-action" type="button" onClick={onClose}>Cerrar</button>
        </div>
      </section>
    </motion.div>
  );
}

function PublicQuotePage({ token }) {
  const dateLabel = (value) => value ? new Date(value).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : "sin fecha";
  const [quote, setQuote] = useState(null);
  const [state, setState] = useState("loading");
  const [decision, setDecision] = useState("");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionState, setDecisionState] = useState("");
  const [decisionError, setDecisionError] = useState("");
  useEffect(() => { let cancelled = false; fetch(`${apiUrl}/api/public/quotes/${encodeURIComponent(token)}`).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo abrir la cotización"); if (!cancelled) { setQuote(payload.data); setState("ready"); } }).catch(() => { if (!cancelled) setState("error"); }); return () => { cancelled = true; }; }, [token]);
  useEffect(() => { document.title = quote ? `${quote.quoteNumber} · AUTHENTIQ` : "Cotización · AUTHENTIQ"; setRobots(false); }, [quote]);
  const submitDecision = async (nextDecision) => {
    setDecisionState("sending");
    setDecisionError("");
    try {
      const response = await fetch(`${apiUrl}/api/public/quotes/${encodeURIComponent(token)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: nextDecision, message: decisionMessage }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo registrar la decisión");
      setDecision(nextDecision);
      setDecisionState("success");
      if (nextDecision === "accepted") setQuote((current) => ({ ...current, status: "accepted" }));
    } catch (error) {
      setDecisionState("");
      setDecisionError(error.message || "No se pudo registrar la decisión");
    }
  };
  if (state === "loading") return <main className="public-quote-page"><p className="state-message">Preparando tu cotización…</p></main>;
  if (state === "error" || !quote) return <main className="public-quote-page"><section className="public-quote-error"><span className="eyebrow">AUTHENTIQ · PROPUESTA</span><h1>Este enlace ya no está disponible.</h1><p>La cotización pudo vencer, cancelarse o el enlace pudo expirar.</p></section></main>;
  const accepted = quote.status === "accepted" || (decisionState === "success" && decision === "accepted");
  return <main className="public-quote-page"><article className="public-quote-card"><header><span className="brand-mark">AUTHENTIQ°</span><span className="eyebrow">PROPUESTA COMERCIAL · {quote.quoteNumber}</span></header>{quote.imageUrl && <img className="public-quote-image" src={publicMediaUrl(quote.imageUrl)} alt={`${quote.brand || "Vehículo"} ${quote.model || ""}`} /> }<div className="public-quote-heading"><span className="eyebrow">PREPARADA PARA {quote.customerName}</span><h1>{quote.brand ? `${quote.brand} ${quote.model}` : "Tu vehículo seleccionado"}</h1><p>{quote.year ? `${quote.year} · ` : ""}{quote.variant || "Propuesta AUTHENTIQ"}</p></div><div className="public-quote-price"><span>Total propuesto</span><strong>{formatPrice(quote.totalUsd)}</strong>{quote.validUntil && <small>Válida hasta {dateLabel(quote.validUntil)}</small>}</div><div className="public-quote-specs"><span>Precio base <b>{formatPrice(quote.basePriceUsd)}</b></span><span>Descuento <b>{Number(quote.discountUsd) ? `-${formatPrice(quote.discountUsd)}` : "Sin descuento"}</b></span><span>Condición <b>{accepted ? "Aceptada" : "Enviada"}</b></span></div>{quote.notes && <p className="public-quote-notes">{quote.notes}</p>}{accepted ? <section className="public-quote-feedback success" aria-live="polite"><strong>✓ Cotización aceptada</strong><p>Gracias. Nuestro equipo continuará contigo para coordinar los próximos pasos.</p></section> : decisionState === "success" && decision === "changes" ? <section className="public-quote-feedback success" aria-live="polite"><strong>✓ Solicitud recibida</strong><p>Registramos tus cambios. Un asesor se pondrá en contacto contigo.</p></section> : <section className="public-quote-decisions" aria-label="Decidir sobre la cotización"><div><span className="eyebrow">SIGUIENTE PASO</span><h2>¿Cómo quieres continuar?</h2><p>Acepta la propuesta o indícanos qué te gustaría ajustar.</p></div><div className="public-quote-decision-actions"><button className="primary-action" type="button" onClick={() => submitDecision("accepted")} disabled={decisionState === "sending"}>✓ Aceptar cotización</button><button className="secondary-action" type="button" onClick={() => setDecisionState("writing")} disabled={decisionState === "sending"}>Solicitar cambios</button></div>{decisionState === "writing" && <div className="public-quote-change-form"><label htmlFor="quote-change-message">¿Qué te gustaría ajustar? <span>Opcional</span></label><textarea id="quote-change-message" value={decisionMessage} maxLength={500} onChange={(event) => setDecisionMessage(event.target.value)} placeholder="Ej. Me gustaría revisar el descuento o la forma de pago." /><div><small>{decisionMessage.length}/500</small><button className="primary-action" type="button" onClick={() => submitDecision("changes")} disabled={decisionState === "sending"}>{decisionState === "sending" ? "Enviando…" : "Enviar solicitud"}</button></div></div>}{decisionError && <p className="public-quote-decision-error" role="alert">{decisionError}</p>}</section>}<footer><span>Informativa y sujeta a disponibilidad, inspección y aprobación comercial.</span><button className="primary-action" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button></footer></article></main>;
}

function Vehicle3DViewer({ vehicle, media }) {
  const viewerRef = useRef(null);
  const stageRef = useRef(null);
  const activeAnimationRef = useRef("");
  const animationPlayingRef = useRef(false);
  const [state, setState] = useState("loading");
  const [progress, setProgress] = useState(0);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [availableAnimations, setAvailableAnimations] = useState([]);
  const [activeAnimation, setActiveAnimation] = useState("");
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [hotspots, setHotspots] = useState([]);
  const [showHotspots, setShowHotspots] = useState(true);
  const model = media.find((item) => item.type === "model_3d");
  const modelUrl = publicMediaUrl(model?.url);
  // "procedural://" fue un marcador de una versión anterior; nunca representa un archivo real.
  const isProcedural = model?.url?.startsWith("procedural://");
  const poster = publicMediaUrl(model?.posterUrl || vehicle.images?.[0]?.url);
  useEffect(() => { activeAnimationRef.current = activeAnimation; }, [activeAnimation]);
  useEffect(() => { animationPlayingRef.current = animationPlaying; }, [animationPlaying]);
  useEffect(() => {
    if (!modelUrl || isProcedural) return undefined;
    setShouldLoad(false);
    setState("loading");
    setAvailableAnimations([]);
    setActiveAnimation("");
    setAnimationPlaying(false);
    const stage = stageRef.current;
    if (!stage || typeof IntersectionObserver === "undefined") { setShouldLoad(true); return undefined; }
    let idleTimer;
    const activate = () => setShouldLoad(true);
    if (typeof window.requestIdleCallback === "function") idleTimer = window.requestIdleCallback(activate, { timeout: 1200 });
    else idleTimer = window.setTimeout(activate, 700);
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { activate(); observer.disconnect(); }
    }, { rootMargin: "320px 0px" });
    observer.observe(stage);
    return () => { observer.disconnect(); if (typeof window.cancelIdleCallback === "function" && typeof idleTimer === "number") window.cancelIdleCallback(idleTimer); else window.clearTimeout(idleTimer); };
  }, [modelUrl, isProcedural]);
  useEffect(() => {
    if (!model || isProcedural || !shouldLoad) return undefined;
    if (poster) ensurePreload(poster, "image");
    let cleanup = () => {};
    let cancelled = false;
    let frameTimer;
    let jumpTimer;
    let interactionResumeTimer;
    setProgress(0);
    setState("loading");
    import("@google/model-viewer").then(({ ModelViewerElement }) => {
      if (cancelled) return;
      ModelViewerElement.minimumRenderScale = 1;
      ModelViewerElement.modelCacheSize = Math.max(ModelViewerElement.modelCacheSize || 5, 8);
      const viewer = viewerRef.current;
      if (!viewer) return;
      const stopAutoRotate = () => {
        window.clearTimeout(interactionResumeTimer);
        viewer.removeAttribute("auto-rotate");
      };
      const resumeAutoRotate = () => {
        window.clearTimeout(interactionResumeTimer);
        interactionResumeTimer = window.setTimeout(() => {
          if (!cancelled && viewer.getAttribute("auto-rotate") === null) viewer.setAttribute("auto-rotate", "");
        }, 1400);
      };
      const syncAnimations = () => {
        const clips = Array.isArray(viewer.availableAnimations) ? viewer.availableAnimations.filter(Boolean) : [];
        setAvailableAnimations(clips);
        if (!clips.length) {
          activeAnimationRef.current = "";
          animationPlayingRef.current = false;
          setActiveAnimation("");
          setAnimationPlaying(false);
          return;
        }
        const selected = clips.includes(activeAnimationRef.current) ? activeAnimationRef.current : clips[0];
        activeAnimationRef.current = selected;
        viewer.animationName = selected;
        viewer.currentTime = 0;
        viewer.pause?.();
        animationPlayingRef.current = false;
        setActiveAnimation(selected);
        setAnimationPlaying(false);
      };
      const frameViewer = async () => {
        // Algunos GLTF grandes terminan de cargar con el framing automático fuera
        // de cámara. Fijamos una toma inicial estable y luego dejamos los
        // controles libres para que el comprador pueda explorar el vehículo.
        viewer.removeAttribute("camera-orbit");
        viewer.removeAttribute("camera-target");
        await viewer.updateFraming?.();
        if (cancelled) return;
        jumpTimer = window.setTimeout(() => viewer.jumpCameraToGoal?.(), 80);
        ModelViewerElement.minimumRenderScale = 1;
        setProgress(100);
        setState("ready");
      };
      const buildHotspots = () => {
        // Las coordenadas de un punto dependen de cada modelo, asi que se derivan
        // de su caja envolvente en vez de fijarlas a mano: asi caen sobre el
        // vehiculo sea cual sea su tamano y su origen.
        //
        // Las etiquetas usan datos reales de la ficha (potencia, transmision,
        // color), nunca afirmaciones sobre la pieza concreta que hay debajo: la
        // orientacion del modelo no es conocida y decir "faros" podria senalar
        // el maletero.
        try {
          const center = viewer.getBoundingBoxCenter?.();
          const size = viewer.getDimensions?.();
          if (!center || !size) return;
          const points = [
            { id: "power", label: vehicle.power, caption: vehicle.engine, position: `${center.x} ${center.y + size.y * 0.34} ${center.z + size.z * 0.28}`, normal: "0 1 0" },
            { id: "drive", label: vehicle.transmission, caption: vehicle.drive, position: `${center.x + size.x * 0.34} ${center.y - size.y * 0.26} ${center.z}`, normal: "1 0 0" },
            { id: "finish", label: vehicle.exteriorColor, caption: vehicle.interiorColor ? `Interior ${vehicle.interiorColor}` : null, position: `${center.x - size.x * 0.34} ${center.y + size.y * 0.12} ${center.z - size.z * 0.18}`, normal: "-1 0 0" },
          ].filter((point) => point.label);
          setHotspots(points);
        } catch { setHotspots([]); }
      };
      const handleLoad = () => { syncAnimations(); setProgress(100); setState("ready"); buildHotspots(); frameTimer = window.setTimeout(() => { void frameViewer(); }, 80); };
      const handleProgress = (event) => setProgress(Math.max(0, Math.min(100, Math.round(Number(event.detail?.totalProgress || 0) * 100))));
      const handleError = () => setState("error");
      const handlePointerDown = () => stopAutoRotate();
      const handlePointerUp = () => resumeAutoRotate();
      const handleCameraChange = (event) => { if (event.detail?.source === "user-interaction") stopAutoRotate(); };
      const handleAnimationPlay = () => { animationPlayingRef.current = true; setAnimationPlaying(true); };
      const handleAnimationPause = () => { animationPlayingRef.current = false; setAnimationPlaying(false); };
      const handleAnimationFinished = () => { animationPlayingRef.current = false; setAnimationPlaying(false); };
      // El elemento puede haber terminado de cargar antes de que se registren los listeners.
      viewer.addEventListener("progress", handleProgress);
      viewer.addEventListener("load", handleLoad);
      viewer.addEventListener("error", handleError);
      viewer.addEventListener("play", handleAnimationPlay);
      viewer.addEventListener("pause", handleAnimationPause);
      viewer.addEventListener("finished", handleAnimationFinished);
      viewer.addEventListener("pointerdown", handlePointerDown);
      viewer.addEventListener("pointerup", handlePointerUp);
      viewer.addEventListener("pointercancel", handlePointerUp);
      viewer.addEventListener("interact-stopped", handlePointerUp);
      viewer.addEventListener("camera-change", handleCameraChange);
      if (viewer.loaded === true || viewer.model) handleLoad();
      cleanup = () => {
        viewer.removeEventListener("progress", handleProgress);
        viewer.removeEventListener("load", handleLoad);
        viewer.removeEventListener("error", handleError);
        viewer.removeEventListener("play", handleAnimationPlay);
        viewer.removeEventListener("pause", handleAnimationPause);
        viewer.removeEventListener("finished", handleAnimationFinished);
        viewer.removeEventListener("pointerdown", handlePointerDown);
        viewer.removeEventListener("pointerup", handlePointerUp);
        viewer.removeEventListener("pointercancel", handlePointerUp);
        viewer.removeEventListener("interact-stopped", handlePointerUp);
        viewer.removeEventListener("camera-change", handleCameraChange);
        window.clearTimeout(frameTimer);
        window.clearTimeout(jumpTimer);
        window.clearTimeout(interactionResumeTimer);
        viewer.pause?.();
        // Interrumpir también la descarga de GLTF al cambiar de ficha. Si se
        // deja el src activo, una navegación rápida mantiene texturas pesadas
        // en vuelo y el siguiente visor puede fallar por falta de recursos.
        viewer.removeAttribute("src");
        ModelViewerElement.minimumRenderScale = 1;
      };
    }).catch(() => setState("error"));
    // Si el archivo nunca responde, no dejamos al comprador en "cargando" para siempre.
    const timeout = window.setTimeout(() => setState((current) => current === "loading" ? "error" : current), 30000);
    return () => { cancelled = true; window.clearTimeout(timeout); cleanup(); };
  }, [modelUrl, isProcedural, shouldLoad]);
  const toggleAnimation = () => {
    const viewer = viewerRef.current;
    if (!viewer || !availableAnimations.length) return;
    const selected = activeAnimationRef.current || availableAnimations[0];
    viewer.animationName = selected;
    viewer.removeAttribute("auto-rotate");
    if (animationPlayingRef.current) {
      viewer.pause?.();
      animationPlayingRef.current = false;
      setAnimationPlaying(false);
    } else {
      viewer.play?.({ repetitions: Infinity });
      animationPlayingRef.current = true;
      setAnimationPlaying(true);
    }
  };
  const chooseAnimation = (event) => {
    const selected = event.target.value;
    const viewer = viewerRef.current;
    activeAnimationRef.current = selected;
    setActiveAnimation(selected);
    if (!viewer) return;
    viewer.animationName = selected;
    viewer.currentTime = 0;
    if (animationPlayingRef.current) viewer.play?.({ repetitions: Infinity });
    else { animationPlayingRef.current = false; viewer.pause?.(); }
  };
  if (!model || isProcedural) return null;
  return <section id="vehicle-3d-viewer" className="vehicle-3d-viewer" aria-label={`Modelo 3D de ${vehicle.brand} ${vehicle.model}`}>
    <div className="vehicle-studio-heading"><div><span className="eyebrow">AUTHENTIQ / REAL 3D</span><h2>Explóralo en detalle.</h2></div><span className="vehicle-3d-status">{state === "ready" ? "MODELO LISTO" : state === "error" ? "NO DISPONIBLE" : "CARGANDO MODELO"}</span></div>
    <div ref={stageRef} className={`vehicle-3d-stage ${state === "loading" ? "is-loading" : ""}`}>
      <div className="vehicle-3d-backdrop" />
      <model-viewer ref={viewerRef} src={shouldLoad ? modelUrl : undefined} poster={poster} alt={model.altText || `${vehicle.brand} ${vehicle.model}, modelo 3D`} camera-controls auto-rotate auto-rotate-delay="1600" rotation-per-second="10deg" shadow-intensity="1" shadow-softness=".72" exposure="1" tone-mapping="aces" touch-action="pan-y" loading="eager" reveal="auto" ar ar-modes="webxr scene-viewer quick-look">
        {showHotspots && hotspots.map((point) => (
          <button className="vehicle-3d-hotspot" key={point.id} slot={`hotspot-${point.id}`} data-position={point.position} data-normal={point.normal} data-visibility-attribute="visible" type="button">
            <span className="vehicle-3d-hotspot-dot" aria-hidden="true" />
            <span className="vehicle-3d-hotspot-label"><strong>{point.label}</strong>{point.caption && <small>{point.caption}</small>}</span>
          </button>
        ))}
      </model-viewer>
      {state === "loading" && <div className="vehicle-3d-loading" role="status" aria-live="polite"><div className="vehicle-3d-loader-mark" aria-hidden="true"><span /><i /><b /></div><span>{shouldLoad ? "Preparando la experiencia 3D" : "Preparando el estudio visual"}</span><div className="vehicle-3d-loading-track"><i style={{ transform: `scaleX(${Math.max(progress / 100, shouldLoad ? 0.08 : 0.02)})` }} /></div></div>}
      {state === "ready" && availableAnimations.length > 0 && <div className="vehicle-3d-animation-controls" aria-label="Animaciones del modelo 3D">
        <button type="button" onClick={toggleAnimation} aria-pressed={animationPlaying}>{animationPlaying ? "Pausar animación" : "Reproducir animación"}</button>
        {availableAnimations.length > 1 && <select value={activeAnimation} onChange={chooseAnimation} aria-label="Seleccionar animación del modelo 3D">{availableAnimations.map((name) => <option key={name} value={name}>{name}</option>)}</select>}
        <span>{availableAnimations.length} {availableAnimations.length === 1 ? "clip detectado" : "clips detectados"}</span>
      </div>}
      {state === "ready" && hotspots.length > 0 && <button className="vehicle-3d-hotspot-toggle" type="button" aria-pressed={showHotspots} onClick={() => setShowHotspots((current) => !current)}>{showHotspots ? "Ocultar detalles" : "Ver detalles"}</button>}
      {state !== "error" && <div className="vehicle-3d-hint"><span>ROTAR</span><span>ZOOM</span><span>ARRASTRAR</span></div>}
      {state === "error" && <div className="vehicle-3d-fallback"><span className="eyebrow">VISTA 3D NO DISPONIBLE</span><p>Estamos preparando el modelo tridimensional de este vehículo. Mientras tanto, la galería y el estudio visual muestran cada detalle.</p><button className="secondary-action" type="button" onClick={() => document.getElementById("vehicle-studio")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Ver el estudio visual ↓</button></div>}
    </div>
  </section>;
}

function VehicleVideo({ vehicle, media }) {
  const video = media.find((item) => item.type === "video");
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [video?.url]);
  // Un video roto no debe dejar un reproductor vacío en la ficha: la sección desaparece.
  if (!video || failed) return null;
  return <section className="vehicle-video-showcase" aria-label={`Video de ${vehicle.brand} ${vehicle.model}`}><div className="vehicle-studio-heading"><div><span className="eyebrow">AUTHENTIQ / MOTION FILM</span><h2>Verlo en movimiento.</h2></div><span className="vehicle-3d-status">VIDEO OFICIAL</span></div><div className="vehicle-video-frame"><video controls playsInline preload="metadata" poster={publicMediaUrl(video.posterUrl || vehicle.images?.[0]?.url)} aria-label={`Video de ${vehicle.brand} ${vehicle.model}`} onError={() => setFailed(true)}><source src={publicMediaUrl(video.url)} onError={() => setFailed(true)} /></video></div></section>;
}

// Visor panorámico equirectangular. El backoffice ya permitía subir una "Vista 360"
// y la guardaba como media 'panorama_360', pero nunca se mostraba al comprador.
// Se implementa con three.js, que ya era dependencia del proyecto y estaba sin usar.
function VehiclePanorama360({ vehicle, media }) {
  const containerRef = useRef(null);
  const [state, setState] = useState("loading");
  const panorama = media.find((item) => item.type === "panorama_360");

  useEffect(() => {
    if (!panorama) return undefined;
    let disposed = false;
    let cleanup = () => {};
    setState("loading");

    import("three").then((THREE) => {
      const container = containerRef.current;
      if (disposed || !container) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(72, container.clientWidth / container.clientHeight, 0.1, 100);
      // Esfera vista desde dentro: se invierte en X para que la textura no salga espejada.
      const geometry = new THREE.SphereGeometry(50, 60, 40);
      geometry.scale(-1, 1, 1);

      const texture = new THREE.TextureLoader().load(
        panorama.url,
        () => { if (!disposed) setState("ready"); },
        undefined,
        () => { if (!disposed) setState("error"); },
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      const sphere = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
      scene.add(sphere);

      let longitude = 0;
      let latitude = 0;
      let dragging = false;
      let pointerX = 0;
      let pointerY = 0;

      const onDown = (event) => { dragging = true; pointerX = event.clientX; pointerY = event.clientY; container.setPointerCapture?.(event.pointerId); };
      const onMove = (event) => {
        if (!dragging) return;
        longitude -= (event.clientX - pointerX) * 0.12;
        latitude = Math.max(-85, Math.min(85, latitude + (event.clientY - pointerY) * 0.12));
        pointerX = event.clientX;
        pointerY = event.clientY;
      };
      const onUp = () => { dragging = false; };
      const onKey = (event) => {
        if (event.key === "ArrowLeft") longitude += 5;
        if (event.key === "ArrowRight") longitude -= 5;
        if (event.key === "ArrowUp") latitude = Math.min(85, latitude + 5);
        if (event.key === "ArrowDown") latitude = Math.max(-85, latitude - 5);
      };
      const onResize = () => {
        if (!container.clientWidth) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };

      container.addEventListener("pointerdown", onDown);
      container.addEventListener("pointermove", onMove);
      container.addEventListener("pointerup", onUp);
      container.addEventListener("pointercancel", onUp);
      container.addEventListener("keydown", onKey);
      window.addEventListener("resize", onResize);

      let frame = 0;
      let isVisible = true;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const lookTarget = new THREE.Vector3();
      const render = () => {
        if (!isVisible) { frame = 0; return; }
        frame = requestAnimationFrame(render);
        if (!dragging && !reducedMotion) longitude += 0.03; // deriva lenta mientras nadie interactúa
        const phi = THREE.MathUtils.degToRad(90 - latitude);
        const theta = THREE.MathUtils.degToRad(longitude);
        lookTarget.set(
          50 * Math.sin(phi) * Math.cos(theta),
          50 * Math.cos(phi),
          50 * Math.sin(phi) * Math.sin(theta),
        );
        renderer.render(scene, camera);
      };
      const visibilityObserver = new IntersectionObserver(([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible && !frame) render();
        if (!isVisible && frame) { cancelAnimationFrame(frame); frame = 0; }
      }, { rootMargin: "160px 0px" });
      visibilityObserver.observe(container);
      render();

      cleanup = () => {
        cancelAnimationFrame(frame);
        container.removeEventListener("pointerdown", onDown);
        container.removeEventListener("pointermove", onMove);
        container.removeEventListener("pointerup", onUp);
        container.removeEventListener("pointercancel", onUp);
        container.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", onResize);
        visibilityObserver.disconnect();
        texture.dispose();
        geometry.dispose();
        sphere.material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => { if (!disposed) setState("error"); });

    return () => { disposed = true; cleanup(); };
  }, [panorama?.url]);

  if (!panorama || state === "error") return null;
  return <section id="vehicle-360" className="vehicle-360-viewer" aria-label={`Vista 360 de ${vehicle.brand} ${vehicle.model}`}>
    <div className="vehicle-studio-heading"><div><span className="eyebrow">AUTHENTIQ / VISTA 360</span><h2>Mira alrededor.</h2></div><span className="vehicle-3d-status">{state === "ready" ? "PANORAMA LISTO" : "CARGANDO VISTA"}</span></div>
    <div ref={containerRef} className="vehicle-360-stage" role="application" tabIndex="0" aria-label="Arrastra o usa las flechas para mirar alrededor" />
    <p className="vehicle-360-hint">Arrastra para mirar alrededor · usa las flechas del teclado</p>
  </section>;
}

function VehicleStudio({ vehicle, images }) {
  const [activeFrame, setActiveFrame] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const reduceMotion = useReducedMotion();
  const dragStart = useRef(0);
  const tiltFrame = useRef(0);
  const pendingTilt = useRef({ x: 0, y: 0 });
  const image = publicMediaUrl(images[activeFrame]?.url || images[0]?.url);
  const frameCount = images.length;
  const changeFrame = (direction) => setActiveFrame((current) => (current + direction + frameCount) % frameCount);
  const handleMove = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (reduceMotion) return;
    pendingTilt.current = { x: (0.5 - y / bounds.height) * 8, y: (x / bounds.width - 0.5) * 12 };
    if (!tiltFrame.current) tiltFrame.current = requestAnimationFrame(() => { setTilt(pendingTilt.current); tiltFrame.current = 0; });
    if (dragging && frameCount > 1 && Math.abs(event.clientX - dragStart.current) > 28) {
      changeFrame(event.clientX > dragStart.current ? -1 : 1);
      dragStart.current = event.clientX;
    }
  };
  const resetTilt = () => { if (!dragging) setTilt({ x: 0, y: 0 }); };
  const media = vehicle.media || [];
  return <>
    <SectionBoundary name="visor 3D" silent><Vehicle3DViewer vehicle={vehicle} media={media} /></SectionBoundary>
    <SectionBoundary name="video" silent><VehicleVideo vehicle={vehicle} media={media} /></SectionBoundary>
    <SectionBoundary name="vista 360" silent><VehiclePanorama360 vehicle={vehicle} media={media} /></SectionBoundary>
    <section id="vehicle-studio" className="vehicle-studio" aria-label={`Vista de estudio de ${vehicle.brand} ${vehicle.model}`}>
    <div className="vehicle-studio-heading"><div><span className="eyebrow">STUDIO / DEPTH VIEW</span><h2>Verlo desde otra perspectiva.</h2></div><span className="vehicle-studio-count">{String(activeFrame + 1).padStart(2, "0")} / {String(frameCount).padStart(2, "0")}</span></div>
    <div className="vehicle-studio-stage" style={{ "--studio-rotate-x": `${tilt.x}deg`, "--studio-rotate-y": `${tilt.y}deg` }} onPointerDown={(event) => { setDragging(true); dragStart.current = event.clientX; event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerMove={handleMove} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)} onPointerLeave={resetTilt}>
      <div className="vehicle-studio-glow" />
      <div className="vehicle-studio-floor" />
      <motion.div className="vehicle-studio-object" animate={{ transform: reduceMotion ? "none" : `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }} transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 170, damping: 22 }}>
        <div className="vehicle-studio-image-frame"><AnimatePresence mode="wait" initial={false}><motion.img key={image} src={image} alt={`${vehicle.brand} ${vehicle.model}, vista de estudio`} initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: .24 }} /></AnimatePresence></div>
        <div className="vehicle-studio-reflection" />
      </motion.div>
      <span className="vehicle-studio-hint">{frameCount > 1 ? "Arrastra para explorar" : "Mueve el cursor para explorar"}</span>
    </div>
    <div className="vehicle-studio-controls"><button className="icon-action" type="button" onClick={() => changeFrame(-1)} aria-label="Vista anterior">←</button><div className="vehicle-studio-frames">{images.map((item, index) => <button key={item.id || item.url} className={index === activeFrame ? "vehicle-studio-frame active" : "vehicle-studio-frame"} type="button" onClick={() => setActiveFrame(index)} aria-label={`Vista ${index + 1}`}><img src={publicMediaUrl(item.url)} alt="" /></button>)}</div><button className="icon-action" type="button" onClick={() => changeFrame(1)} aria-label="Vista siguiente">→</button></div>
    </section>
  </>;
}

const brandLogoSlugs = { Acura: "acura", "Alfa Romeo": "alfaromeo", Audi: "audi", Bentley: "bentley", BMW: "bmw", Buick: "buick", BYD: "byd", Cadillac: "cadillac", Changan: "changan", Chevrolet: "chevrolet", Chrysler: "chrysler", Citroen: "citroen", Daihatsu: "daihatsu", Dodge: "dodge", Ferrari: "ferrari", Fiat: "fiat", Ford: "ford", GMC: "gmc", Porsche: "porsche", "Mercedes-AMG": "mercedesbenz", "Mercedes-Benz": "mercedesbenz" };

const brandDirectory = ["Acura", "Alfa Romeo", "Audi", "Bentley", "BMW", "Buick", "BYD", "Cadillac", "Changan", "Chevrolet", "Chrysler", "Citroen", "Daihatsu", "Dodge", "Ferrari", "Fiat", "Ford", "GMC", "Mercedes-AMG", "Porsche"];

function BrandLogo({ brand, logoUrl = "", size = "normal" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const slug = brandLogoSlugs[brand];
  const initials = String(brand || slug || "").split(/\s+/).map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  // El catálogo se presenta también en redes corporativas y entornos cerrados:
  // un logo remoto roto no debe convertirse en una petición fallida ni romper
  // la composición. El monograma mantiene el lenguaje de marca hasta que el
  // concesionario suba un asset propio al almacenamiento de la plataforma.
  const resolvedLogoUrl = publicMediaUrl(logoUrl);
  return <span className={`brand-logo brand-logo-${size}${imageFailed ? " has-fallback" : ""}`} aria-label={`Logo de ${brand}`} data-brand-slug={slug || "custom"}>
    {resolvedLogoUrl && !imageFailed ? <img src={resolvedLogoUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} /> : <b>{initials || "°"}</b>}
  </span>;
}

function VehicleCard({ vehicle, onOpen, onToggleCompare, isCompared, isFavorite, onToggleFavorite, onQuickAction, whatsapp = "", businessName = getBrandName(), imageLoading = "lazy" }) {
  const image = publicMediaUrl(vehicle.images?.[0]?.url) || "/assets/hero-highway.webp";
  const whatsappNumber = String(whatsapp || "").replace(/\D/g, "");
  const whatsappText = encodeURIComponent(`Mira este ${vehicle.brand} ${vehicle.model} en ${businessName}: ${window.location.origin}${vehiclePath(vehicle)}`);
  const whatsappHref = `https://wa.me/${whatsappNumber}${whatsappText ? `?text=${whatsappText}` : ""}`;
  const [shareStatus, setShareStatus] = useState("");
  const shareVehicle = async (event) => { event.stopPropagation(); try { const result = await shareOrCopyUrl(`${window.location.origin}${vehiclePath(vehicle)}`, `${vehicle.brand} ${vehicle.model}`); setShareStatus(result === "copied" ? "URL copiada" : result === "shared" ? "Compartido" : "No disponible"); window.setTimeout(() => setShareStatus(""), 2200); } catch { setShareStatus(""); } };
  // La vista de ficha se registra al cambiar de ruta (cubre también los enlaces directos),
  // así que aquí no se emite un segundo vehicle_view para no duplicar la métrica.
  const open = (event) => {
    const photo = event?.currentTarget?.querySelector?.(".vehicle-image");
    if (photo && typeof document.startViewTransition === "function") {
      photo.style.viewTransitionName = "vehicle-hero";
      window.setTimeout(() => { photo.style.viewTransitionName = ""; }, 800);
    }
    onOpen(vehicle);
  };
  const preloadDetail = () => {
    const model = vehicle.media?.find((item) => item.type === "model_3d");
    if (model?.posterUrl) ensurePreload(publicMediaUrl(model.posterUrl), "image");
  };

  return (
    <motion.article
      className="vehicle-card"
      initial={{ opacity: 0, scale: .96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: .98 }}
      whileHover={{ transform: "translateY(-4px)" }}
      whileTap={{ transform: "scale(.99)" }}
      transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}
    >
      <div className="vehicle-image-wrap" onPointerEnter={preloadDetail} onFocus={preloadDetail} onTouchStart={preloadDetail}>
        <button className="vehicle-card-image-button" type="button" onClick={open} aria-label={`Abrir ficha de ${vehicle.brand} ${vehicle.model}`}>
          <img src={image} alt={`${vehicle.brand} ${vehicle.model}`} className="vehicle-image" loading={imageLoading} decoding="async" fetchPriority={imageLoading === "eager" ? "high" : "auto"} />
          <span className={`vehicle-tag ${vehicle.status === "reserved" ? "reserved" : vehicle.condition}`}>
            {vehicle.status === "reserved" ? "RESERVADO" : vehicle.condition === "new" ? "NUEVO" : "CERTIFICADO"}
          </span>
          <BrandLogo brand={vehicle.brand} logoUrl={vehicle.brandLogoUrl} size="card" />
        </button>
        <button className={`favorite-toggle ${isFavorite ? "is-selected" : ""}`} type="button" aria-label={isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"} onClick={() => onToggleFavorite(vehicle)}>{isFavorite ? "♥" : "♡"}</button>
        <button className={`compare-toggle ${isCompared ? "is-selected" : ""}`} type="button" role="checkbox" aria-checked={isCompared} aria-label={`${isCompared ? "Quitar" : "Añadir"} ${vehicle.brand} ${vehicle.model} ${isCompared ? "de la comparación" : "a comparación"}`} onClick={() => onToggleCompare(vehicle)}>{isCompared ? "Comparando ✓" : "Comparar"}</button>
      </div>
      <button className="vehicle-card-body vehicle-card-open" type="button" onClick={open}>
        <div>
          <h3>{vehicle.brand} {vehicle.model}</h3>
          <span className="vehicle-meta">{vehicle.year} · {vehicle.variant || vehicle.fuelType || vehicle.power || "—"}</span>
          <span className="vehicle-card-specs"><i>◉</i>{vehicle.fuelType || "Gasolina"}<i>⚙</i>{vehicle.transmission || "Automático"}<i>↗</i>{Number(vehicle.mileageKm || 0).toLocaleString("en-US")} km</span>
        </div>
        <strong>{formatPrice(vehicle.priceUsd)}</strong>
        <span className="vehicle-card-cta">Abrir ficha <span>↗</span></span>
      </button>
      {onQuickAction && <div className="vehicle-card-quick-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onQuickAction(vehicle, "appointment"); }}>Agendar cita</button><button type="button" onClick={(event) => { event.stopPropagation(); onQuickAction(vehicle, "quote"); }}>Cotización</button>{whatsappNumber ? <a href={whatsappHref} target="_blank" rel="noreferrer" onClick={(event) => { event.stopPropagation(); trackEvent("whatsapp_click", { vehicleId: vehicle.id }); }}>WhatsApp</a> : <button type="button" onClick={shareVehicle}>Compartir</button>}{shareStatus && <span className="vehicle-share-status" role="status">{shareStatus}</span>}</div>}
    </motion.article>
  );
}

function CatalogSkeleton() {
  return <div className="vehicle-grid catalog-skeleton" aria-label="Cargando inventario" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <article className="vehicle-skeleton-card" key={index}><div className="vehicle-skeleton-image" /><div className="vehicle-skeleton-copy"><span /><strong /><small /></div></article>)}</div>;
}

function CatalogError({ message, onRetry }) {
  return <section className="catalog-state-card error" role="alert"><span className="catalog-state-mark">!</span><div><strong>No pudimos cargar el inventario.</strong><p>{message || "El catálogo no respondió a tiempo."}</p></div><button className="secondary-action" type="button" onClick={onRetry}>Reintentar</button></section>;
}

function LeadForm({ vehicle, onClose, customerToken = "" }) {
  const [form, setForm] = useState({ buyerName: "", buyerEmail: "", buyerPhone: "", amountUsd: vehicle.priceUsd, message: "", privacyConsent: false });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: false });
  useAccessibleDialog(onClose);
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (form.buyerEmail.trim() && !/^\S+@\S+\.\S+$/.test(form.buyerEmail.trim())) { setStatus({ loading: false, error: "Revisa el correo electrónico: falta un formato válido (ej. nombre@correo.com).", success: false }); return; }
    setStatus({ loading: true, error: "", success: false });
    const body = { vehicleId: vehicle.id, ...form, amountUsd: Number(form.amountUsd), turnstileToken };
    try {
      const response = await fetch(`${apiUrl}/api/offers`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("offer"), ...(customerToken ? { Authorization: `Bearer ${customerToken}` } : {}) }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar la solicitud");
      trackEvent("offer_submitted", { vehicleId: vehicle.id });
      setStatus({ loading: false, error: "", success: true });
    } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  return <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }}><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>{status.success ? <div className="lead-success"><span className="eyebrow">OFERTA RECIBIDA</span><h2>Tu oferta está en revisión.</h2><p>El equipo de {getBrandName()} revisará los datos y se pondrá en contacto contigo.</p><button className="primary-action" type="button" onClick={onClose}>Cerrar</button></div> : <><span className="eyebrow">CONTACTO COMERCIAL</span><h2 id="lead-title">Hacer una oferta.</h2><p className="modal-vehicle">{vehicle.brand} {vehicle.model} · {formatPrice(vehicle.priceUsd)}</p><form className="lead-form" onSubmit={submit}><label>Nombre<input value={form.buyerName} onChange={(event) => change("buyerName", event.target.value)} required /></label><div className="lead-form-grid"><label>Correo<input type="text" inputMode="email" autoComplete="email" value={form.buyerEmail} onChange={(event) => change("buyerEmail", event.target.value)} /></label><label>Teléfono<input value={form.buyerPhone} onChange={(event) => change("buyerPhone", event.target.value)} /></label></div><label>Monto de oferta USD<input type="number" min="1" step="0.01" value={form.amountUsd} onChange={(event) => change("amountUsd", event.target.value)} required /></label><label>Mensaje<textarea value={form.message} onChange={(event) => change("message", event.target.value)} placeholder="Cuéntanos algo sobre tu propuesta..." /></label><TurnstileField onTokenChange={setTurnstileToken} /><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => change("privacyConsent", event.target.checked)} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para esta solicitud.</span></label>{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando…" : "Enviar oferta"}</button></form></>}</motion.section></motion.div>;
}

function TestDriveModal({ vehicle, onClose }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", date: "", time: "", privacyConsent: false });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: false });
  const [availability, setAvailability] = useState({ loading: false, slots: [], message: "Selecciona una fecha para ver los horarios disponibles." });
  useAccessibleDialog(onClose);
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  useEffect(() => {
    if (!form.date) { setAvailability({ loading: false, slots: [], message: "Selecciona una fecha para ver los horarios disponibles." }); return undefined; }
    let cancelled = false;
    setAvailability({ loading: true, slots: [], message: "Consultando disponibilidad…" });
    fetch(`${apiUrl}/api/appointments/availability?date=${encodeURIComponent(form.date)}`)
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo consultar la agenda"); return payload.data; })
      .then((data) => { if (!cancelled) setAvailability({ loading: false, slots: data.slots || [], message: data.slots?.some((slot) => slot.available) ? "Elige un horario disponible." : "No hay horarios disponibles para este día." }); })
      .catch((error) => { if (!cancelled) setAvailability({ loading: false, slots: [], message: error.message }); });
    return () => { cancelled = true; };
  }, [form.date]);
  const submit = async (event) => {
    event.preventDefault(); setStatus({ loading: true, error: "", success: false });
    try { const response = await fetch(`${apiUrl}/api/appointments`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("appointment") }, body: JSON.stringify({ ...form, vehicleId: vehicle.id, turnstileToken }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo registrar la cita"); trackEvent("appointment_submitted", { vehicleId: vehicle.id }); setStatus({ loading: false, error: "", success: true }); } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  const minDate = localIsoDate();
  return <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="lead-modal test-drive-modal" role="dialog" aria-modal="true" aria-labelledby="test-drive-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }}><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>{status.success ? <div className="lead-success"><span className="eyebrow">CITA RECIBIDA</span><h2>Tu cita está en revisión.</h2><p>Un asesor confirmará el horario y te contactará con los detalles de tu visita.</p><button className="primary-action" type="button" onClick={onClose}>Cerrar</button></div> : <><span className="eyebrow">AGENDA · {getBrandName()}</span><h2 id="test-drive-title">Agenda tu cita.</h2><p className="modal-vehicle">{vehicle.brand} {vehicle.model} · {vehicle.year}</p><form className="lead-form" onSubmit={submit}><label>Nombre<input value={form.name} onChange={(event) => change("name", event.target.value)} autoComplete="name" required /></label><div className="lead-form-grid"><label>Correo<input type="email" value={form.email} onChange={(event) => change("email", event.target.value)} autoComplete="email" required /></label><label>Teléfono<input value={form.phone} onChange={(event) => change("phone", event.target.value)} autoComplete="tel" required /></label></div><div className="lead-form-grid"><label>Fecha<input type="date" min={minDate} value={form.date} onChange={(event) => { change("date", event.target.value); change("time", ""); }} required /></label><label>Horario<select value={form.time} onChange={(event) => change("time", event.target.value)} disabled={!form.date || availability.loading} required><option value="">{availability.loading ? "Consultando…" : "Selecciona un horario"}</option>{availability.slots.filter((slot) => slot.available).map((slot) => <option value={slot.time} key={slot.time}>{slot.time}</option>)}</select></label></div><p className={`appointment-availability-note${availability.slots.length && !availability.slots.some((slot) => slot.available) ? " is-full" : ""}`}>{availability.message}</p><TurnstileField onTokenChange={setTurnstileToken} /><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => change("privacyConsent", event.target.checked)} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para coordinar la visita.</span></label>{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading || availability.loading || !form.time}>{status.loading ? "Registrando…" : "Solicitar cita"}</button></form></>}</motion.section></motion.div>;
}

function CustomerAccountModal({ customer, form, mode, status, recoveryStatus = {}, favoriteCount, favoriteVehicles = [], activity = { offers: [], quotes: [], notifications: [] }, whatsapp = "", businessName = getBrandName(), onChange, onSubmit, onRecoverySubmit, onTurnstileToken, onMode, onClose, onLogout, onReadNotifications, onOpenVehicle, onToggleFavorite, onQuickAction }) {
  const dialogRef = useAccessibleDialog(onClose);
  return <motion.div className="quote-overlay" role="dialog" aria-modal="true" aria-label="Cuenta de comprador" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <section ref={dialogRef} className="customer-account-modal">
      <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar cuenta">×</button>
      {customer ? <>
        <span className="eyebrow">{getBrandName()} · MI CUENTA</span>
        <h2>Tu selección, <em>guardada.</em></h2>
        <p className="account-welcome">Hola, {customer.name}. Tus vehículos favoritos estarán disponibles cuando vuelvas.</p>
        <div className="account-summary"><div><strong>{favoriteCount}</strong><span>favoritos</span></div><div><strong>{activity.offers.length + activity.quotes.length}</strong><span>solicitudes</span></div></div>
        <div className="account-favorites"><div className="account-activity-head"><span className="eyebrow">MI SELECCIÓN</span><span>{favoriteVehicles.length ? "Guardados para volver" : "Todavía vacío"}</span></div>{favoriteVehicles.length ? <div className="account-favorites-grid">{favoriteVehicles.slice(0, 4).map((vehicle) => { const number = String(whatsapp || "").replace(/\D/g, ""); const message = encodeURIComponent(`Mira este ${vehicle.brand} ${vehicle.model} en ${businessName}: ${window.location.origin}${vehiclePath(vehicle)}`); return <article className="account-favorite-card" key={vehicle.id}><button type="button" onClick={() => onOpenVehicle?.(vehicle)} aria-label={`Abrir ${vehicle.brand} ${vehicle.model}`}><img src={publicMediaUrl(vehicle.images?.[0]?.url) || "/assets/hero-highway.webp"} alt="" loading="lazy" /><span><strong>{vehicle.brand} {vehicle.model}</strong><small>{formatPrice(vehicle.priceUsd)}</small></span></button><div className="account-favorite-actions"><button type="button" onClick={() => onQuickAction?.(vehicle, "appointment")}>Cita</button><button type="button" onClick={() => onQuickAction?.(vehicle, "quote")}>Cotizar</button><a href={`https://wa.me/${number}?text=${message}`} target="_blank" rel="noreferrer" onClick={() => number && trackEvent("whatsapp_click", { vehicleId: vehicle.id })}>{number ? "WhatsApp" : "Compartir"}</a></div><button className="account-favorite-remove" type="button" onClick={() => onToggleFavorite?.(vehicle)} aria-label={`Quitar ${vehicle.brand} ${vehicle.model} de favoritos`}>×</button></article>; })}</div> : <p className="account-activity-empty">Guarda un vehículo desde el catálogo para encontrarlo aquí cuando regreses.</p>}</div>
        {!!activity.notifications.length && <div className="account-notifications"><div className="account-activity-head"><span className="eyebrow">AVISOS</span>{activity.notifications.some((item) => !item.readAt) && <button type="button" onClick={onReadNotifications}>Marcar como leídos</button>}</div>{activity.notifications.slice(0, 4).map((item) => <article className={item.readAt ? "account-notification" : "account-notification unread"} key={item.id}><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</small></article>)}</div>}
        <div className="account-activity"><div className="account-activity-head"><span className="eyebrow">ACTIVIDAD COMERCIAL</span><span>Últimas solicitudes</span></div>{activity.offers.length || activity.quotes.length ? <>{activity.offers.slice(0, 3).map((item) => <article className="account-activity-row" key={`offer-${item.id}`}><div><strong>{item.brand} {item.model}</strong><span>Oferta · {formatPrice(item.amountUsd)}</span></div><b className={`status-pill ${item.status}`}>{item.status === "accepted" ? "Aceptada" : item.status === "rejected" ? "Rechazada" : "Pendiente"}</b></article>)}{activity.quotes.slice(0, 3).map((item) => <article className="account-activity-row" key={`quote-${item.id}`}><div><strong>{item.quoteNumber}</strong><span>Cotización · {formatPrice(item.totalUsd)}</span></div><b className={`status-pill ${item.status}`}>{item.status === "accepted" ? "Aceptada" : item.status === "sent" ? "Enviada" : item.status === "cancelled" ? "Cancelada" : item.status === "expired" ? "Vencida" : "Borrador"}</b></article>)}</> : <p className="account-activity-empty">Todavía no tienes ofertas ni cotizaciones registradas.</p>}</div>
        <div className="quote-actions"><button className="primary-action" type="button" onClick={onClose}>Seguir explorando</button><button className="secondary-action" type="button" onClick={onLogout}>Cerrar sesión</button></div>
      </> : <>
        <span className="eyebrow">{getBrandName()} · CUENTA DE COMPRADOR</span>
        <h2>{mode === "login" ? <>Vuelve a tu <em>selección.</em></> : mode === "forgot" ? <>Recupera tu <em>cuenta.</em></> : <>Guarda lo que te <em>mueve.</em></>}</h2>
        <p className="account-welcome">{mode === "login" ? "Accede a tus favoritos desde cualquier dispositivo." : mode === "forgot" ? "Te enviaremos un enlace si existe una cuenta con ese correo." : "Crea una cuenta para conservar tus favoritos y continuar tu búsqueda."}</p>
        {mode === "forgot" ? <form className="customer-account-form" onSubmit={onRecoverySubmit}><label>Correo<input type="email" value={form.email} onChange={(event) => onChange("email", event.target.value)} autoComplete="email" required /></label>{recoveryStatus.message && <p className="state-message success" role="status">{recoveryStatus.message}</p>}{recoveryStatus.error && <p className="state-message error" role="alert">{recoveryStatus.error}</p>}<button className="primary-action" type="submit" disabled={recoveryStatus.loading}>{recoveryStatus.loading ? "Enviando…" : "Enviar enlace"}</button></form> : <form className="customer-account-form" onSubmit={onSubmit}>
          {mode === "register" && <label>Nombre completo<input value={form.name} onChange={(event) => onChange("name", event.target.value)} autoComplete="name" required /></label>}
          <label>Correo<input type="email" value={form.email} onChange={(event) => onChange("email", event.target.value)} autoComplete="email" required /></label>
          {mode === "register" && <label>Teléfono <span>(opcional)</span><input value={form.phone} onChange={(event) => onChange("phone", event.target.value)} autoComplete="tel" /></label>}
          <label>Contraseña<input type="password" minLength="8" value={form.password} onChange={(event) => onChange("password", event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
          {mode === "register" && <TurnstileField onTokenChange={onTurnstileToken} />}
          {status.error && <p className="state-message error">{status.error}</p>}
          <button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Procesando…" : mode === "login" ? "Entrar a mi cuenta" : "Crear mi cuenta"}</button>
        </form>}
        {mode === "login" && <button className="text-button" type="button" onClick={() => onMode("forgot")}>¿Olvidaste tu contraseña?</button>}
        <button className="account-mode-switch" type="button" onClick={() => onMode(mode === "login" || mode === "forgot" ? "register" : "login")}>{mode === "login" || mode === "forgot" ? "¿Aún no tienes cuenta? Crear una" : "Ya tengo una cuenta · Entrar"}</button>
      </>}
    </section>
  </motion.div>;
}

function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", privacyConsent: false });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [status, setStatus] = useState({ loading: false, error: "", success: false });
  const submit = async (event) => {
    event.preventDefault(); setStatus({ loading: true, error: "", success: false });
    try {
      const response = await fetch(`${apiUrl}/api/leads`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("contact") }, body: JSON.stringify({ ...form, turnstileToken }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar el mensaje");
      setStatus({ loading: false, error: "", success: true }); trackEvent("contact_submitted"); setForm({ name: "", email: "", phone: "", message: "", privacyConsent: false });
    } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  return <section className="contact-section" id="contact"><div><span className="eyebrow">CONTACTO DIRECTO</span><h2>Hablemos de tu próximo vehículo.</h2><p>Déjanos tus datos y un asesor de {getBrandName()} se pondrá en contacto contigo.</p><p className="response-time-note"><strong>¿Qué pasa después?</strong> Revisaremos tu mensaje durante el horario de atención y te responderemos con el siguiente paso.</p></div><form className="contact-form" onSubmit={submit}><label>Nombre<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><div className="lead-form-grid"><label>Correo<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Teléfono<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label></div><label>Mensaje<textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} required /></label><TurnstileField onTokenChange={setTurnstileToken} /><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => setForm({ ...form, privacyConsent: event.target.checked })} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para responder este mensaje.</span></label>{status.success && <p className="form-message success-message">Mensaje recibido. Te contactaremos pronto. No necesitas enviarlo otra vez.</p>}{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando…" : "Enviar mensaje"}</button></form></section>;
}

function FaqSection({ settings = {} }) {
  const fallback = [
    ["¿Puedo agendar una visita?", "Sí. Elige una fecha y un horario disponible desde la ficha del vehículo; el equipo confirmará la visita."],
    ["¿Puedo entregar mi vehículo actual?", "Puedes solicitar una orientación de tasación y un asesor revisará la información contigo."],
    ["¿La cotización es el precio final?", "La cotización es informativa y queda sujeta a disponibilidad, inspección, aprobación comercial y condiciones de financiamiento."],
    ["¿Cómo me responderán?", "Usaremos el correo, teléfono o WhatsApp que dejaste en la solicitud. Durante el horario del showroom te indicaremos el siguiente paso."],
  ];
  const defaults = Array.isArray(settings.faqItems) && settings.faqItems.length ? settings.faqItems.map((item) => [item.question, item.answer]) : fallback;
  const [activeIndex, setActiveIndex] = useState(null);
  const reduceMotion = useReducedMotion();
  return <section className="faq-section" id="preguntas" aria-label="Preguntas frecuentes"><div className="section-head"><div><span className="eyebrow">ANTES DE VISITARNOS</span><h2>Preguntas frecuentes.</h2></div><p>Lo esencial para avanzar con claridad.</p></div><div className="faq-list">{defaults.map(([question, answer], index) => { const active = activeIndex === index; return <div className={`faq-item${active ? " is-active" : ""}`} key={question}><button type="button" className="faq-trigger" aria-expanded={active} aria-controls={`faq-answer-${index}`} onClick={() => setActiveIndex(active ? null : index)}><span className="faq-symbol" aria-hidden="true">{active ? "−" : "+"}</span><span>{question}</span><span className="faq-chevron" aria-hidden="true">⌃</span></button><motion.div id={`faq-answer-${index}`} className="faq-answer" initial={false} animate={{ gridTemplateRows: active ? "1fr" : "0fr", opacity: active ? 1 : 0 }} transition={{ duration: reduceMotion ? 0 : .24, ease: "easeOut" }}><div><p>{answer}</p></div></motion.div></div>; })}</div></section>;
}

function TestimonialsSection({ settings = {} }) {
  const testimonials = Array.isArray(settings.testimonials) ? settings.testimonials.filter((item) => item?.quote && item?.name) : [];
  if (!testimonials.length) return null;
  return <section className="testimonials-section" id="opiniones" aria-label="Opiniones de clientes"><div className="section-head"><div><span className="eyebrow">EXPERIENCIAS REALES</span><h2>Historias que ya avanzaron.</h2></div><p>La confianza también se construye con experiencias compartidas.</p></div><div className="testimonials-grid">{testimonials.map((item, index) => <article className="testimonial-card" key={`${item.name}-${index}`}><span className="testimonial-mark" aria-hidden="true">“</span><blockquote>{item.quote}</blockquote><footer><strong>{item.name}</strong><span>{item.detail}</span></footer></article>)}</div></section>;
}

function LocationSection({ settings = {} }) {
  const address = String(settings.address || "").trim();
  const hours = String(settings.hours || "").trim();
  if (!address && !hours) return null;
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || getBrandName())}`;
  return <section className="location-section" id="ubicacion" aria-label="Ubicación y horario"><div><span className="eyebrow">VISÍTANOS</span><h2>Ven a conocerlo en persona.</h2><p>Si quieres verlo con calma, aquí tienes la información del showroom.</p></div><div className="location-details">{address && <div><strong>Ubicación</strong><p>{address}</p><a href={mapHref} target="_blank" rel="noreferrer">Cómo llegar ↗</a></div>}{hours && <div><strong>Horario de atención</strong><p>{hours}</p></div>}</div></section>;
}

function CookieConsentBanner() {
  const [visible, setVisible] = useState(() => localStorage.getItem("authentiq_cookie_consent") !== "accepted");
  if (!visible || window.location.pathname.startsWith("/backoffice")) return null;
  const accept = () => { localStorage.setItem("authentiq_cookie_consent", "accepted"); setVisible(false); };
  const reject = () => { localStorage.setItem("authentiq_cookie_consent", "rejected"); setVisible(false); };
  return <aside className="cookie-consent" role="dialog" aria-label="Preferencias de cookies"><div><strong>Tu privacidad importa.</strong><p>Usamos cookies esenciales para que el showroom funcione. La analítica solo se activa si la aceptas.</p></div><div className="cookie-consent-actions"><button type="button" className="secondary-action" onClick={reject}>Solo esenciales</button><button type="button" className="primary-action" onClick={accept}>Aceptar analítica</button></div></aside>;
}

function BlogSection({ posts }) {
  if (!posts.length) return null;
  return <section className="blog-public" id="journal"><div className="section-head"><div><span className="eyebrow">JOURNAL · {getBrandName()}</span><h2>Ideas para conducir mejor.</h2></div><p>Guías, historias y cultura automotriz.</p></div><div className="blog-public-grid">{posts.map((post) => <article className="blog-public-card" key={post.id}>{post.coverImageUrl && <img src={post.coverImageUrl} alt="" />}{!post.coverImageUrl && <div className="blog-public-placeholder" />}<div><span className="eyebrow">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : getBrandName()}</span><h3>{post.title}</h3>{post.category && <span className="blog-category">{post.category}</span>}{post.tags?.length > 0 && <small className="blog-tags">{post.tags.join(" · ")}</small>}<p>{post.summary}</p><a href={`/blog/${post.slug}`}>Leer artículo →</a></div></article>)}</div></section>;
}

function BlogArticle({ slug, onBack }) {
  const [post, setPost] = useState(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    setStatus("loading");
    fetch(`${apiUrl}/api/blog/${encodeURIComponent(slug)}`)
      .then((response) => { if (!response.ok) throw new Error("Artículo no encontrado"); return response.json(); })
      .then((payload) => { setPost(payload.data); setStatus("ready"); })
      .catch(() => setStatus("error"));
  }, [slug]);
  // El artículo publica sus propios metadatos: antes heredaba los genéricos del sitio
  // y cualquier enlace compartido mostraba el título y la imagen del catálogo.
  useEffect(() => {
    if (!post) { setRobots(status !== "error"); return; }
    const baseTitle = post.seoTitle || post.title;
    // El SEO title guardado a veces ya incluye la marca (dato heredado del seed):
    // no se duplica el sufijo cuando ya termina en "AUTHENTIQ".
    const title = /authentiq\s*$/i.test(baseTitle.trim()) ? baseTitle.trim() : `${baseTitle} · AUTHENTIQ`;
    const description = post.seoDescription || post.summary || `${post.title} · Journal de AUTHENTIQ`;
    const image = post.coverImageUrl || "/assets/hero-highway.webp";
    document.title = title;
    setMeta('meta[name="description"]', "description", description);
    setMeta('meta[property="og:title"]', "og:title", post.seoTitle || post.title);
    setMeta('meta[property="og:description"]', "og:description", description);
    setMeta('meta[property="og:type"]', "og:type", "article");
    setMeta('meta[property="og:image"]', "og:image", new URL(image, window.location.origin).href);
    setMeta('meta[property="og:url"]', "og:url", window.location.href.split("#")[0]);
    setMeta('meta[name="twitter:card"]', "twitter:card", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "twitter:title", post.seoTitle || post.title);
    setMeta('meta[name="twitter:description"]', "twitter:description", description);
    setMeta('meta[name="twitter:image"]', "twitter:image", new URL(image, window.location.origin).href);
    setCanonical(`${window.location.origin}/blog/${post.slug}`);
    setRobots(true);
    const structured = document.createElement("script");
    structured.type = "application/ld+json";
    structured.dataset.authentiqArticle = "true";
    structured.textContent = JSON.stringify({
      "@context": "https://schema.org", "@type": "Article",
      headline: post.title, description, image: [new URL(image, window.location.origin).href],
      datePublished: post.publishedAt || undefined,
      publisher: { "@type": "Organization", name: "AUTHENTIQ" },
    }).replace(/</g, "\\u003c");
    document.head.appendChild(structured);
    return () => structured.remove();
  }, [post, status]);
  if (status === "loading") return <main className="article-page"><button className="back-button" onClick={onBack}>← Volver al catálogo</button><p className="state-message">Cargando artículo…</p></main>;
  if (status === "error" || !post) return <main className="article-page"><button className="back-button" onClick={onBack}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">AUTHENTIQ · JOURNAL</span><h1>Este artículo ya no está disponible.</h1><p>Puede haber sido archivado o la dirección puede haber cambiado.</p></section></main>;
  return <main className="article-page"><button className="back-button" onClick={onBack}>← Volver al catálogo</button><article className="article-body"><header><span className="eyebrow">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("es-DO", { day: "2-digit", month: "long", year: "numeric" }) : "AUTHENTIQ · JOURNAL"}</span><h1>{post.title}</h1>{post.summary && <p className="article-summary">{post.summary}</p>}</header>{post.coverImageUrl && <img className="article-cover" src={publicMediaUrl(post.coverImageUrl)} alt={post.title} /> }<div className="article-content">{post.content.split(/\r?\n/).map((paragraph, index) => paragraph.trim() ? <p key={`${post.id}-${index}`}>{paragraph}</p> : <br key={`${post.id}-space-${index}`} />)}</div></article></main>;
}

function DetailTrustStrip({ vehicle, onTradeIn }) {
  return <section className="detail-trust-strip" aria-label="Compromisos del showroom"><div><span className="detail-trust-mark">01</span><strong>{vehicle.status === "reserved" ? "Reserva en curso" : "Disponibilidad visible"}</strong><p>{vehicle.location ? `Ubicado en ${vehicle.location}. Confirma la visita con el equipo.` : "El equipo confirma disponibilidad antes de tu visita."}</p></div><div><span className="detail-trust-mark">02</span><strong>{vehicle.warranty || "Atención 1:1"}</strong><p>{vehicle.warranty ? "Cobertura informada por el concesionario." : "Un asesor acompaña el siguiente paso."}</p></div><div><span className="detail-trust-mark">03</span><strong>Renueva con contexto</strong><p>¿Tienes vehículo actual? Cuéntanos y prepara una conversación más completa.</p><button type="button" className="detail-trust-action" onClick={onTradeIn}>Solicitar orientación →</button></div></section>;
}

function similarityScore(source, candidate) {
  if (!source || source.id === candidate.id) return -Infinity;
  const sourcePrice = Number(source.priceUsd) || 0;
  const candidatePrice = Number(candidate.priceUsd) || 0;
  const priceDistance = sourcePrice ? Math.abs(candidatePrice - sourcePrice) / sourcePrice : 1;
  const yearDistance = Math.abs(Number(source.year || 0) - Number(candidate.year || 0));
  return (source.category && source.category === candidate.category ? 8 : 0)
    + (source.brand && source.brand === candidate.brand ? 3 : 0)
    + (source.fuelType && source.fuelType === candidate.fuelType ? 1 : 0)
    + (source.transmission && source.transmission === candidate.transmission ? 1 : 0)
    + (priceDistance <= 0.15 ? 3 : priceDistance <= 0.25 ? 1 : 0)
    + (yearDistance <= 2 ? 1 : 0);
}

function similarityReason(source, candidate) {
  const sourcePrice = Number(source.priceUsd) || 0;
  const candidatePrice = Number(candidate.priceUsd) || 0;
  if (source.category && source.category === candidate.category) return `Misma categoría${candidatePrice < sourcePrice ? " · precio menor" : ""}`;
  if (Math.abs(candidatePrice - sourcePrice) / Math.max(sourcePrice, 1) <= 0.15) return "Precio similar";
  if (Number(candidate.year) > Number(source.year)) return "Modelo más reciente";
  if (source.fuelType && source.fuelType === candidate.fuelType) return `Mismo combustible · ${candidate.fuelType}`;
  return "Alternativa de la selección";
}

function SimilarVehicles({ vehicle, vehicles, compareVehicles, favoriteIds, whatsapp = "", businessName = getBrandName(), onOpen, onToggleCompare, onToggleFavorite, onQuickAction }) {
  const similar = useMemo(() => vehicles
    .filter((candidate) => ["published", "reserved"].includes(candidate.status))
    .map((candidate) => ({ vehicle: candidate, score: similarityScore(vehicle, candidate) }))
    .filter((item) => Number.isFinite(item.score) && item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.vehicle), [vehicle, vehicles]);
  if (!similar.length) return null;
  return <section className="similar-vehicles" aria-label="Vehículos similares"><div className="section-head"><div><span className="eyebrow">SIGUE EXPLORANDO</span><h2>Si te gusta este, mira estos.</h2></div><p>Alternativas seleccionadas desde el inventario actual.</p></div><div className="similar-vehicle-grid">{similar.map((candidate, index) => <div className="similar-vehicle-item" key={candidate.id}><span className="similar-vehicle-reason">{similarityReason(vehicle, candidate)}</span><VehicleCard vehicle={candidate} isCompared={compareVehicles.some((item) => item.id === candidate.id)} isFavorite={favoriteIds.includes(candidate.id)} onOpen={onOpen} onToggleCompare={onToggleCompare} onToggleFavorite={onToggleFavorite} onQuickAction={onQuickAction} whatsapp={whatsapp} businessName={businessName} imageLoading={index < 2 ? "eager" : "lazy"} /></div>)}</div></section>;
}

function VehicleDecisionSummary({ vehicle }) {
  const categoryLabel = { suv: "SUV", sports: "Deportivo", sedan: "Sedán", coupe: "Coupé", truck: "Pickup" }[vehicle.category] || vehicle.category || "Selección premium";
  const categoryCopy = { suv: "Espacio, altura y presencia para moverte con confianza.", sports: "Respuesta, diseño y una experiencia más emocionante.", sedan: "Confort y equilibrio para el uso diario.", coupe: "Una silueta especial para disfrutar cada trayecto.", truck: "Capacidad y carácter para trabajar o salir de ruta." }[vehicle.category] || "Un modelo elegido por su carácter y configuración.";
  const conditionLabel = vehicle.condition === "new" ? "Unidad nueva" : "Inventario certificado";
  const conditionCopy = vehicle.condition === "new" ? "Configuración actual y entrega sujeta a disponibilidad." : "Una alternativa revisada para comprar con mayor tranquilidad.";
  const usageLabel = vehicle.transmission || vehicle.fuelType || "Configuración premium";
  const usageCopy = vehicle.transmission ? `Una conducción ${vehicle.transmission.toLowerCase()} para el día a día.` : "Especificaciones pensadas para una experiencia premium.";
  const consideration = vehicle.condition === "used" ? "Revisa el kilometraje, la garantía y el historial con el asesor." : "Confirma fecha de entrega, versión exacta y equipamiento disponible.";
  return <section className="detail-decision-summary" aria-label="Resumen de decisión"><div className="detail-decision-summary-head"><span className="eyebrow">DECISIÓN EN CLARO</span><p>Lo esencial antes de comparar cada especificación.</p></div><div className="detail-decision-summary-grid"><article><span>01</span><strong>{categoryLabel}</strong><p>{categoryCopy}</p></article><article><span>02</span><strong>{conditionLabel}</strong><p>{conditionCopy}</p></article><article><span>03</span><strong>{usageLabel}</strong><p>{usageCopy}</p></article></div><p className="detail-decision-consideration"><strong>Antes de decidir:</strong> {consideration}</p></section>;
}

function DetailGalleryPanel({ vehicle, imageCount }) {
  const categoryLabel = { suv: "SUV", sports: "SPORTS", sedan: "SEDÁN", coupe: "COUPÉ", truck: "PICKUP" }[vehicle.category] || "SELECCIÓN PREMIUM";
  const studioId = vehicle.media?.some((item) => item.type === "model_3d") ? "vehicle-3d-viewer" : "vehicle-studio";
  return <section className="detail-gallery-panel" aria-label="Estudio visual del vehículo"><div className="detail-gallery-panel-head"><span>{getBrandName()} / VISUAL STUDY</span><strong>{String(imageCount).padStart(2, "0")} VISTAS</strong></div><div className="detail-gallery-panel-mark">{vehicle.model}</div><div className="detail-gallery-panel-info"><span>{vehicle.exteriorColor || "Exterior seleccionado"}</span><span>{categoryLabel} · {vehicle.year}</span></div><p>Una presencia pensada para verse desde todos los ángulos. Explora el vehículo con calma.</p><button className="detail-gallery-panel-link" type="button" onClick={() => document.getElementById(studioId)?.scrollIntoView({ behavior: "smooth", block: "start" })}>Abrir estudio <span>↘</span></button><div className="detail-gallery-notes"><span><b>01</b><strong>Silueta</strong><em>{categoryLabel.toLowerCase()} de carácter deportivo</em></span><span><b>02</b><strong>Exterior</strong><em>{vehicle.exteriorColor || "Configuración seleccionada"}</em></span><span><b>03</b><strong>Configuración</strong><em>{vehicle.engine || vehicle.transmission || "Especificación premium"}</em></span></div><div className="detail-gallery-panel-index">{vehicle.brand} · {vehicle.model}</div></section>;
}

function DetailGalleryEditorial({ vehicle }) {
  const presence = vehicle.exteriorColor ? `Una presencia definida por su acabado ${vehicle.exteriorColor.toLowerCase()}.` : "Una presencia definida por su diseño y proporciones.";
  const response = vehicle.power || vehicle.transmission ? `${vehicle.power || "Respuesta equilibrada"}${vehicle.transmission ? ` · ${vehicle.transmission}` : ""}.` : "Una configuración pensada para disfrutar cada trayecto.";
  const confidence = vehicle.condition === "new" ? "Unidad nueva, sujeta a disponibilidad de entrega." : `${vehicle.warranty || "Inventario revisado"}.`;
  return <section className="detail-gallery-editorial" aria-label="Lectura editorial del vehículo"><div className="detail-gallery-editorial-head"><span className="eyebrow">CURATED NOTE / {vehicle.brand}</span><span>{vehicle.year} · {vehicle.category || "PREMIUM"}</span></div><h3>Una selección que se entiende mejor cuando la miras de cerca.</h3><div className="detail-gallery-editorial-grid"><div><span>01</span><strong>Presencia</strong><p>{presence}</p></div><div><span>02</span><strong>Respuesta</strong><p>{response}</p></div><div><span>03</span><strong>Confianza</strong><p>{confidence}</p></div></div><div className="detail-gallery-editorial-footer"><span>{getBrandName()} / PRIVATE SELECTION</span><span>Elegido para ser visto con calma.</span></div></section>;
}

function VehicleDetail({ vehicle, vehicles = [], onBack, isFavorite = false, onToggleFavorite = () => {}, customerToken = "", compareVehicles = [], favoriteIds = [], onOpenVehicle = () => {}, onToggleCompare = () => {}, whatsapp = "" }) {
  const whatsappNumber = String(whatsapp || "").replace(/\D/g, "");
  const whatsappText = encodeURIComponent(`Hola, me interesa el ${vehicle.brand} ${vehicle.model}${vehicle.year ? ` ${vehicle.year}` : ""}: ${window.location.origin}${vehiclePath(vehicle)}`);
  const whatsappHref = `https://wa.me/${whatsappNumber}?text=${whatsappText}`;
  const [shareStatus, setShareStatus] = useState("");
  const shareVehicle = async () => { try { const result = await shareOrCopyUrl(`${window.location.origin}${vehiclePath(vehicle)}`, `${vehicle.brand} ${vehicle.model}`); setShareStatus(result === "copied" ? "URL copiada" : result === "shared" ? "Compartido" : "No disponible"); window.setTimeout(() => setShareStatus(""), 2200); } catch { setShareStatus(""); } };
  const [activeImage, setActiveImage] = useState(0);
  const [leadType, setLeadType] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [priceAlertOpen, setPriceAlertOpen] = useState(false);
  const [tradeInOpen, setTradeInOpen] = useState(false);
  const [appliedFinancing, setAppliedFinancing] = useState(null);
  const [quickVehicle, setQuickVehicle] = useState(null);
  const images = vehicle.images?.length ? vehicle.images : [{ url: "/assets/hero-highway.webp" }];
  const image = publicMediaUrl(images[activeImage]?.url || images[0].url);
  const imageAlt = images[activeImage]?.altText || images[0]?.altText || `${vehicle.brand} ${vehicle.model}`;
  const structuredData = JSON.stringify({ "@context": "https://schema.org", "@type": "Vehicle", name: `${vehicle.brand} ${vehicle.model}`, model: vehicle.model, vehicleConfiguration: vehicle.variant || undefined, fuelType: vehicle.fuelType || undefined, color: vehicle.exteriorColor || undefined, brand: { "@type": "Brand", name: vehicle.brand }, vehicleModelDate: String(vehicle.year), image: images.map((item) => new URL(publicMediaUrl(item.url), window.location.origin).href), mileageFromOdometer: { "@type": "QuantitativeValue", value: Number(vehicle.mileageKm), unitCode: "KMT" }, offers: { "@type": "Offer", priceCurrency: "USD", price: Number(vehicle.priceUsd), availability: vehicle.status === "published" ? "https://schema.org/InStock" : "https://schema.org/LimitedAvailability" } }).replace(/</g, "\\u003c");
  useEffect(() => {
    const model = vehicle.media?.find((item) => item.type === "model_3d");
    if (model?.posterUrl) ensurePreload(publicMediaUrl(model.posterUrl), "image");
  }, [vehicle.id, vehicle.media]);

  // La galería ampliada ocupa toda la pantalla: quien navega con teclado debe
  // poder salir y no tabular hacia el catálogo que queda detrás.
  useAccessibleDialog(() => setLightboxOpen(false), lightboxOpen);

  return (
    <motion.main
      className="detail-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <div className="detail-topbar"><button className="back-button" onClick={onBack}>Volver al catálogo</button><span className="detail-topbar-context">{vehicle.brand} · {vehicle.model}</span><a href="#similar-vehicles" className="detail-topbar-link">Ver similares ↓</a></div>
      <Breadcrumbs vehicle={vehicle} />
      <section className="detail-grid">
        <div>
          <div className="detail-image-wrap" role="button" tabIndex="0" aria-label="Ampliar imagen" onClick={() => setLightboxOpen(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setLightboxOpen(true); }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={image}
                src={publicMediaUrl(image)}
                alt={imageAlt}
                className="detail-image"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              />
            </AnimatePresence>
          </div>
          <ProgressiveBlur className="detail-thumbs-frame">
            <div className="thumbs">
              {images.map((item, index) => (
              <button
                key={item.id || item.url}
                className={index === activeImage ? "thumb active" : "thumb"}
                type="button"
                onClick={() => setActiveImage(index)}
                aria-label={`Ver imagen ${index + 1} de ${vehicle.brand} ${vehicle.model}`}
                aria-pressed={index === activeImage}
              >
                <img src={publicMediaUrl(item.url)} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          </ProgressiveBlur>
          <DetailGalleryPanel vehicle={vehicle} imageCount={images.length} />
          <DetailGalleryEditorial vehicle={vehicle} />
        </div>
        <div className="detail-copy">
          <div className="detail-brand-line"><BrandLogo brand={vehicle.brand} logoUrl={vehicle.brandLogoUrl} /><span className="eyebrow">{vehicle.condition === "new" ? "NUEVO INVENTARIO" : "INVENTARIO CERTIFICADO"}</span></div>
          <h1>{vehicle.brand} <em>{vehicle.model}</em></h1>
          {vehicle.variant && <p className="detail-variant">{vehicle.variant}</p>}
          <p className="detail-price">{formatPrice(vehicle.priceUsd)}</p>
          <div className="specs">
            {[
              ["Motor", vehicle.engine],
              ["Potencia", vehicle.power, "Fuerza disponible del motor."],
              ["Transmisión", vehicle.transmission],
              ["Tracción", vehicle.drive, "Indica qué ruedas reciben la fuerza del motor."],
              ["Combustible", vehicle.fuelType],
              ["Exterior", vehicle.exteriorColor],
              ["Interior", vehicle.interiorColor],
              ["Puertas / asientos", vehicle.doors || vehicle.seats ? `${vehicle.doors || "—"} / ${vehicle.seats || "—"}` : null],
              ["Kilometraje", `${Number(vehicle.mileageKm).toLocaleString("en-US")} km`],
              ["Ubicación", vehicle.location],
              ["Inventario", vehicle.stockNumber],
              ["Garantía", vehicle.warranty],
            ].map(([label, value, hint]) => <div className="spec-row" key={label}><span>{label}{hint && <span className="spec-tooltip" tabIndex="0" title={hint} aria-label={`${label}: ${hint}`}>?</span>}</span><strong>{value || "—"}</strong></div>)}
          </div>
          <details className="specs-glossary">
            <summary>¿Qué significan estos datos?</summary>
            <p><strong>Potencia</strong> es la fuerza disponible del motor. <strong>Tracción</strong> indica qué ruedas reciben esa fuerza. <strong>Transmisión</strong> explica cómo cambia las marchas. <strong>Cilindrada</strong> es el tamaño total del motor. <strong>Torque</strong> es la fuerza para acelerar. <strong>Consumo</strong> indica cuánto combustible usa por distancia.</p>
          </details>
          <FinanceCalculator
            price={vehicle.priceUsd}
            vehicle={vehicle}
            onApplyFinancing={(terms) => {
              setAppliedFinancing(terms);
              setQuickVehicle(null);
              setQuoteOpen(true);
            }}
          />
          <div className="detail-experience-actions">
            <button className="detail-utility-action test-drive-link" type="button" onClick={() => { setQuickVehicle(null); setLeadType("test-drive"); }}>Agenda tu cita →</button>
            <button className="detail-utility-action studio-jump" type="button" onClick={() => document.getElementById(vehicle.media?.some((item) => item.type === "model_3d") ? "vehicle-3d-viewer" : "vehicle-studio")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{vehicle.media?.some((item) => item.type === "model_3d") ? "Explorar modelo 3D ↓" : "Explorar Studio ↓"}</button>
          </div>
          <div className="detail-actions">
            <button className="primary-action" type="button" onClick={() => { setQuickVehicle(null); setLeadType("offer"); }} disabled={vehicle.status === "reserved"}>{vehicle.status === "reserved" ? "Vehículo reservado" : "Hacer una oferta"}</button>
            <button className="secondary-action" type="button" onClick={() => { setQuickVehicle(null); setQuoteOpen(true); }}>Generar cotización PDF</button>
          </div>
          <div className="detail-utilities">
            <ShareAction vehicle={vehicle} />
            <button className={`detail-utility-action favorite-detail-action ${isFavorite ? "is-selected" : ""}`} type="button" onClick={() => onToggleFavorite(vehicle)}>{isFavorite ? "Guardado en favoritos ♥" : "Guardar en favoritos ♡"}</button>
            <button className="detail-utility-action" type="button" onClick={() => setPriceAlertOpen(true)}>🔔 Avisarme si baja de precio</button>
            <button className="detail-utility-action" type="button" onClick={() => window.print()}>📄 Ficha Técnica / Imprimir</button>
            {whatsappNumber ? <a className="detail-utility-action" href={whatsappHref} target="_blank" rel="noreferrer" onClick={() => trackEvent("whatsapp_click", { vehicleId: vehicle.id })}>Contactar por WhatsApp ↗</a> : <button className="detail-utility-action" type="button" onClick={shareVehicle}>Compartir ficha ↗</button>}{shareStatus && <span className="detail-share-status" role="status">{shareStatus}</span>}
          </div>
          {vehicle.description && <div className="detail-description"><span className="eyebrow">SOBRE ESTE VEHÍCULO</span><p>{vehicle.description}</p></div>}
          {!!vehicle.features?.length && <div className="detail-features"><span className="eyebrow">EQUIPAMIENTO DESTACADO</span><div>{vehicle.features.map((feature) => <span key={feature}>{feature}</span>)}</div></div>}
          <VehicleDecisionSummary vehicle={vehicle} />
          <p className="phase-note">Las solicitudes se guardan y aparecen en tu panel para revisión.</p>
        </div>
      </section>
      <SectionBoundary name="estudio visual" message="El visor multimedia no pudo mostrarse. Los datos y la galería del vehículo siguen disponibles."><VehicleStudio vehicle={vehicle} images={images} /></SectionBoundary>
      <DetailTrustStrip vehicle={vehicle} onTradeIn={() => setTradeInOpen(true)} />
      <div id="similar-vehicles"><SimilarVehicles vehicle={vehicle} vehicles={vehicles} compareVehicles={compareVehicles} favoriteIds={favoriteIds} whatsapp={whatsapp} businessName={getBrandName()} onOpen={onOpenVehicle} onToggleCompare={onToggleCompare} onToggleFavorite={onToggleFavorite} onQuickAction={(item, action) => { setQuickVehicle(item); if (action === "quote") setQuoteOpen(true); else setLeadType("test-drive"); }} /></div>
      <aside className="detail-decision-bar" aria-label="Acciones principales del vehículo">
        <div>
          <span className="eyebrow">SIGUIENTE PASO</span>
          <strong>{formatPrice(vehicle.priceUsd)}</strong>
          <p>{vehicle.status === "reserved" ? "Este vehículo está reservado. Podemos avisarte si vuelve a estar disponible." : "Un asesor responde tu solicitud con la información completa del vehículo."}</p>
        </div>
        <span className="detail-decision-vehicle">{vehicle.brand} {vehicle.model} · {vehicle.year}</span>
        <div className="detail-decision-actions">
          <button className="primary-action" type="button" onClick={() => { setQuickVehicle(null); setLeadType("offer"); }} disabled={vehicle.status === "reserved"}>{vehicle.status === "reserved" ? "Reservado" : "Hacer una oferta"}</button>
          <button className="secondary-action" type="button" onClick={() => { setQuickVehicle(null); setQuoteOpen(true); }}>Cotización</button>
        </div>
      </aside>
      <div className="detail-mobile-actions" aria-label="Acciones rápidas del vehículo">
        <button className="primary-action" type="button" onClick={() => setLeadType("offer")} disabled={vehicle.status === "reserved"}>{vehicle.status === "reserved" ? "Reservado" : "Hacer una oferta"}</button>
        <button className="secondary-action" type="button" onClick={() => setLeadType("test-drive")}>Agendar cita</button>
        {whatsappNumber ? <a className="detail-mobile-whatsapp" href={whatsappHref} target="_blank" rel="noreferrer" aria-label="Contactar al concesionario por WhatsApp" onClick={() => trackEvent("whatsapp_click", { vehicleId: vehicle.id })}>WhatsApp</a> : <button className="detail-mobile-whatsapp" type="button" onClick={shareVehicle}>Compartir</button>}
      </div>
      <AnimatePresence>{leadType === "offer" && <LeadForm vehicle={quickVehicle || vehicle} customerToken={customerToken} onClose={() => { setLeadType(null); setQuickVehicle(null); }} />}</AnimatePresence>
      <AnimatePresence>{leadType === "test-drive" && <TestDriveModal vehicle={quickVehicle || vehicle} onClose={() => { setLeadType(null); setQuickVehicle(null); }} />}</AnimatePresence>
      <AnimatePresence>{quoteOpen && <QuoteModal vehicle={quickVehicle || vehicle} financingTerms={appliedFinancing} onClose={() => { setQuoteOpen(false); setQuickVehicle(null); setAppliedFinancing(null); }} />}</AnimatePresence>
      <AnimatePresence>{priceAlertOpen && <PriceAlertModal vehicle={quickVehicle || vehicle} onClose={() => setPriceAlertOpen(false)} />}</AnimatePresence>
      <AnimatePresence>{tradeInOpen && <BuyerRequestModal kind="trade-in" vehicle={vehicle} onClose={() => setTradeInOpen(false)} />}</AnimatePresence>
      <AnimatePresence>{lightboxOpen && <motion.div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Galería ampliada" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setLightboxOpen(false); }}><button className="modal-close" type="button" onClick={() => setLightboxOpen(false)} aria-label="Cerrar imagen">×</button><img src={image} alt={`${vehicle.brand} ${vehicle.model}, imagen ${activeImage + 1}`} /></motion.div>}</AnimatePresence>
    </motion.main>
  );
}

const institutionalContent = {
  contact: {
    eyebrow: "AUTHENTIQ · CONTACTO",
    title: <>Hablemos de tu <em>próximo vehículo.</em></>,
    intro: "Nuestro equipo está disponible para orientarte sobre inventario y ofertas.",
    sections: [
      ["Atención comercial", "Usa el formulario de contacto del catálogo para dejar tus datos y te responderemos personalmente."],
      ["Ubicación", "La dirección y el horario de atención se configurarán antes de la publicación final."],
    ],
  },
  location: {
    eyebrow: "AUTHENTIQ · UBICACIÓN",
    title: <>Encuéntranos <em>en persona.</em></>,
    intro: "La experiencia AUTHENTIQ está pensada para conocer cada vehículo con calma y confianza.",
    sections: [["Showroom", "La dirección del showroom, el mapa y el horario serán agregados cuando el negocio confirme esos datos."]],
  },
  privacy: {
    eyebrow: "AUTHENTIQ · PRIVACIDAD",
    title: <>Tus datos, tratados con <em>respeto.</em></>,
    intro: "Esta página resume el compromiso de AUTHENTIQ con la protección de la información de sus clientes.",
    sections: [["Aviso importante", "El texto legal definitivo, la entidad responsable y los canales de privacidad están pendientes de aprobación antes del lanzamiento público."], ["Mientras tanto", "Solo solicitamos los datos necesarios para responder consultas y ofertas."]],
  },
  terms: {
    eyebrow: "AUTHENTIQ · TÉRMINOS",
    title: <>Una experiencia clara, de principio a <em>fin.</em></>,
    intro: "La información del catálogo está sujeta a confirmación comercial y disponibilidad.",
    sections: [["Aviso importante", "Los términos y condiciones definitivos, incluyendo jurisdicción, reservas y políticas de compra, están pendientes de aprobación antes del lanzamiento público."], ["Disponibilidad", "Enviar una oferta no constituye una compra ni una reserva confirmada."]],
  },
};

function InstitutionalPage({ type, settings = {}, onBack }) {
  const content = institutionalContent[type] || institutionalContent.contact;
  const brand = settings.businessName || getBrandName();
  const configuredSections = type === "location" ? [["Showroom", settings.address || "La dirección del showroom será publicada cuando el negocio confirme esos datos."], ["Horario", settings.hours || "Horario pendiente de confirmación."]] : type === "privacy" ? [["Política vigente", settings.privacyText || content.sections[0][1]]] : type === "terms" ? [["Términos vigentes", settings.termsText || content.sections[0][1]]] : content.sections;
  return <motion.main className="institutional-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24, ease: "easeOut" }}>
    <button className="back-button" onClick={onBack}>← Volver al catálogo</button>
    <section className="institutional-hero"><span className="eyebrow">{content.eyebrow.replace(/AUTHENTIQ/g, brand)}</span><h1>{content.title}</h1><p>{content.intro.replace(/AUTHENTIQ/g, brand)}</p></section>
    <section className="institutional-sections">{configuredSections.map(([heading, text]) => <article key={heading}><span className="eyebrow">{heading}</span><p>{text}</p></article>)}</section>
  </motion.main>;
}

function CompareDock({ vehicles, onRemove, onClear }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!vehicles.length) return null;
  return <aside className={`compare-dock ${collapsed ? "is-collapsed" : ""}`} aria-label="Comparador de vehículos"><div className="compare-dock-head"><div><span className="eyebrow">SELECCIÓN INTELIGENTE</span><strong>Comparar vehículos <small>{vehicles.length}/3</small></strong></div><div className="compare-dock-actions"><button className="compare-collapse" type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? "Desplegar comparador" : "Plegar comparador"}><NavIcon name={collapsed ? "chevronUp" : "chevronDown"} /></button><button className="text-button" type="button" onClick={onClear}>Limpiar</button></div></div>{!collapsed && <><div className="compare-grid">{vehicles.map((vehicle) => <article key={vehicle.id} className="compare-item"><button type="button" className="compare-remove" onClick={() => onRemove(vehicle.id)} aria-label={`Quitar ${vehicle.model}`}>×</button><img src={publicMediaUrl(vehicle.images?.[0]?.url) || "/assets/hero-highway.webp"} alt="" loading="lazy" decoding="async" /><strong>{vehicle.brand} {vehicle.model}</strong><span>{formatPrice(vehicle.priceUsd)}</span></article>)}</div><div className="compare-summary"><span>{vehicles.length > 1 ? "Revisa precio, potencia y kilometraje de tus favoritos." : "Añade un modelo más para activar la comparación."}</span>{vehicles.length > 1 ? <a href="#compare-table">Ver comparación ↓</a> : <a href="#catalog">Seguir explorando ↓</a>}</div></>}</aside>;
}

function CompareTable({ vehicles }) {
  if (vehicles.length < 2) return <section className="compare-table-section compare-table-empty" id="compare-table"><div className="compare-empty-mark">{vehicles.length ? "01" : "00"}</div><div><span className="eyebrow">COMPARACIÓN / {vehicles.length}/2 MÍNIMO</span><h2>{vehicles.length ? "Elige un modelo más." : "Compara antes de decidir."}</h2><p>{vehicles.length ? "Ya tienes un vehículo seleccionado. Añade otro desde cualquier tarjeta para ver precio, potencia, kilometraje y ficha técnica en paralelo." : "Selecciona hasta tres vehículos y revisa sus diferencias en una sola vista, sin perder tu selección."}</p><a className="detail-utility-action" href="#catalog">Explorar inventario ↓</a></div></section>;
  const rows = [["Precio", (vehicle) => formatPrice(vehicle.priceUsd)], ["Año", (vehicle) => vehicle.year], ["Versión", (vehicle) => vehicle.variant || "—"], ["Combustible", (vehicle) => vehicle.fuelType || "—"], ["Transmisión", (vehicle) => vehicle.transmission || "—"], ["Potencia", (vehicle) => vehicle.power || "—"], ["Kilometraje", (vehicle) => `${Number(vehicle.mileageKm || 0).toLocaleString("en-US")} km`], ["Tracción", (vehicle) => vehicle.drive || "—"], ["Ubicación", (vehicle) => vehicle.location || "—"]];
  return <section className="compare-table-section" id="compare-table"><div className="section-head"><div><span className="eyebrow">COMPARACIÓN</span><h2>Decide con claridad.</h2></div><p>{vehicles.length} vehículos seleccionados</p></div><div className="compare-vehicle-rail" style={{ "--compare-columns": vehicles.length }} aria-label="Modelos seleccionados para comparar">{vehicles.map((vehicle, index) => <article className="compare-vehicle-card" key={vehicle.id}><img src={publicMediaUrl(vehicle.images?.[0]?.url) || "/assets/hero-highway.webp"} alt={`${vehicle.brand} ${vehicle.model}`} loading="lazy" decoding="async" /><div><span className="eyebrow">0{index + 1} · {vehicle.year} · {vehicle.condition === "new" ? "NUEVO" : "CERTIFICADO"}</span><h3>{vehicle.brand} {vehicle.model}</h3><strong>{formatPrice(vehicle.priceUsd)}</strong><p><b>{vehicle.power || "—"}</b><span>Potencia</span></p></div></article>)}</div><div className="compare-table" style={{ "--compare-columns": vehicles.length }}><div className="compare-table-labels"><span>Modelo</span>{rows.map(([label]) => <span key={label}>{label}</span>)}</div>{vehicles.map((vehicle) => <div className="compare-column" key={vehicle.id}><strong>{vehicle.brand} {vehicle.model}</strong>{rows.map(([_label, value]) => <span key={_label}>{value(vehicle)}</span>)}</div>)}</div></section>;
}

function BrandRail({ vehicles, brands, onChooseBrand }) {
  if (!brands.length) return null;
  return <section id="brands" className="brand-rail-section" aria-label="Explorar por marca"><div className="brand-rail-heading"><div><span className="eyebrow">MARCAS ACTIVAS</span><h2>Encuentra tu próxima firma.</h2></div><a href="#catalog">VER TODO ↗</a></div><div className="brand-rail">{brands.map((item, index) => { const count = vehicles.filter((vehicle) => vehicle.brand === item).length; const representative = vehicles.find((vehicle) => vehicle.brand === item); return <button key={item} type="button" className="brand-rail-item has-inventory" onClick={() => onChooseBrand(item)}><BrandLogo brand={item} logoUrl={representative?.brandLogoUrl} /><strong>{item}</strong><small>{`${count} ${count === 1 ? "modelo" : "modelos"}`} <b>→</b></small></button>; })}</div></section>;
}

function RecentSelection({ vehicles, compareVehicles, favoriteIds, onOpen, onToggleCompare, onToggleFavorite }) {
  if (!vehicles.length) return null;
  return <section className="recent-selection" aria-label="Vehículos recientes"><div className="section-head"><div><span className="eyebrow">NUEVAS LLEGADAS</span><h2>Recién incorporados.</h2></div><p>Los últimos vehículos que llegaron a la selección.</p></div><div className="recent-vehicle-grid">{vehicles.slice(0, 4).map((vehicle, index) => <VehicleCard key={vehicle.id} vehicle={vehicle} isCompared={compareVehicles.some((item) => item.id === vehicle.id)} isFavorite={favoriteIds.includes(vehicle.id)} onOpen={onOpen} onToggleCompare={onToggleCompare} onToggleFavorite={onToggleFavorite} imageLoading={index < 2 ? "eager" : "lazy"} />)}</div></section>;
}

function RecentlyViewed({ vehicles, compareVehicles, favoriteIds, onOpen, onToggleCompare, onToggleFavorite }) {
  if (!vehicles.length) return null;
  return <section className="recently-viewed" aria-label="Vehículos vistos recientemente"><div className="section-head"><div><span className="eyebrow">TU SELECCIÓN</span><h2>Continúa explorando.</h2></div><p>Los modelos que acabas de revisar.</p></div><div className="recent-vehicle-grid">{vehicles.slice(0, 4).map((vehicle, index) => <VehicleCard key={vehicle.id} vehicle={vehicle} isCompared={compareVehicles.some((item) => item.id === vehicle.id)} isFavorite={favoriteIds.includes(vehicle.id)} onOpen={onOpen} onToggleCompare={onToggleCompare} onToggleFavorite={onToggleFavorite} imageLoading={index < 2 ? "eager" : "lazy"} />)}</div></section>;
}

function IntentRail({ categories, conditions, fuelTypes, onChoose }) {
  const intents = [
    ["all", "Ver todo", "La selección completa"],
    ...(categories.includes("suv") ? [["category:suv", "SUV", "Espacio y presencia"]] : []),
    ...(categories.includes("sports") ? [["category:sports", "Deportivo", "Respuesta y carácter"]] : []),
    ...(categories.includes("sedan") ? [["category:sedan", "Sedán", "Confort para cada trayecto"]] : []),
    ...(fuelTypes.includes("Electrico") ? [["fuel:Electrico", "Eléctrico", "Tecnología y silencio"]] : []),
    ...(conditions.includes("new") ? [["condition:new", "Nuevo", "Entrega y configuración"]] : []),
  ];
  return <section className="intent-rail" aria-label="Explorar por intención"><div className="intent-rail-copy"><span className="eyebrow">EMPIEZA POR LO QUE IMPORTA</span><h2>¿Qué estás buscando?</h2><p>Una primera orientación para encontrar tu próxima selección.</p></div><div className="intent-rail-options">{intents.map(([value, label, detail]) => <button type="button" className="intent-option" key={value} onClick={() => onChoose(value)}><strong>{label}</strong><span>{detail}</span><i>→</i></button>)}</div></section>;
}

function ShowroomTrustRail({ onTradeIn, onSearchAlert }) {
  return <section className="showroom-trust-rail" aria-label="Cómo comprar en este showroom"><div><span>01</span><strong>Explora sin presión</strong><p>Compara, guarda favoritos y revisa la información antes de hablar.</p></div><div><span>02</span><strong>Habla con contexto</strong><p>Agenda, cotiza o comparte el modelo exacto que estás evaluando.</p></div><div className="showroom-trust-action"><span>03</span><strong>Si aún no aparece</strong><p>Guarda una búsqueda o cuéntanos qué vehículo quieres renovar.</p><div><button type="button" onClick={onSearchAlert}>Guardar búsqueda</button><button type="button" onClick={onTradeIn}>Quiero tasar el mío</button></div></div></section>;
}

function ModelLineRail({ vehicles, selectedBrand, onChooseLine }) {
  const lines = useMemo(() => {
    const source = selectedBrand === "all" ? vehicles : vehicles.filter((vehicle) => vehicle.brand === selectedBrand);
    const seen = new Set();
    return source.filter((vehicle) => {
      const key = `${vehicle.brand}-${vehicle.model}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }, [vehicles, selectedBrand]);
  if (!lines.length) return null;
  return <section id="models" className="model-lines-section" aria-label="Explorar líneas y modelos"><div className="section-head"><div><span className="eyebrow">LÍNEAS DE MODELO</span><h2>Encuentra la versión correcta.</h2></div><p>Explora por familia y llega directo al inventario disponible.</p></div><div className="model-line-rail">{lines.map((vehicle, index) => { const count = vehicles.filter((item) => item.brand === vehicle.brand && item.model === vehicle.model).length; return <button className="model-line-card" type="button" key={`${vehicle.brand}-${vehicle.model}`} onClick={() => onChooseLine(vehicle)}><span className="model-line-index">0{index + 1}</span><span className="model-line-copy"><strong>{vehicle.brand} {vehicle.model}</strong><small>{vehicle.category || "Vehículo premium"} · {vehicle.year} · {count} disponible{count === 1 ? "" : "s"}</small></span><span className="model-line-arrow">→</span></button>; })}</div></section>;
}

function FinancingSpotlight({ vehicles, onExplore }) {
  const [price, setPrice] = useState(null);
  const [downPayment, setDownPayment] = useState(20);
  const [months, setMonths] = useState(60);
  useEffect(() => {
    if (price === null && vehicles[0]?.priceUsd) setPrice(Math.round(Number(vehicles[0].priceUsd)));
  }, [price, vehicles]);
  const rate = 0.12 / 12;
  const numericPrice = Number(price) || 0;
  const principal = Math.max(numericPrice * (1 - downPayment / 100), 0);
  const payment = principal && rate ? principal * (rate * (1 + rate) ** months) / ((1 + rate) ** months - 1) : 0;
  const paymentLabel = numericPrice > 0 ? formatFinancePrice(payment) : "Introduce un precio";
  if (!vehicles.length) return null;
  return <section className="financing-spotlight" aria-label="Calculadora de financiamiento"><div className="financing-copy"><span className="eyebrow">COMPRA A TU RITMO</span><h2>Calcula una cuota orientativa.</h2><p>Hazte una idea del presupuesto mensual antes de hablar con un asesor. La aprobación final depende de la entidad financiera.</p><button type="button" className="secondary-action" onClick={onExplore}>Ver vehículos disponibles →</button></div><div className="financing-controls"><label>Precio del vehículo<input type="number" min="0" value={price ?? ""} aria-label="Precio del vehículo" onChange={(event) => setPrice(event.target.value === "" ? null : Number(event.target.value))} /></label><label>Inicial <output>{downPayment}%</output><input type="range" min="0" max="70" step="5" value={downPayment} aria-label="Porcentaje de inicial" onChange={(event) => setDownPayment(Number(event.target.value))} /></label><label>Plazo <output>{months} meses</output><input type="range" min="12" max="84" step="12" value={months} aria-label="Plazo de financiamiento en meses" onChange={(event) => setMonths(Number(event.target.value))} /></label><div className={`financing-result${numericPrice > 0 ? "" : " is-empty"}`} aria-live="polite" aria-atomic="true"><span>Cuota estimada</span>{numericPrice > 0 ? <><strong>{paymentLabel}</strong><small>12% anual · sin seguros ni gastos adicionales</small></> : <p>Introduce un precio para calcular.</p>}</div></div></section>;
}

function NavIcon({ name }) {
  const paths = { inventory: "M3 5h18M5 5v14h14V5M8 9h8M8 13h5", brands: "M4 6h16v12H4zM8 6v12M16 6v12", compare: "M5 5h5v14H5zM14 5h5v14h-5z", explore: "M12 3l2.8 5.7L21 10l-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 10l6.2-1.3z", menu: "M4 7h16M4 12h16M4 17h16", chevronUp: "m6 15 6-6 6 6", chevronDown: "m6 9 6 6 6-6", power: "M12 3v9m5.66-6.66a8 8 0 1 1-11.32 0" };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.inventory} /></svg>;
}

function ShowroomNav({ theme, setTheme, customer, onAccount, onBackoffice, onRegisterDealer, businessName = "AUTHENTIQ", logoUrl = "" }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const isScrolled = window.scrollY > 36;
      setScrolled(isScrolled);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [menuOpen]);
  const links = [["inventory", "Inventario", "#catalog"], ["brands", "Marcas", "#brands"], ["explore", "Modelos", "#models"], ["compare", "Comparar", "#compare-table"]];
  const closeMenu = () => setMenuOpen(false);
  const resolvedLogo = publicMediaUrl(logoUrl);
   return <nav className={`top-nav showroom-nav ${scrolled ? "is-scrolled" : ""}`} aria-label="Navegación principal"><a className="brand-mark showroom-nav-brand" href="#top" onClick={closeMenu}>{resolvedLogo ? <img src={resolvedLogo} alt={businessName} /> : businessName}<span>°</span></a><div className={`showroom-nav-links ${menuOpen ? "is-open" : ""}`}>{links.map(([icon, label, href]) => <a key={href} href={href} onClick={closeMenu}><NavIcon name={icon} /><span>{label}</span></a>)}<AnimatedThemeTogglerStarDemo theme={theme} onToggle={() => { setTheme((current) => current === "dark" ? "light" : "dark"); closeMenu(); }} /><button className="nav-admin-link account-launch" type="button" onClick={() => { onAccount(); closeMenu(); }}>{customer ? `CUENTA · ${customer.name.split(" ")[0].toUpperCase()}` : "MI CUENTA"}</button><button className="nav-admin-link nav-dealer-badge" type="button" onClick={() => { onRegisterDealer?.(); closeMenu(); }}>¿ERES CONCESIONARIO?</button><button className="nav-admin-link nav-backoffice-link" type="button" onClick={() => { onBackoffice(); closeMenu(); }}>PANEL DE CONTROL →</button></div><button className="showroom-nav-toggle" type="button" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}><NavIcon name={menuOpen ? "explore" : "menu"} /></button></nav>;
}

function PresentationMode({ vehicles, loading, onExit, onOpenVehicle, businessName = "AUTHENTIQ", logoUrl = "" }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduceMotion = useReducedMotion();
  const featured = vehicles.filter((vehicle) => vehicle.status === "published");
  const active = featured[activeIndex] || featured[0];
  const model3dCount = featured.filter((vehicle) => vehicle.media?.some((item) => item.type === "model_3d")).length;
  const resolvedLogo = publicMediaUrl(logoUrl);

  useEffect(() => {
    if (reduceMotion || paused || featured.length < 2) return undefined;
    const timer = window.setInterval(() => setActiveIndex((current) => (current + 1) % featured.length), 6500);
    return () => window.clearInterval(timer);
  }, [featured.length, paused, reduceMotion]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onExit();
      if (event.key === "ArrowRight") { setPaused(true); setActiveIndex((current) => (current + 1) % Math.max(featured.length, 1)); }
      if (event.key === "ArrowLeft") { setPaused(true); setActiveIndex((current) => (current - 1 + Math.max(featured.length, 1)) % Math.max(featured.length, 1)); }
      if (event.key === " ") { event.preventDefault(); setPaused((current) => !current); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [featured.length, onExit]);

  const selectModel = (index) => { setPaused(true); setActiveIndex(index); };
  if (loading) return <main className="presentation-page"><p className="state-message">Cargando selección...</p></main>;
  if (!active) return <main className="presentation-page"><button className="presentation-exit" type="button" onClick={onExit}>Salir</button><section className="presentation-empty"><span className="eyebrow">{businessName} · PRESENTACIÓN</span><h1>No hay vehículos publicados.</h1></section></main>;
  const image = publicMediaUrl(active.images?.[0]?.url) || "/assets/taycan-turbo-s-2.webp";
  return <main className="presentation-page">
    <header className="presentation-header">
      <span className="brand-mark">{resolvedLogo ? <img src={resolvedLogo} alt={businessName} /> : businessName}<span>°</span></span>
      <span className="presentation-mode-label">SHOWROOM · DEMO GUIADA</span>
      <div className="presentation-header-actions">
        <button className="presentation-control" type="button" onClick={() => setPaused((current) => !current)}>{paused ? "Reanudar" : "Pausar"}</button>
        <button className="presentation-exit" type="button" onClick={onExit}>Abrir catálogo</button>
      </div>
    </header>
    <section className="presentation-intro">
      <div>
        <span className="eyebrow">{businessName} · EXPERIENCIA COMERCIAL</span>
        <h1>Una selección que se explica sola.</h1>
        <p>Descubre cómo un concesionario puede presentar inventario, orientar la decisión y convertir interés en una conversación.</p>
        <div className="presentation-story" aria-label="Recorrido de la experiencia"><span><b>01</b> Descubre</span><span><b>02</b> Compara</span><span><b>03</b> Decide</span></div>
      </div>
      <div className="presentation-metrics"><span><strong>{featured.length}</strong> modelos publicados</span><span><strong>{model3dCount || "—"}</strong> experiencias 3D</span><span><strong>1:1</strong> atención privada</span></div>
    </section>
    <section className="presentation-stage" aria-label={`Vehículo destacado ${active.brand} ${active.model}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <img key={active.id} src={image} alt={`${active.brand} ${active.model}`} />
      <div className="presentation-stage-overlay" />
      <div className="presentation-stage-copy"><span className="eyebrow">{active.brand} · {active.year}</span><h2>{active.model}</h2><p>{active.power || "Alto rendimiento"} · {active.transmission || "Especificación premium"}</p><strong>{formatPrice(active.priceUsd)}</strong><button className="primary-action" type="button" onClick={() => onOpenVehicle(active)}>Explorar ficha →</button></div>
      <div className="presentation-stage-index">{String(activeIndex + 1).padStart(2, "0")} / {String(featured.length).padStart(2, "0")}</div>
      <div className="presentation-stage-progress" style={{ "--presentation-progress": `${((activeIndex + 1) / featured.length) * 100}%` }} />
    </section>
    <section className="presentation-rail"><div className="presentation-rail-head"><span className="eyebrow">CATÁLOGO DESTACADO</span><span>{paused ? "Pausado · usa ← → o selecciona un modelo" : "La selección avanza sola · mueve el cursor para explorar"}</span></div><div className="presentation-vehicle-list">{featured.map((vehicle, index) => <button className={index === activeIndex ? "presentation-vehicle active" : "presentation-vehicle"} type="button" key={vehicle.id} onClick={() => selectModel(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{vehicle.brand} {vehicle.model}</strong><small>{formatPrice(vehicle.priceUsd)}</small></button>)}</div></section>
  </main>;
}

function PasswordResetPage({ kind = "customer" }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState({ loading: false, error: "", success: false });
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const isCustomer = kind === "customer";
  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) return setState({ loading: false, error: "La contraseña debe tener al menos 8 caracteres", success: false });
    if (password !== confirm) return setState({ loading: false, error: "Las contraseñas no coinciden", success: false });
    setState({ loading: true, error: "", success: false });
    try {
      const response = await fetch(`${apiUrl}${isCustomer ? "/api/customer/auth/password-reset/confirm" : "/api/auth/password-reset/confirm"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo restablecer la contraseña");
      if (payload.token) localStorage.setItem(isCustomer ? "authentiq_customer_token" : "authentiq_admin_token", payload.token);
      if (payload.user) localStorage.setItem(isCustomer ? "authentiq_customer_user" : "authentiq_admin_user", JSON.stringify(payload.user));
      setState({ loading: false, error: "", success: true });
    } catch (error) { setState({ loading: false, error: error.message, success: false }); }
  };
  return <main className="admin-page admin-login-page"><form className="admin-login" onSubmit={submit}><span className="eyebrow">AUTHENTIQ · SEGURIDAD</span><h1>Crea tu <em>nueva contraseña.</em></h1>{state.success ? <><p className="state-message success">Contraseña actualizada. Ya puedes volver a iniciar sesión.</p><button className="primary-action" type="button" onClick={() => { window.history.pushState({}, "", isCustomer ? "/" : "/backoffice"); window.location.reload(); }}>Continuar</button></> : <><p className="account-welcome">El enlace vence en 30 minutos y solo funciona una vez.</p><label>Nueva contraseña<input type="password" autoComplete="new-password" minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Repite la contraseña<input type="password" autoComplete="new-password" minLength="8" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>{state.error && <p className="state-message error" role="alert">{state.error}</p>}<button className="primary-action" type="submit" disabled={state.loading}>{state.loading ? "Guardando…" : "Guardar contraseña"}</button></>}</form></main>;
}

function App() {
  const prefersReducedMotion = useReducedMotion();
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [compareVehicles, setCompareVehicles] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(() => { try { return JSON.parse(localStorage.getItem("authentiq_favorite_vehicles") || "[]"); } catch { return []; } });
  const [recentVehicleIds, setRecentVehicleIds] = useState(() => { try { return JSON.parse(localStorage.getItem("authentiq_recent_vehicles") || "[]"); } catch { return []; } });
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [customerToken, setCustomerToken] = useState(() => localStorage.getItem("authentiq_customer_token") || "");
  const [customer, setCustomer] = useState(() => { try { return JSON.parse(localStorage.getItem("authentiq_customer_user") || "null"); } catch { return null; } });
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountMode, setAccountMode] = useState("login");
  const [accountForm, setAccountForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [accountStatus, setAccountStatus] = useState({ loading: false, error: "" });
  const [customerRecoveryStatus, setCustomerRecoveryStatus] = useState({ loading: false, message: "", error: "" });
  const [accountTurnstileToken, setAccountTurnstileToken] = useState("");
  const [quickAction, setQuickAction] = useState(null);
  const [buyerRequestKind, setBuyerRequestKind] = useState(null);
  const [customerActivity, setCustomerActivity] = useState({ offers: [], quotes: [], notifications: [] });
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [previewVehicle] = useState(() => { if (window.location.pathname !== "/preview") return null; try { return JSON.parse(sessionStorage.getItem("authentiq_vehicle_preview") || "null"); } catch { return null; } });
  const [brand, setBrand] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [catalogView, setCatalogView] = useState(() => localStorage.getItem("authentiq_catalog_view") || "grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [condition, setCondition] = useState("all");
  const [fuelType, setFuelType] = useState("all");
  const [transmission, setTransmission] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minYear, setMinYear] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tenantNotFound, setTenantNotFound] = useState(false);
  const [screen, setScreen] = useState(() => impersonatePayload ? "admin" : "catalog");
  const [showDemoCatalog, setShowDemoCatalog] = useState(false);
  const [adminInitialMode, setAdminInitialMode] = useState("login");
  const [posts, setPosts] = useState([]);
  const [businessSettings, setBusinessSettings] = useState({ businessName: "AUTHENTIQ", logoUrl: "", primaryColor: "#c8a24b", accentColor: "#b28b37", faviconUrl: "", phone: "", whatsapp: "", email: "", address: "", hours: "", instagramUrl: "", facebookUrl: "", privacyText: "", termsText: "", heroHeadline: "", heroSubheadline: "", heroImageUrl: "" });
  // Evita el destello de contenido incorrecto en "/": hasta que /api/settings confirme si
  // este host es la landing de la plataforma o el showroom de un dealer, no hay forma de
  // saber qué renderizar. Sin esta bandera se veía brevemente el catálogo por defecto.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("authentiq_theme") || "light");
  publicBrandName = businessSettings.businessName || "AUTHENTIQ";
  useEffect(() => {
    const root = document.documentElement;
    const normalizeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
    const primaryColor = normalizeColor(businessSettings.primaryColor, "#c8a24b");
    const accentColor = normalizeColor(businessSettings.accentColor, "#b28b37");
    root.style.setProperty("--tenant-primary", primaryColor);
    root.style.setProperty("--tenant-accent", accentColor);
    // Mismo matiz de marca, oscurecido lo justo para pasar 4.5:1 sobre fondo claro.
    // Las secciones de fondo oscuro (hero, landing, presentación) vuelven a pedir el
    // tono original vía su propio override de esta misma variable — ver styles.css.
    root.style.setProperty("--tenant-primary-ink", contrastSafeShade(primaryColor, "#f5f1e9"));
    root.style.setProperty("--tenant-accent-ink", contrastSafeShade(accentColor, "#f5f1e9"));
    let favicon = document.querySelector("link[data-authentiq-favicon]");
    if (!favicon) { favicon = document.createElement("link"); favicon.rel = "icon"; favicon.dataset.authentiqFavicon = "true"; document.head.appendChild(favicon); }
    favicon.href = businessSettings.faviconUrl || "/favicon.svg";
  }, [businessSettings.primaryColor, businessSettings.accentColor, businessSettings.faviconUrl]);
  useEffect(() => {
    // Inyección manual del admin de plataforma para un dealer puntual (animaciones,
    // overrides visuales). El dealer nunca puede editar esto por su cuenta.
    let style = document.querySelector("style[data-tenant-custom-css]");
    const css = String(businessSettings.customCss || "").trim();
    if (!css) { style?.remove(); return; }
    if (!style) { style = document.createElement("style"); style.dataset.tenantCustomCss = "true"; document.head.appendChild(style); }
    style.textContent = css;
  }, [businessSettings.customCss]);
  useEffect(() => {
    const brand = businessSettings.businessName || "AUTHENTIQ";
    document.title = document.title.replace(/AUTHENTIQ/g, brand);
  }, [businessSettings.businessName]);

  const customerRequest = async (path, options = {}) => {
    const response = await fetch(`${apiUrl}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}`, ...(options.headers || {}) } });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(payload?.error || "La operación no pudo completarse");
    return payload;
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("authentiq_theme", theme); }, [theme]);
  useEffect(() => {
    const guardUnconfiguredWhatsapp = async (event) => {
      const link = event.target.closest?.('a[href*="wa.me/"]');
      if (!link) return;
      const url = new URL(link.href, window.location.href);
      if (url.pathname.replace(/\D/g, "")) return;
      event.preventDefault();
      const text = decodeURIComponent(url.searchParams.get("text") || "");
      const sharedUrl = text.match(/https?:\/\/[^\s]+/)?.[0] || window.location.href;
      await shareOrCopyUrl(sharedUrl, "Ficha del vehículo").catch(() => null);
    };
    document.addEventListener("click", guardUnconfiguredWhatsapp);
    return () => document.removeEventListener("click", guardUnconfiguredWhatsapp);
  }, []);
  useEffect(() => {
    const preloadBackoffice = () => import("./admin/Backoffice.jsx").catch(() => null);
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(preloadBackoffice, { timeout: 1800 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timer = window.setTimeout(preloadBackoffice, 900);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { localStorage.setItem("authentiq_favorite_vehicles", JSON.stringify(favoriteIds)); }, [favoriteIds]);
  useEffect(() => { localStorage.setItem("authentiq_recent_vehicles", JSON.stringify(recentVehicleIds)); }, [recentVehicleIds]);
  useEffect(() => { localStorage.setItem("authentiq_catalog_view", catalogView); }, [catalogView]);
  useEffect(() => {
    if (!customerToken) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [profile, favorites, activity] = await Promise.all([customerRequest("/api/customer/me"), customerRequest("/api/customer/favorites"), customerRequest("/api/customer/activity")]);
        if (cancelled) return;
        setCustomer(profile.data);
        localStorage.setItem("authentiq_customer_user", JSON.stringify(profile.data));
        setCustomerActivity(activity.data || { offers: [], quotes: [], notifications: [] });
        const serverIds = favorites.data || [];
        const localIds = JSON.parse(localStorage.getItem("authentiq_favorite_vehicles") || "[]");
        const mergedIds = [...new Set([...serverIds, ...localIds])];
        setFavoriteIds(mergedIds);
        await Promise.all(localIds.filter((id) => !serverIds.includes(id)).map((id) => customerRequest(`/api/customer/favorites/${id}`, { method: "PUT" }).catch(() => null)));
      } catch {
        if (!cancelled) { localStorage.removeItem("authentiq_customer_token"); localStorage.removeItem("authentiq_customer_user"); setCustomerToken(""); setCustomer(null); setCustomerActivity({ offers: [], quotes: [], notifications: [] }); }
      }
    })();
    return () => { cancelled = true; };
  }, [customerToken]);

  useEffect(() => {
    const handlePopState = () => { setPathname(window.location.pathname); setSelected(null); };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path) => {
    const demoSearch = requestedDealerSlug ? `?dealer=${encodeURIComponent(requestedDealerSlug)}` : "";
    const applyRoute = () => {
      window.history.pushState({}, "", `${path}${demoSearch}`);
      setPathname(path);
      setSelected(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    // Transición nativa del navegador: la foto de la tarjeta crece hasta la ficha
    // en vez de cortar de golpe. Sin librería y sin cambiar la navegación: donde
    // no existe la API, o si el comprador pidió menos movimiento, se navega igual.
    if (typeof document.startViewTransition !== "function" || prefersReducedMotion) return applyRoute();
    document.startViewTransition(() => { flushSync(applyRoute); });
  };

  const refreshVehicles = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/vehicles`, { cache: "no-store" });
      if (response.status === 404 && requestedDealerSlug) { setTenantNotFound(true); setError(""); return; }
      if (!response.ok) throw new Error("No se pudo cargar el catálogo");
      const payload = await response.json();
      setVehicles(payload.data || []);
      setError("");
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    refreshVehicles();
    const handleFocus = () => refreshVehicles();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);
  useEffect(() => { fetch(`${apiUrl}/api/blog`).then((response) => response.ok ? response.json() : { data: [] }).then((payload) => setPosts(payload.data || [])).catch(() => setPosts([])); }, []);
  useEffect(() => { fetch(`${apiUrl}/api/settings`).then((response) => { if (response.status === 404 && requestedDealerSlug) { setTenantNotFound(true); return { data: null }; } return response.ok ? response.json() : { data: null }; }).then((payload) => payload.data && setBusinessSettings((current) => ({ ...current, ...payload.data }))).catch(() => {}).finally(() => setSettingsLoaded(true)); }, []);
  const routeVehicle = useMemo(() => findVehicleByPath(vehicles, pathname), [pathname, vehicles]);
  const activeVehicle = selected || routeVehicle;
  useEffect(() => {
    if (!activeVehicle?.id || !["published", "reserved"].includes(activeVehicle.status)) return;
    setRecentVehicleIds((current) => [activeVehicle.id, ...current.filter((id) => id !== activeVehicle.id)].slice(0, 6));
  }, [activeVehicle?.id, activeVehicle?.status]);
  useEffect(() => {
    // Los artículos del blog publican sus propios metadatos (BlogArticle). Los efectos del
    // hijo corren antes que los del padre, así que aquí hay que apartarse o los pisaríamos.
    if (pathname.startsWith("/blog/")) return;
    const brandName = businessSettings.businessName || "AUTHENTIQ";
    const replaceDefaultBrand = (value) => String(value || "").replace(/AUTHENTIQ/gi, brandName);
    const title = activeVehicle
      ? replaceDefaultBrand(activeVehicle.seoTitle || `${activeVehicle.brand} ${activeVehicle.model} · ${brandName}`)
      : `${brandName} · Vehículos premium`;
    document.title = title;
    const description = activeVehicle?.seoDescription || activeVehicle?.description || `Una selección precisa de vehículos premium de ${brandName}. Cada modelo, verificado.`;
    const image = activeVehicle?.images?.[0]?.url || "/assets/hero-highway.webp";
    setMeta('meta[name="description"]', "description", description);
    setMeta('meta[property="og:title"]', "og:title", title);
    setMeta('meta[property="og:description"]', "og:description", description);
    setMeta('meta[property="og:image"]', "og:image", new URL(image, window.location.origin).href);
    setMeta('meta[property="og:url"]', "og:url", window.location.href.split("#")[0]);
    setMeta('meta[property="og:type"]', "og:type", activeVehicle ? "product" : "website");
    setMeta('meta[name="twitter:card"]', "twitter:card", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "twitter:description", description);
    setMeta('meta[name="twitter:image"]', "twitter:image", new URL(image, window.location.origin).href);
    setCanonical(window.location.href.split("#")[0].split("?")[0]);
    // Los vehículos en borrador o la vista previa nunca deben indexarse.
    setRobots(pathname !== "/preview" && (!activeVehicle || ["published", "reserved"].includes(activeVehicle.status)));
    if (!loading) trackEvent(activeVehicle ? "vehicle_view" : "catalog_view", { vehicleId: activeVehicle?.id || null });
  }, [activeVehicle?.id, businessSettings.businessName, pathname, loading]);

  const brands = useMemo(() => [...new Set(vehicles.map((vehicle) => vehicle.brand))].sort(), [vehicles]);
  const recentVehicles = useMemo(() => [...vehicles].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0)), [vehicles]);
  const recentlyViewedVehicles = useMemo(() => recentVehicleIds.map((id) => vehicles.find((vehicle) => vehicle.id === id)).filter(Boolean), [recentVehicleIds, vehicles]);
  const favoriteVehicles = useMemo(() => favoriteIds.map((id) => vehicles.find((vehicle) => vehicle.id === id)).filter(Boolean), [favoriteIds, vehicles]);
  const categories = useMemo(() => [...new Set(vehicles.map((vehicle) => vehicle.category).filter(Boolean))].sort(), [vehicles]);
  const conditions = useMemo(() => [...new Set(vehicles.map((vehicle) => vehicle.condition).filter(Boolean))].sort(), [vehicles]);
  const fuelTypes = useMemo(() => [...new Set(vehicles.map((vehicle) => vehicle.fuelType).filter(Boolean))].sort(), [vehicles]);
  const transmissions = useMemo(() => [...new Set(vehicles.map((vehicle) => vehicle.transmission).filter(Boolean))].sort(), [vehicles]);
  const filteredVehicles = useMemo(() => vehicles
    .filter((vehicle) => {
      const haystack = `${vehicle.brand} ${vehicle.model} ${vehicle.variant || ""} ${vehicle.year} ${vehicle.category || ""} ${vehicle.fuelType || ""} ${vehicle.exteriorColor || ""} ${(vehicle.features || []).join(" ")}`.toLowerCase();
      const price = Number(vehicle.priceUsd);
      const year = Number(vehicle.year);
      return (!favoritesOnly || favoriteIds.includes(vehicle.id)) &&
        (brand === "all" || vehicle.brand === brand) &&
        (category === "all" || vehicle.category === category) &&
        (condition === "all" || vehicle.condition === condition) &&
        (fuelType === "all" || vehicle.fuelType === fuelType) &&
        (transmission === "all" || vehicle.transmission === transmission) &&
        (!minPrice || price >= Number(minPrice)) &&
        (!maxPrice || price <= Number(maxPrice)) &&
        (!minYear || year >= Number(minYear)) &&
        (!search.trim() || haystack.includes(search.trim().toLowerCase()));
    })
    .sort((left, right) => {
      if (sort === "price-low") return Number(left.priceUsd) - Number(right.priceUsd);
      if (sort === "price-high") return Number(right.priceUsd) - Number(left.priceUsd);
      if (sort === "mileage") return Number(left.mileageKm) - Number(right.mileageKm);
      if (sort === "year") return Number(right.year) - Number(left.year);
      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    }), [vehicles, favoriteIds, favoritesOnly, brand, category, condition, fuelType, transmission, minPrice, maxPrice, minYear, search, sort]);

  const clearFilters = () => {
    setSearch(""); setBrand("all"); setCategory("all"); setCondition("all"); setFuelType("all"); setTransmission("all");
    setMinPrice(""); setMaxPrice(""); setMinYear(""); setSort("newest"); setFavoritesOnly(false);
  };
  const chooseIntent = (intent) => {
    clearFilters();
    if (intent.startsWith("category:")) setCategory(intent.slice("category:".length));
    if (intent.startsWith("condition:")) setCondition(intent.slice("condition:".length));
    if (intent.startsWith("fuel:")) setFuelType(intent.slice("fuel:".length));
    window.requestAnimationFrame(() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const chooseBrand = (selectedBrand) => {
    setBrand(selectedBrand);
    window.requestAnimationFrame(() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const chooseModelLine = (vehicle) => {
    setBrand(vehicle.brand);
    setSearch(vehicle.model);
    window.requestAnimationFrame(() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const toggleCompare = (vehicle) => setCompareVehicles((current) => current.some((item) => item.id === vehicle.id) ? current.filter((item) => item.id !== vehicle.id) : current.length < 3 ? [...current, vehicle] : current);
  const changeAccountForm = (field, value) => setAccountForm((current) => ({ ...current, [field]: value }));
  const submitAccount = async (event) => {
    event.preventDefault();
    setAccountStatus({ loading: true, error: "" });
    try {
      const endpoint = accountMode === "login" ? "/api/customer/auth/login" : "/api/customer/auth/register";
      const body = { name: accountForm.name, email: accountForm.email, phone: accountForm.phone, password: accountForm.password };
      if (accountMode === "register") body.turnstileToken = accountTurnstileToken;
      const response = await fetch(`${apiUrl}${endpoint}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo completar la cuenta");
      setCustomerToken(payload.token);
      setCustomer(payload.user);
      localStorage.setItem("authentiq_customer_token", payload.token);
      localStorage.setItem("authentiq_customer_user", JSON.stringify(payload.user));
      setAccountForm({ name: "", email: "", phone: "", password: "" });
      setAccountStatus({ loading: false, error: "" });
    } catch (requestError) { setAccountStatus({ loading: false, error: requestError.message }); }
  };
  const logoutCustomer = () => { fetch(`${apiUrl}/api/customer/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {}); localStorage.removeItem("authentiq_customer_token"); localStorage.removeItem("authentiq_customer_user"); setCustomerToken(""); setCustomer(null); setCustomerActivity({ offers: [], quotes: [], notifications: [] }); setAccountStatus({ loading: false, error: "" }); };
  const submitCustomerRecovery = async (event) => { event.preventDefault(); setCustomerRecoveryStatus({ loading: true, message: "", error: "" }); try { const response = await fetch(`${apiUrl}/api/customer/auth/password-reset/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: accountForm.email }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo preparar la recuperación"); setCustomerRecoveryStatus({ loading: false, message: payload.message, error: "" }); } catch (error) { setCustomerRecoveryStatus({ loading: false, message: "", error: error.message }); } };
  const markCustomerNotificationsRead = async () => { try { await customerRequest("/api/customer/notifications/read", { method: "PATCH" }); setCustomerActivity((current) => ({ ...current, notifications: (current.notifications || []).map((item) => ({ ...item, readAt: new Date().toISOString() })) })); } catch (requestError) { setAccountStatus({ loading: false, error: requestError.message }); } };
  const toggleFavorite = (vehicle) => {
    const wasFavorite = favoriteIds.includes(vehicle.id);
    const nextIds = wasFavorite ? favoriteIds.filter((id) => id !== vehicle.id) : [...favoriteIds, vehicle.id];
    setFavoriteIds(nextIds);
    if (customerToken) customerRequest(`/api/customer/favorites/${vehicle.id}`, { method: wasFavorite ? "DELETE" : "PUT" }).catch((requestError) => { setFavoriteIds(favoriteIds); setAccountStatus({ loading: false, error: requestError.message }); setAccountOpen(true); });
  };
  const syncCatalogVehicle = (vehicle) => {
    if (!vehicle?.id) return;
    setVehicles((current) => {
      const withoutUpdated = current.filter((item) => item.id !== vehicle.id);
      // El catálogo público sirve 'published' y 'reserved': ambos deben permanecer visibles.
      return ["published", "reserved"].includes(vehicle.status) ? [vehicle, ...withoutUpdated] : withoutUpdated;
    });
  };

  if (pathname === "/backoffice/restablecer-contrasena") return <PasswordResetPage kind="admin" />;
  if (pathname === "/cuenta/restablecer-contrasena") return <PasswordResetPage kind="customer" />;
  if (screen === "admin") return <Suspense fallback={<main className="admin-page"><p className="state-message">Cargando panel de control…</p></main>}><Backoffice initialMode={adminInitialMode} impersonation={impersonatePayload} onBack={() => { setScreen("catalog"); setAdminInitialMode("login"); refreshVehicles(); }} onVehiclesChanged={syncCatalogVehicle} /></Suspense>;
  if (tenantNotFound) return <TenantNotFoundPage />;
  if (pathname === "/presentacion") return <PresentationMode vehicles={vehicles} loading={loading} businessName={businessSettings.businessName} logoUrl={businessSettings.logoUrl} onExit={() => { if (requestedDealerSlug) navigate(`/?dealer=${encodeURIComponent(requestedDealerSlug)}`); else { setShowDemoCatalog(true); navigate("/"); } }} onOpenVehicle={(vehicle) => navigate(vehiclePath(vehicle))} />;
  if (pathname.startsWith("/cotizaciones/") && pathname.slice("/cotizaciones/".length)) return <PublicQuotePage token={pathname.slice("/cotizaciones/".length)} />;
  if (pathname === "/preview") return previewVehicle ? <VehicleDetail vehicle={{ ...previewVehicle, status: "draft" }} onBack={() => navigate("/")} /> : <main className="article-page"><button className="back-button" onClick={() => navigate("/")}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">AUTHENTIQ · VISTA PREVIA</span><h1>No hay una ficha para previsualizar.</h1><p>Regresa al panel, completa el formulario y vuelve a abrir la vista previa.</p></section></main>;
  if (pathname.startsWith("/blog/")) return <BlogArticle slug={pathname.slice("/blog/".length)} onBack={() => navigate("/")} />;
  if (pathname.startsWith("/vehiculos/") && loading) return <main className="article-page"><p className="state-message">Cargando vehículo…</p></main>;
  if (pathname.startsWith("/vehiculos/") && !routeVehicle) return <main className="article-page"><button className="back-button" onClick={() => navigate("/")}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">AUTHENTIQ · INVENTARIO</span><h1>Este vehículo no está disponible.</h1><p>Puede haber sido vendido, archivado o la dirección puede haber cambiado.</p></section></main>;
  const knownPath = pathname === "/" || pathname === "/presentacion" || pathname === "/preview" || pathname === "/backoffice/restablecer-contrasena" || pathname === "/cuenta/restablecer-contrasena" || pathname.startsWith("/cotizaciones/") || pathname.startsWith("/blog/") || pathname.startsWith("/vehiculos/");
  if (!knownPath) return <NotFoundPage onBack={() => navigate("/")} />;
  if (["contact", "location", "privacy", "terms"].includes(screen)) return <InstitutionalPage type={screen} settings={businessSettings} onBack={() => setScreen("catalog")} />;
  if (activeVehicle) return <VehicleDetail vehicle={activeVehicle} vehicles={vehicles} onBack={() => navigate("/")} isFavorite={favoriteIds.includes(activeVehicle.id)} onToggleFavorite={toggleFavorite} customerToken={customerToken} compareVehicles={compareVehicles} favoriteIds={favoriteIds} onOpenVehicle={(vehicle) => navigate(vehiclePath(vehicle))} onToggleCompare={toggleCompare} whatsapp={businessSettings.whatsapp} />;
  if (pathname === "/" && !settingsLoaded && !showDemoCatalog && !requestedDealerSlug) return <main className="app-boot-shell" aria-hidden="true" />;
  if (pathname === "/" && businessSettings.isPlatformHome && !showDemoCatalog && !requestedDealerSlug) return <LandingPage onCreateShowroom={() => { setAdminInitialMode("register"); setScreen("admin"); }} onDealerLogin={() => { setAdminInitialMode("login"); setScreen("admin"); }} onViewDemo={() => setShowDemoCatalog(true)} onOpenPrivacy={() => setScreen("privacy")} onOpenTerms={() => setScreen("terms")} />;

  const heroVideoUrl = String(import.meta.env.VITE_HERO_VIDEO_URL || "").trim();
  return (
    <><a className="skip-link" href="#top">Saltar al contenido</a><main id="top">
      <ShowroomNav theme={theme} setTheme={setTheme} customer={customer} businessName={businessSettings.businessName} logoUrl={businessSettings.logoUrl} onAccount={() => { setAccountOpen(true); setAccountStatus({ loading: false, error: "" }); }} onBackoffice={() => { setAdminInitialMode("login"); setScreen("admin"); }} onRegisterDealer={() => { setAdminInitialMode("register"); setScreen("admin"); }} />
      <section className="hero">
        {heroVideoUrl ? <video className="hero-background hero-video" autoPlay={!prefersReducedMotion} muted loop playsInline preload="metadata" poster={businessSettings.heroImageUrl || "/assets/authentiq-hero-v1.webp"} aria-label="Vehículo premium en movimiento"><source src={heroVideoUrl} /></video> : <img src={publicMediaUrl(businessSettings.heroImageUrl) || "/assets/authentiq-hero-v1.webp"} alt={`Vehículo destacado de ${getBrandName()}`} className="hero-background" loading="eager" fetchPriority="high" decoding="async" />}
        <div className="hero-overlay" />
        <div className="hero-content">
          <span className="eyebrow">{getBrandName()} / CURATED MOTION</span>
          {businessSettings.heroHeadline ? <h1>{businessSettings.heroHeadline}</h1> : <h1>Elige lo que <em>te mueve.</em></h1>}
          <p>{businessSettings.heroSubheadline || "Vehículos con carácter, información clara y una atención diseñada alrededor de tu próxima historia."}</p>
          <div className="hero-actions"><a href="#catalog" className="hero-link primary-action hero-primary-action">Explorar inventario ↓</a><a href={`/presentacion${requestedDealerSlug ? `?dealer=${encodeURIComponent(requestedDealerSlug)}` : ""}`} className="hero-link hero-secondary-action">Ver presentación →</a><button type="button" className="hero-link hero-tertiary-action" onClick={() => setBuyerRequestKind("trade-in")}>¿Tienes vehículo? Valóralo →</button></div>
        </div>
        <div className="hero-proof" aria-label={`Pilares de ${getBrandName()}`}><span><strong><AnimatedMetric value={1} suffix="" /></strong> selección con criterio</span><span><strong><AnimatedMetric value={100} suffix="%" /></strong> inventario verificado</span><span><strong><AnimatedMetric value={1} suffix=":1" /></strong> atención privada</span></div>
        <a className="hero-scroll-cue" href="#catalog" aria-label="Bajar al catálogo"><span /> SCROLL</a>
      </section>
      <Reveal className="showroom-signal"><div className="showroom-signal-inner"><span className="showroom-signal-label">{getBrandName()} / PRIVATE SELECTION</span><p>No llenamos el catálogo. Seleccionamos lo que merece ser conducido.</p><a href="#catalog">Entrar a la selección <span>→</span></a></div></Reveal>
      <IntentRail categories={categories} conditions={conditions} fuelTypes={fuelTypes} onChoose={chooseIntent} />
      <CompareDock vehicles={compareVehicles} onRemove={(id) => setCompareVehicles((current) => current.filter((item) => item.id !== id))} onClear={() => setCompareVehicles([])} />

      <section className="catalog" id="catalog" aria-busy={loading}>
        <div className="section-head"><div><span className="eyebrow">INVENTARIO · {vehicles.length.toString().padStart(2, "0")} MODELOS</span><h2>Catálogo activo.</h2></div><p>Inventario actualizado para ayudarte a decidir mejor.</p></div>
         <div className="catalog-intro-note">Una selección breve, pensada para decidir mejor.</div>
         <div className="filters-heading"><div><span className="eyebrow">BÚSQUEDA AVANZADA</span><strong>Filtra por lo que importa.</strong></div><span>Marca, precio, año y especificaciones</span><button className="filters-toggle" type="button" onClick={() => setFiltersOpen((current) => !current)} aria-expanded={filtersOpen}>{filtersOpen ? "Ocultar filtros" : "Más filtros"} <span>{filtersOpen ? "↑" : "↓"}</span></button></div>
         <div className={`filters ${filtersOpen ? "filters-expanded" : ""}`}>
          <input className="catalog-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar marca, modelo o año" aria-label="Buscar vehículos" />
          <select className="filter-secondary" value={brand} onChange={(event) => setBrand(event.target.value)}><option value="all">Todas las marcas</option>{brands.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por tipo"><option value="all">Todos los tipos</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select className="filter-secondary" value={condition} onChange={(event) => setCondition(event.target.value)} aria-label="Filtrar por condición"><option value="all">Nuevo y certificado</option>{conditions.map((item) => <option key={item} value={item}>{item === "new" ? "Nuevo" : "Certificado"}</option>)}</select>
          <select className="filter-secondary" value={fuelType} onChange={(event) => setFuelType(event.target.value)} aria-label="Filtrar por combustible"><option value="all">Cualquier combustible</option>{fuelTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select className="filter-secondary" value={transmission} onChange={(event) => setTransmission(event.target.value)} aria-label="Filtrar por transmisión"><option value="all">Cualquier transmisión</option>{transmissions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <input className="filter-number" type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Precio desde" aria-label="Precio mínimo" />
          <input className="filter-number" type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Precio hasta" aria-label="Precio máximo" />
          <input className="filter-number filter-year filter-secondary" type="number" min="1900" max="2100" value={minYear} onChange={(event) => setMinYear(event.target.value)} placeholder="Año desde" aria-label="Año mínimo" />
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Ordenar vehículos"><option value="newest">Más recientes</option><option value="price-low">Precio menor</option><option value="price-high">Precio mayor</option><option value="year">Año más reciente</option><option value="mileage">Menor kilometraje</option></select>
           {(search || brand !== "all" || category !== "all" || condition !== "all" || fuelType !== "all" || transmission !== "all" || minPrice || maxPrice || minYear || sort !== "newest") && <button className="clear-filters" type="button" onClick={clearFilters}>Limpiar</button>}
         </div>
         <div className="catalog-toolbar"><span>{loading ? "Consultando inventario" : <><AnimatedMetric value={filteredVehicles.length} /> de <AnimatedMetric value={vehicles.length} /> vehículos visibles</>}</span><span className="catalog-toolbar-line" /><span>Desliza para explorar</span><button className={`favorites-filter ${favoritesOnly ? "is-active" : ""}`} type="button" onClick={() => setFavoritesOnly((current) => !current)} aria-pressed={favoritesOnly}>♡ Favoritos {favoriteIds.length ? <>· <AnimatedMetric value={favoriteIds.length} /></> : ""}</button></div>
        <div className="catalog-view-switcher" role="group" aria-label="Vista del catálogo"><span>Mostrar como</span><button type="button" className={catalogView === "grid" ? "is-active" : ""} onClick={() => setCatalogView("grid")} aria-pressed={catalogView === "grid"}>Cuadrícula</button><button type="button" className={catalogView === "list" ? "is-active" : ""} onClick={() => setCatalogView("list")} aria-pressed={catalogView === "list"}>Lista</button></div>
        {loading && <CatalogSkeleton />}
        {error && <CatalogError message={`${error}. Verifica que la API esté corriendo en el puerto 3001.`} onRetry={() => { setLoading(true); refreshVehicles(); }} />}
        {!loading && !error && (filteredVehicles.length ? <div className={`vehicle-grid ${catalogView === "list" ? "is-list-view" : ""}`}><AnimatePresence mode="popLayout" initial={false}>{filteredVehicles.map((vehicle, index) => <VehicleCard key={vehicle.id} vehicle={vehicle} isCompared={compareVehicles.some((item) => item.id === vehicle.id)} isFavorite={favoriteIds.includes(vehicle.id)} onToggleFavorite={toggleFavorite} onToggleCompare={toggleCompare} onOpen={(item) => navigate(vehiclePath(item))} imageLoading={index < 3 ? "eager" : "lazy"} />)}</AnimatePresence></div> : <div className="catalog-empty"><h3>No encontramos vehículos con esos criterios.</h3><p>Prueba limpiando la búsqueda o seleccionando otros filtros.</p><button className="secondary-action" onClick={clearFilters}>Limpiar filtros</button></div>)}
        <ShowroomTrustRail onTradeIn={() => setBuyerRequestKind("trade-in")} onSearchAlert={() => setBuyerRequestKind("search-alert")} />
        <RecentlyViewed vehicles={recentlyViewedVehicles} compareVehicles={compareVehicles} favoriteIds={favoriteIds} onOpen={(vehicle) => navigate(vehiclePath(vehicle))} onToggleCompare={toggleCompare} onToggleFavorite={toggleFavorite} />
        <RecentSelection vehicles={recentVehicles} compareVehicles={compareVehicles} favoriteIds={favoriteIds} onOpen={(vehicle) => navigate(vehiclePath(vehicle))} onToggleCompare={toggleCompare} onToggleFavorite={toggleFavorite} />
        {businessSettings.showFinancing !== false && <FinancingSpotlight vehicles={vehicles} onExplore={() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" })} />}
        {businessSettings.showBrandRail !== false && <BrandRail vehicles={vehicles} brands={brands} onChooseBrand={chooseBrand} />}
        {businessSettings.showModelLineRail !== false && <ModelLineRail vehicles={vehicles} selectedBrand={brand} onChooseLine={chooseModelLine} />}

        <CompareTable vehicles={compareVehicles} />
        <ContactForm />
        <FaqSection settings={businessSettings} />
        <TestimonialsSection settings={businessSettings} />
        <LocationSection settings={businessSettings} />
        {businessSettings.showBlog !== false && <BlogSection posts={posts} />}
        <footer className="site-footer">
          {(businessSettings.phone || businessSettings.whatsapp || businessSettings.email || businessSettings.instagramUrl || businessSettings.facebookUrl) && <div className="site-footer-contact">{businessSettings.phone && <a href={`tel:${businessSettings.phone}`}>{businessSettings.phone}</a>}{businessSettings.whatsapp && <a href={`https://wa.me/${businessSettings.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" onClick={() => trackEvent("whatsapp_click")}>WhatsApp</a>}{businessSettings.email && <a href={`mailto:${businessSettings.email}`}>{businessSettings.email}</a>}{businessSettings.instagramUrl && <a href={businessSettings.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a>}{businessSettings.facebookUrl && <a href={businessSettings.facebookUrl} target="_blank" rel="noreferrer">Facebook ↗</a>}</div>}
          <div><span className="brand-mark">{businessSettings.businessName || "AUTHENTIQ"}</span><p>Vehículos premium · inventario verificado.</p></div>
          <nav aria-label="Enlaces institucionales">
            <button onClick={() => setScreen("contact")}>Contacto</button>
            <button onClick={() => setScreen("location")}>Ubicación</button>
            <button onClick={() => setScreen("privacy")}>Privacidad</button>
            <button onClick={() => setScreen("terms")}>Términos</button>
            <button onClick={() => { setAdminInitialMode("register"); setScreen("admin"); }} style={{ color: "var(--auth-gold)" }}>¿Eres Dealer? Crea tu Showroom</button>
          </nav>
        </footer>
      </section>
      <AnimatePresence>{accountOpen && <CustomerAccountModal customer={customer} form={accountForm} mode={accountMode} status={accountStatus} recoveryStatus={customerRecoveryStatus} favoriteCount={favoriteIds.length} favoriteVehicles={favoriteVehicles} activity={customerActivity} whatsapp={businessSettings.whatsapp} businessName={businessSettings.businessName || getBrandName()} onChange={changeAccountForm} onSubmit={submitAccount} onRecoverySubmit={submitCustomerRecovery} onTurnstileToken={setAccountTurnstileToken} onMode={(mode) => { setAccountMode(mode); setAccountStatus({ loading: false, error: "" }); setCustomerRecoveryStatus({ loading: false, message: "", error: "" }); }} onClose={() => setAccountOpen(false)} onLogout={logoutCustomer} onReadNotifications={markCustomerNotificationsRead} onOpenVehicle={(vehicle) => { setAccountOpen(false); navigate(vehiclePath(vehicle)); }} onToggleFavorite={toggleFavorite} onQuickAction={(vehicle, type) => { setAccountOpen(false); setQuickAction({ vehicle, type }); }} />}</AnimatePresence>
      <AnimatePresence>{quickAction?.type === "appointment" && <TestDriveModal vehicle={quickAction.vehicle} onClose={() => setQuickAction(null)} />}</AnimatePresence>
      <AnimatePresence>{quickAction?.type === "quote" && <QuoteModal vehicle={quickAction.vehicle} onClose={() => setQuickAction(null)} />}</AnimatePresence>
      <AnimatePresence>{buyerRequestKind && <BuyerRequestModal kind={buyerRequestKind} onClose={() => setBuyerRequestKind(null)} />}</AnimatePresence>
    </main></>
  );
}

class AppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error("[AUTHENTIQ] Error global de interfaz", error, info); reportError(error, { componentStack: info?.componentStack }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-error-boundary"><span className="eyebrow">{getBrandName()}</span><h1>Estamos afinando esta experiencia.</h1><p>La página encontró un problema inesperado. Puedes volver a cargarla para continuar.</p><button className="primary-action" type="button" onClick={() => window.location.reload()}>Recargar página</button></main>;
  }
}

export default function AppRoot() {
  return <AppErrorBoundary><App /><CookieConsentBanner /></AppErrorBoundary>;
}

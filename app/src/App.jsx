import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useMotionTemplate, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from "motion/react";
import useEmblaCarousel from "embla-carousel-react";
import { LANDING_COPY, LANDING_LANGUAGES } from "./landingCopy.js";
import { useSmoothScroll } from "./utils/useSmoothScroll.js";
import { TurnstileField, turnstileSiteKey } from "./utils/turnstile.jsx";
import { flushSync } from "react-dom";
import { contrastSafeShade, contrastSafeTint, lighten, readableInkOn } from "./utils/color.js";
import { reportError } from "./utils/monitoring.js";
import { normalizePhone, whatsappDigits } from "./utils/phone.js";
import { generateQRCodeSVG } from "./utils/qr.js";
import PhoneField from "./admin/PhoneField.jsx";
import { AnimatedNumber, BlurFade, Disclosure, ProgressiveBlur, TextReveal } from "./ui/MotionPrimitives.jsx";
import { AnimatedThemeTogglerStarDemo } from "./components/ui/animated-theme-toggler-star-demo.jsx";
import { ArrowUpRightIcon, CalendarBlankIcon, CarSimpleIcon, ChartLineUpIcon, ChatsCircleIcon, FileTextIcon, GlobeHemisphereWestIcon, MagnifyingGlassIcon, SquaresFourIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

class SectionBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error(`[ZEVROA] Fallo en la sección "${this.props.name || "desconocida"}"`, error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;
    return <section className="section-fallback" role="status"><span className="eyebrow">{getBrandName()}</span><p>{this.props.message || "Esta sección no pudo mostrarse. El resto de la página sigue disponible."}</p></section>;
  }
}

// El panel es una aplicación distinta del catálogo. Se carga al abrirlo o cuando la
// persona demuestra intención de entrar, no durante la visita inicial al landing.
const loadBackoffice = () => import("./admin/Backoffice.jsx");
const Backoffice = lazy(loadBackoffice);

// Conserva el subdominio local del dealer (p. ej. dealer-demo.localhost). Así la
// API puede resolver la organización por host también durante una demostración.
const localApiOrigin = `${window.location.protocol}//${window.location.hostname}:3001`;
const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? localApiOrigin : window.location.origin);
const requestedDealerSlug = new URLSearchParams(window.location.search).get("dealer")?.trim().toLowerCase() || "";
const previewPlatformLanding = import.meta.env.DEV && new URLSearchParams(window.location.search).get("studio") === "1";
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
  if (isPreviewMode) { headers.set("X-Preview-Mode", "1"); mutated = true; }
  if (/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(requestedDealerSlug) && typeof input === "string") {
    try {
      const url = new URL(input, window.location.href);
      if (url.pathname.startsWith("/api/") && !url.searchParams.has("dealer")) { url.searchParams.set("dealer", requestedDealerSlug); target = url.href; }
    } catch { /* El navegador resolverá el destino original si no es una URL válida. */ }
  }
  const requestOptions = { ...options, credentials: options.credentials || "include", headers };
  return mutated || target !== input ? nativeFetch(target, requestOptions) : nativeFetch(input, requestOptions);
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

function normalizeSearchText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function editDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal : Math.min(diagonal + 1, row[j] + 1, row[j - 1] + 1);
      diagonal = above;
    }
  }
  return row[b.length];
}

function vehicleMatchesSearch(vehicle, value) {
  const query = normalizeSearchText(value);
  if (!query) return true;
  const haystack = normalizeSearchText(`${vehicle.brand} ${vehicle.model} ${vehicle.variant || ""} ${vehicle.year} ${vehicle.category || ""} ${vehicle.fuelType || ""} ${vehicle.transmission || ""} ${vehicle.exteriorColor || ""} ${vehicle.location || ""} ${(vehicle.features || []).join(" ")}`);
  if (haystack.includes(query)) return true;
  const words = haystack.split(/\s+/).filter(Boolean);
  return query.split(/\s+/).filter(Boolean).every((token) => words.some((word) => word.startsWith(token) || (token.length >= 4 && editDistance(token, word) <= Math.min(2, Math.floor(token.length / 3)))));
}

let publicBrandName = "ZEVROA";
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

function downloadCalendarIcs({ title, description, location, startDate, durationMinutes = 60 }) {
  try {
    const start = new Date(startDate);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const formatIcsDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//ZEVROA//Citas//ES",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${Date.now()}-citas@zevroa.com`,
      `DTSTAMP:${formatIcsDate(new Date())}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${description}`,
      `LOCATION:${location || "Concesionario"}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cita-${start.toISOString().slice(0, 10)}.ics`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch {
    /* Fallback silencioso */
  }
}

function googleCalendarUrl({ title, description, location, startDate, durationMinutes = 60 }) {
  try {
    const start = new Date(startDate);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const formatGoogleDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      details: description,
      location: location || "",
      dates: `${formatGoogleDate(start)}/${formatGoogleDate(end)}`,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  } catch {
    return "#";
  }
}

function Breadcrumbs({ vehicle }) {
  return <nav className="breadcrumbs" aria-label="Ruta de navegación"><a href="#catalog">Inventario</a><span aria-hidden="true">/</span><a href="#catalog">{vehicle.brand}</a><span aria-hidden="true">/</span><span aria-current="page">{vehicle.model}</span></nav>;
}

function NotFoundPage({ onBack }) {
  return <main className="article-page not-found-page"><span className="eyebrow">{getBrandName()} · 404</span><h1>Esta ruta no lleva a ningún vehículo.</h1><p>Puede que el enlace haya cambiado o que la página ya no esté disponible. Regresa al catálogo para continuar explorando.</p><button className="primary-action" type="button" onClick={onBack}>Volver al catálogo →</button></main>;
}

function TenantNotFoundPage() {
  return <main className="article-page not-found-page"><span className="eyebrow">ZEVROA · SHOWROOM</span><h1>Este showroom no existe.</h1><p>El enlace del dealer no es válido o el showroom todavía no está disponible. Revisa la dirección o vuelve al inicio.</p><a className="primary-action" href="/">Volver al inicio →</a></main>;
}

function LandingPage(props) {
  return <StudioLanding {...props} />;
}

const studioEase = [0.22, 1, 0.36, 1];
// Vincula un elemento a la posición del scroll en vez de dispararlo una vez.
// Con `whileInView` la animación ocurre al entrar y ya no vuelve: si el lector
// sube, el elemento se queda donde quedó. Atado al progreso, baja y avanza,
// sube y regresa exactamente a donde estaba, que es como se comporta la
// referencia. `offset` mide desde que el elemento asoma por abajo hasta que
// llega a la zona de lectura.
function useScrubbed(ref, { from = 0.92, to = 0.48 } = {}) {
  const { scrollYProgress } = useScroll({ target: ref, offset: [`start ${from}`, `start ${to}`] });
  return scrollYProgress;
}

function StudioReveal({ children, className, delay = 0, reduceMotion, as = "div" }) {
  const ref = useRef(null);
  const Tag = motion[as] || motion.div;
  // El retardo se traduce en un arranque más tardío dentro del recorrido, para
  // conservar el escalonado sin depender del tiempo.
  const start = Math.min(0.5, delay);
  const progress = useScrubbed(ref, { from: 0.95 - start * 0.25, to: 0.5 });
  const opacity = useTransform(progress, [0, 1], [0, 1]);
  const y = useTransform(progress, [0, 1], [reduceMotion ? 0 : 30, 0]);
  return <Tag ref={ref} className={className} style={{ opacity, y }}>{children}</Tag>;
}

// Cada línea sale de su propia máscara, escalonada a lo largo del recorrido del
// scroll: al subir vuelven a esconderse en el mismo orden inverso.
// "Te suena esto?" - el problema en las palabras del concesionario, no en las nuestras.
// Cada fila enfrenta el dia de hoy con lo que cambia, sin adjetivos.
function StudioPains({ copy, reduceMotion }) {
  return (
    <section className="studio-pains" id="landing-pains">
      <div className="studio-pains-head">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{copy.kicker}</StudioReveal>
        <StudioReveal as="h2" delay={0.08} reduceMotion={reduceMotion}>{copy.heading}</StudioReveal>
        <StudioReveal as="p" delay={0.16} reduceMotion={reduceMotion}>{copy.body}</StudioReveal>
      </div>
      <ul className="studio-pains-list">
        {copy.items.map((item, index) => (
          <StudioReveal as="li" key={item.before} delay={0.08 + index * 0.07} reduceMotion={reduceMotion}>
            <b>{item.before}</b>
            <span aria-hidden="true">→</span>
            <i>{item.after}</i>
          </StudioReveal>
        ))}
      </ul>
    </section>
  );
}

// Tabla comparativa. En movil cada fila se apila como una tarjeta con sus dos lados
// etiquetados, en vez de forzar el scroll horizontal de una tabla de tres columnas.
function StudioCompare({ copy, reduceMotion }) {
  return (
    <section className="studio-compare" id="landing-compare">
      <div className="studio-compare-head">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{copy.kicker}</StudioReveal>
        <StudioReveal as="h2" delay={0.08} reduceMotion={reduceMotion}>{copy.heading}</StudioReveal>
      </div>
      <div className="studio-compare-table">
        <div className="studio-compare-row is-head">
          <span />
          <span>{copy.manual}</span>
          <span>{copy.withUs}</span>
        </div>
        {copy.rows.map((row, index) => (
          <StudioReveal key={row.label} className="studio-compare-row" delay={0.05 + index * 0.05} reduceMotion={reduceMotion}>
            <span className="studio-compare-label">{row.label}</span>
            <span className="studio-compare-manual"><em>{copy.manual}</em>{row.manual}</span>
            <span className="studio-compare-ours"><em>{copy.withUs}</em>{row.withUs}</span>
          </StudioReveal>
        ))}
      </div>
    </section>
  );
}

// Voces reales tomadas del panel de la plataforma. Si nadie ha cargado testimonios la
// seccion no existe: preferimos un hueco a una cita inventada.
function StudioVoices({ copy, items, reduceMotion }) {
  const voices = (Array.isArray(items) ? items : []).filter((item) => item && item.quote && item.name);
  if (!voices.length) return null;
  return (
    <section className="studio-voices" id="landing-voices">
      <div className="studio-voices-head">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{copy.kicker}</StudioReveal>
        <StudioReveal as="h2" delay={0.08} reduceMotion={reduceMotion}>{copy.heading}</StudioReveal>
      </div>
      <div className="studio-voices-grid">
        {voices.slice(0, 3).map((voice, index) => (
          <StudioReveal as="figure" key={`${voice.name}-${index}`} className="studio-voice" delay={0.06 + index * 0.07} reduceMotion={reduceMotion}>
            <blockquote>{voice.quote}</blockquote>
            <figcaption><strong>{voice.name}</strong>{voice.detail && <span>{voice.detail}</span>}</figcaption>
          </StudioReveal>
        ))}
      </div>
    </section>
  );
}

// Solicitud de demo: la unica via para hablar con una persona antes de registrarse.
function StudioDemoForm({ copy, reduceMotion, onCreateShowroom }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", dealership: "", inventorySize: "", consent: false });
  const [state, setState] = useState("idle");
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    try {
      const response = await fetch(`${apiUrl}/api/public/demo-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, phone: normalizePhone(form.phone), privacyConsent: form.consent }),
      });
      setState(response.ok ? "done" : "error");
    } catch { setState("error"); }
  };
  return (
    <section className="studio-demo" id="landing-demo">
      <div className="studio-demo-copy">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{copy.kicker}</StudioReveal>
        <StudioReveal as="h2" delay={0.08} reduceMotion={reduceMotion}>{copy.heading}</StudioReveal>
        <StudioReveal as="p" delay={0.16} reduceMotion={reduceMotion}>{copy.body}</StudioReveal>
        <StudioReveal delay={0.24} reduceMotion={reduceMotion}>
          <button type="button" className="studio-text-action" onClick={onCreateShowroom}>{copy.alt}</button>
        </StudioReveal>
      </div>
      {state === "done"
        ? <p className="studio-demo-done" role="status">{copy.success}</p>
        : <form className="studio-demo-form" onSubmit={submit}>
            <label>{copy.fields.name}<input type="text" required value={form.name} onChange={(event) => set("name", event.target.value)} autoComplete="name" /></label>
            <label>{copy.fields.email}<input type="email" required value={form.email} onChange={(event) => set("email", event.target.value)} autoComplete="email" /></label>
            <PhoneField label={copy.fields.phone} value={form.phone} onChange={(value) => set("phone", value)} hint="Incluye tu país para que podamos contactarte sin errores." />
            <label>{copy.fields.dealership}<input type="text" value={form.dealership} onChange={(event) => set("dealership", event.target.value)} autoComplete="organization" /></label>
            <label className="studio-demo-wide">{copy.fields.size}
              <select value={form.inventorySize} onChange={(event) => set("inventorySize", event.target.value)}>
                <option value="">--</option>
                {copy.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <label className="studio-demo-consent studio-demo-wide">
              <input type="checkbox" required checked={form.consent} onChange={(event) => set("consent", event.target.checked)} />
              <span>{copy.consent}</span>
            </label>
            <button className="studio-primary studio-demo-wide" type="submit" disabled={state === "sending"}>{state === "sending" ? copy.sending : copy.submit}</button>
            {state === "error" && <p className="studio-demo-error" role="alert">{copy.error}</p>}
          </form>}
    </section>
  );
}

// Rejilla de integraciones. Sin logos de terceros: hotlinkear marcas ajenas rompe
// (Chrome las bloquea por ORB) y ademas no son nuestras para redistribuir. El nombre
// y lo que resuelve dicen mas que un icono.
function StudioIntegrations({ copy, reduceMotion }) {
  return (
    <section className="studio-integrations" id="landing-integrations">
      <div className="studio-integrations-head">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{copy.kicker}</StudioReveal>
        <StudioReveal as="h2" delay={0.08} reduceMotion={reduceMotion}>{copy.heading}</StudioReveal>
        <StudioReveal as="p" delay={0.16} reduceMotion={reduceMotion}>{copy.body}</StudioReveal>
      </div>
      <ul className="studio-integrations-grid">
        {copy.items.map((item, index) => (
          <StudioReveal as="li" key={item.name} delay={0.04 + index * 0.04} reduceMotion={reduceMotion}>
            <strong>{item.name}</strong>
            <span>{item.detail}</span>
          </StudioReveal>
        ))}
      </ul>
    </section>
  );
}

// Boton flotante de WhatsApp. Solo aparece si hay un numero configurado en los
// ajustes de la plataforma: preferimos que no exista a inventarnos un contacto.
function StudioWhatsApp({ number, businessName = "ZEVROA", className = "studio-whatsapp", label = "Habla con ventas", ariaLabel = "Hablar con ventas por WhatsApp", messageText = "" }) {
  const digits = whatsappDigits(number);
  if (digits.length < 8) return null;
  const message = messageText || `Hola, quiero conocer cómo ${businessName} puede ayudar a mi concesionario.`;
  const href = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel} title={ariaLabel}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.17c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03s.87 2.35.99 2.51c.12.17 1.71 2.61 4.15 3.66.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29Z" /></svg>
      <span className="studio-whatsapp-label">{label}</span>
    </a>
  );
}

// Acordeón de preguntas frecuentes. Una sola abierta a la vez y la respuesta
// crece con `grid-template-rows`, que sí anima sin saltos de altura.
function StudioFaq({ copy, reduceMotion }) {
  const [openIndex, setOpenIndex] = useState(0);
  return (
    <section className="studio-faq" id="landing-faq">
      <div className="studio-faq-head">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{copy.kicker}</StudioReveal>
        <StudioReveal as="h2" delay={0.08} reduceMotion={reduceMotion}>{copy.heading}</StudioReveal>
      </div>
      <div className="studio-faq-list">
        {copy.items.map((item, index) => {
          const open = openIndex === index;
          return (
            <StudioReveal key={item.q} className={`studio-faq-item${open ? " is-open" : ""}`} delay={0.05 + index * 0.05} reduceMotion={reduceMotion}>
              <button type="button" aria-expanded={open} onClick={() => setOpenIndex(open ? -1 : index)}>
                <span>{item.q}</span>
                <i aria-hidden="true">{open ? "−" : "+"}</i>
              </button>
              <div className="studio-faq-answer" role="region" aria-hidden={!open}><div><p>{item.a}</p></div></div>
            </StudioReveal>
          );
        })}
      </div>
    </section>
  );
}

function StudioHeadline({ lines, className, reduceMotion, delay = 0, as: Tag = "h2", intro = false }) {
  const ref = useRef(null);
  const progress = useScrubbed(ref, { from: 0.95, to: 0.45 });
  return (
    <Tag className={className} ref={ref}>
      {lines.map((line, i) => (
        <StudioHeadlineLine
          key={`${line.t}-${i}`}
          line={line}
          index={i}
          total={lines.length}
          progress={progress}
          reduceMotion={reduceMotion}
          intro={intro}
          delay={delay}
        />
      ))}
    </Tag>
  );
}

function StudioHeadlineLine({ line, index, total, progress, reduceMotion, intro, delay }) {
  // Cada línea ocupa una ventana propia del recorrido; se solapan para que la
  // secuencia se sienta encadenada y no como pasos sueltos.
  const span = 1 / Math.max(1, total);
  const start = Math.min(0.85, index * span * 0.7);
  const end = Math.min(1, start + span * 1.5);
  const y = useTransform(progress, [start, end], reduceMotion ? ["0%", "0%"] : ["112%", "0%"]);
  const opacity = useTransform(progress, [start, end], reduceMotion ? [0, 1] : [1, 1]);
  // El hero se ve antes de cualquier scroll: ahí la entrada sí es temporal.
  const introAnim = intro
    ? {
        initial: reduceMotion ? { opacity: 0 } : { y: "112%" },
        animate: reduceMotion ? { opacity: 1 } : { y: "0%" },
        transition: { duration: reduceMotion ? 0.5 : 0.9, delay: delay + index * (reduceMotion ? 0.05 : 0.085), ease: studioEase },
      }
    : { style: { y, opacity } };
  return (
    <span className="studio-line">
      <motion.span className={line.em ? "studio-line-em" : undefined} {...introAnim}>{line.t}</motion.span>
    </span>
  );
}

// El recorrido de una animación se percibe en proporción a la pantalla: 34px
// sobre 844px de alto se leen, sobre 900px de alto en un monitor de 1440 de
// ancho no. Sin esto la misma animación se siente viva en el móvil e inerte en
// el escritorio, que es exactamente lo que se reportó.
function useMotionScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const measure = () => {
      const w = window.innerWidth;
      // 1 en móvil, con tope en 1.7: por encima de eso el hero recorría más del
      // 45% de la pantalla, y mover un objeto más de un tercio del alto sin una
      // nueva clave espacial se lee como deriva, no como intención.
      setScale(w < 720 ? 1 : Math.min(1.7, 1 + (w - 720) / 900));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return scale;
}

// Parallax de puntero: las capas del hero se separan según dónde está el mouse.
// Es movimiento que solo existe en escritorio y es de lo que más aporta esa
// sensación de que la página está viva aunque no se scrollee.
function usePointerParallax(ref, enabled) {
  const x = useSpring(0, { stiffness: 60, damping: 20, mass: 0.6 });
  const y = useSpring(0, { stiffness: 60, damping: 20, mass: 0.6 });
  useEffect(() => {
    if (!enabled || !ref.current) return undefined;
    if (window.matchMedia("(pointer: coarse)").matches) return undefined;
    const el = ref.current;
    const onMove = (event) => {
      const r = el.getBoundingClientRect();
      x.set(((event.clientX - r.left) / r.width - 0.5) * 2);
      y.set(((event.clientY - r.top) / r.height - 0.5) * 2);
    };
    const onLeave = () => { x.set(0); y.set(0); };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => { el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerleave", onLeave); };
  }, [enabled, ref, x, y]);
  return { px: x, py: y };
}

function updateSpotlight(event) {
  if (event.pointerType === "touch") return;
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--spotlight-x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
  event.currentTarget.style.setProperty("--spotlight-y", `${((event.clientY - rect.top) / rect.height) * 100}%`);
}

function clearSpotlight(event) {
  event.currentTarget.style.removeProperty("--spotlight-x");
  event.currentTarget.style.removeProperty("--spotlight-y");
}

// Recorrido horizontal: la sección se fija y su contenido viaja de derecha a
// izquierda mientras el lector baja. A diferencia de una aparición, aquí los
// elementos sí se desplazan de un lugar a otro de la pantalla, y como está
// atado al progreso, al subir el recorrido se deshace.
function StudioTravelRail({ items, heading, hint, reduceMotion, motionScale = 1 }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  // Arranca fuera por la derecha y termina fuera por la izquierda.
  const x = useTransform(scrollYProgress, [0, 1], ["8%", "-72%"]);
  // Contrapunto: el título se desplaza al revés, más lento, para dar profundidad.
  const headingX = useTransform(scrollYProgress, [0, 1], [`${6 * motionScale}%`, `${-10 * motionScale}%`]);
  const progressScale = useTransform(scrollYProgress, [0, 1], [0, 1]);
  if (!items?.length) return null;
  return (
    <section className="studio-rail" ref={ref} aria-label={heading}>
      <div className="studio-rail-sticky">
        <motion.div className="studio-rail-head" style={reduceMotion ? undefined : { x: headingX }}>
          <h2>{heading}</h2>
          <span><ArrowUpRightIcon size={16} weight="light" aria-hidden="true" />{hint}</span>
        </motion.div>
        <motion.div className="studio-rail-track" style={reduceMotion ? undefined : { x }}>
          {items.map((item) => (
            <article className="studio-rail-card" key={item.name}>
              <img src={item.image} alt={item.alt} loading="lazy" decoding="async" width="900" height="600" />
              <div>
                <strong>{item.name}</strong>
                <span>{item.meta}</span>
              </div>
            </article>
          ))}
        </motion.div>
        <div className="studio-rail-progress" aria-hidden="true">
          <motion.i style={reduceMotion ? { scaleX: 1 } : { scaleX: progressScale }} />
        </div>
      </div>
    </section>
  );
}

// Barra de lectura. En una página de ~6000px el visitante no sabe si le quedan
// dos pantallas o diez, y esa incertidumbre es una razón común para abandonar.
// Se dibuja con scaleX, así que no recalcula layout en ningún cuadro.
function StudioReadingProgress({ reduceMotion }) {
  const { scrollYProgress } = useScroll();
  const width = useSpring(scrollYProgress, reduceMotion ? { duration: 0 } : { stiffness: 120, damping: 28, restDelta: 0.001 });
  return <motion.div className="studio-progress" style={{ scaleX: width }} aria-hidden="true" />;
}

// Cinta de marcas en bucle. Un concesionario compite mostrando de qué firmas
// tiene inventario; una rejilla estática de cuatro logos no comunica amplitud,
// una cinta que sigue corriendo sí. El contenido se duplica para que el salto
// del bucle sea invisible, y la copia va oculta a lectores de pantalla.
function StudioBrandMarquee({ brands, label, reduceMotion }) {
  if (!brands?.length) return null;
  const loop = [...brands, ...brands];
  return (
    <section className="studio-marquee" aria-label={label}>
      <div className="studio-marquee-mask">
        <div className={`studio-marquee-track${reduceMotion ? " is-static" : ""}`}>
          {loop.map((brand, i) => (
            <span className="studio-marquee-item" key={`${brand}-${i}`} aria-hidden={i >= brands.length ? "true" : undefined}>{brand}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function StudioLangToggle({ lang, onChange, label }) {
  const index = Math.max(0, LANDING_LANGUAGES.indexOf(lang));
  return (
    <div className="studio-lang" role="group" aria-label={label} style={{ "--studio-lang-count": LANDING_LANGUAGES.length }}>
      <span className="studio-lang-pill" aria-hidden="true" style={{ transform: `translateX(${index * 100}%)` }} />
      {LANDING_LANGUAGES.map((code) => (
        <button key={code} type="button" className={`studio-lang-option${lang === code ? " is-active" : ""}`} aria-pressed={lang === code} onClick={() => onChange(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function StudioLanding({ onCreateShowroom, onDealerLogin, onViewDemo, onOpenPrivacy, onOpenTerms, testimonials = [], whatsapp = "" }) {
  const prefersReducedMotion = useReducedMotion();
  // El landing siempre conserva sus revelados y su profundidad visual para que
  // no parezca una página rota cuando el sistema tiene activada esa preferencia.
  // El scroll con inercia sí sigue siendo opcional: no secuestramos la rueda a
  // quien pidió menos movimiento, pero el contenido continúa animándose con el
  // scroll nativo y con una amplitud contenida.
  const reduceMotion = false;
  useSmoothScroll(!prefersReducedMotion);
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem("authentiq_landing_lang");
      if (saved && LANDING_LANGUAGES.includes(saved)) return saved;
    } catch { /* almacenamiento bloqueado: seguimos con el idioma por defecto */ }
    return typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("en") ? "en" : "es";
  });
  const t = LANDING_COPY[lang];
  useEffect(() => {
    try { localStorage.setItem("authentiq_landing_lang", lang); } catch { /* sin persistencia: no bloquea la vista */ }
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = previous; };
  }, [lang]);

  const motionScale = useMotionScale();
  const heroRef = useRef(null);
  const proofRef = useRef(null);
  const { scrollYProgress: heroProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const { scrollYProgress: proofProgress } = useScroll({ target: proofRef, offset: ["start end", "end start"] });
  const { scrollY } = useScroll();
  const [navCondensed, setNavCondensed] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setNavCondensed((prev) => {
    const next = v > 120;
    return prev === next ? prev : next;
  }));
  const heroY = useTransform(heroProgress, [0, 1], reduceMotion ? ["0%", "0%"] : ["0%", `${Math.round(18 * motionScale)}%`]);
  const heroScale = useTransform(heroProgress, [0, 1], reduceMotion ? [1, 1] : [1, 1 + 0.12 * motionScale]);
  const heroCopyOpacity = useTransform(heroProgress, [0, 0.72], reduceMotion ? [1, 1] : [1, 0]);
  const heroCopyY = useTransform(heroProgress, [0, 0.72], reduceMotion ? ["0%", "0%"] : ["0%", `${-Math.round(14 * motionScale)}%`]);
  const proofImageY = useTransform(proofProgress, [0, 1], reduceMotion ? ["0%", "0%"] : [`${-Math.round(8 * motionScale)}%`, `${Math.round(12 * motionScale)}%`]);
  // El marco de la prueba también se abre y se vuelve a cerrar con el scroll.
  const proofEnter = useScrubbed(proofRef, { from: 0.95, to: 0.45 });
  const proofOpacity = useTransform(proofEnter, [0, 1], [0.35, 1]);
  const proofInset = useTransform(proofEnter, [0, 1], reduceMotion ? [0, 0] : [8, 0]);
  const proofClip = useMotionTemplate`inset(${proofInset}% ${proofInset}% ${proofInset}% ${proofInset}% round 20px)`;
  // El puntero separa las capas del hero: la foto va al contrario que el texto.
  const { px, py } = usePointerParallax(heroRef, !reduceMotion);
  const heroMediaX = useTransform(px, [-1, 1], [18 * motionScale, -18 * motionScale]);
  const heroMediaY = useTransform(py, [-1, 1], [12 * motionScale, -12 * motionScale]);
  const heroCopyPx = useTransform(px, [-1, 1], [-9 * motionScale, 9 * motionScale]);
  const heroCopyPy = useTransform(py, [-1, 1], [-6 * motionScale, 6 * motionScale]);
  const heroIntro = (delay) => ({
    initial: { opacity: 0, y: reduceMotion ? 0 : 30 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduceMotion ? 0.5 : 0.8, delay, ease: studioEase },
  });

  return (
    <main className="studio-landing" key={lang}>
      <StudioReadingProgress reduceMotion={reduceMotion} />
      <nav className={`studio-nav${navCondensed ? " is-condensed" : ""}`} aria-label={t.navAria}>
        <a className="studio-brand" href="#landing-top">ZEVROA<span>°</span></a>
        <div className="studio-nav-links"><a href="#landing-story">{t.nav.experience}</a><a href="#landing-platform">{t.nav.platform}</a><a href="#landing-product">{t.nav.how}</a><a href="#landing-pricing">{t.pricing.kicker}</a><button type="button" className="studio-navlink" onClick={onViewDemo}>{t.nav.demo}</button></div>
        <div className="studio-nav-actions">
          <StudioLangToggle lang={lang} onChange={setLang} label={t.langAria} />
          <button type="button" className="studio-login" onPointerEnter={loadBackoffice} onFocus={loadBackoffice} onClick={onDealerLogin}>{t.nav.login}</button>
          <button type="button" className="studio-cta" onPointerEnter={loadBackoffice} onFocus={loadBackoffice} onClick={onCreateShowroom}>{t.nav.cta} <span>↗</span></button>
        </div>
      </nav>

      <section ref={heroRef} className="studio-hero" id="landing-top">
        <motion.div className="studio-hero-media" style={{ y: heroY, scale: heroScale, x: heroMediaX, translateY: heroMediaY }} initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.14 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduceMotion ? 0.6 : 1.4, ease: studioEase }} aria-hidden="true"><img src="/assets/zevroa-hero-v1.webp" alt="" /><div className="studio-hero-shade" /></motion.div>
        <motion.div className="studio-hero-copy" style={{ opacity: heroCopyOpacity, y: heroCopyY, x: heroCopyPx, translateY: heroCopyPy }}>
          <motion.span className="studio-kicker" {...heroIntro(0.1)}>{t.hero.kicker}</motion.span>
          <StudioHeadline as="h1" lines={t.hero.lines} reduceMotion={reduceMotion} delay={0.22} intro />
          <motion.p {...heroIntro(0.6)}>{t.hero.body}</motion.p>
          <motion.div className="studio-actions" {...heroIntro(0.72)}><button type="button" className="studio-primary" onClick={onCreateShowroom}>{t.hero.primary} <span>↗</span></button><button type="button" className="studio-link" onClick={onViewDemo}>{t.hero.secondary} <span>↓</span></button></motion.div>
        </motion.div>
        <div className="studio-hero-meta"><span>{t.hero.metaLeft}</span><span>{t.hero.metaRight}</span></div>
      </section>

      <div className="studio-proof-ground">
      <section ref={proofRef} className="studio-proof" id="landing-story">
        <div className="studio-proof-copy">
          <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{t.proof.kicker}</StudioReveal>
          <StudioHeadline lines={t.proof.lines} reduceMotion={reduceMotion} delay={0.05} />
          <StudioReveal as="p" delay={0.16} reduceMotion={reduceMotion}>{t.proof.body}</StudioReveal>
          <StudioReveal delay={0.24} reduceMotion={reduceMotion}><button type="button" className="studio-text-action" onClick={onViewDemo}>{t.proof.action} <span>↗</span></button></StudioReveal>
        </div>
        {/* Aqui iba otra foto de coche. Un concesionario ya sabe como es un coche;
            lo que necesita ver antes de decidir es la herramienta que va a usar. */}
        <motion.div className="studio-proof-stage is-product" style={{ clipPath: proofClip, opacity: proofOpacity }}>
          <motion.img style={{ y: proofImageY }} src="/assets/panel-inventario.webp" alt={t.proof.imageAlt} loading="lazy" decoding="async" width="1200" height="533" />
          <div className="studio-proof-overlay">
            <span>{t.proof.overlayTag}</span>
            <StudioHeadline as="strong" lines={t.proof.overlayLines} reduceMotion={reduceMotion} delay={0.3} />
            <small>{t.proof.overlayMeta}</small>
          </div>
        </motion.div>
      </section>
      </div>

      <StudioPains copy={t.pains} reduceMotion={reduceMotion} />
      <StudioPlatformSection data={t.platform} reduceMotion={reduceMotion} onViewDemo={onViewDemo} motionScale={motionScale} />
      <StudioServiceFlow copy={t.serviceFlow} reduceMotion={reduceMotion} motionScale={motionScale} />

      <StudioBrandMarquee brands={t.marqueeBrands} label={t.marqueeLabel} reduceMotion={reduceMotion} />

      <StudioTravelRail items={t.rail.items} heading={t.rail.heading} hint={t.rail.hint} reduceMotion={reduceMotion} motionScale={motionScale} />

      <StudioChapters reduceMotion={reduceMotion} onViewDemo={onViewDemo} chapters={t.chapters} motionScale={motionScale} />

      {/* Precio y dudas. El landing enseñaba la experiencia pero no respondía las dos
          preguntas con las que un concesionario decide: cuánto cuesta y qué pasa después.
          Los importes son los mismos que el panel cobra en Plan y facturación. */}
      <StudioIntegrations copy={t.integrations} reduceMotion={reduceMotion} />

      <StudioCompare copy={t.compare} reduceMotion={reduceMotion} />
      <StudioVoices copy={t.voices} items={testimonials} reduceMotion={reduceMotion} />

      <section className="studio-pricing" id="landing-pricing">
        <div className="studio-pricing-head">
          <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{t.pricing.kicker}</StudioReveal>
          <StudioReveal as="h2" delay={0.08} reduceMotion={reduceMotion}>{t.pricing.heading}</StudioReveal>
          <StudioReveal as="p" delay={0.16} reduceMotion={reduceMotion}>{t.pricing.body}</StudioReveal>
        </div>
        <div className="studio-plan-grid">
          {t.pricing.plans.map((plan, index) => (
            <StudioReveal key={plan.code} className={`studio-plan${plan.featured ? " is-featured" : ""}`} delay={0.1 + index * 0.08} reduceMotion={reduceMotion}>
              <span className="studio-plan-name">{plan.name}</span>
              <span className="studio-plan-price"><b>${plan.price}</b><i>{t.pricing.perMonth}</i></span>
              <span className="studio-plan-limit">{plan.limit}</span>
              <p>{plan.body}</p>
              <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
              <button type="button" className={plan.featured ? "studio-primary" : "studio-plan-action"} onClick={() => document.getElementById("landing-demo")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{t.pricing.cta} <span>↘</span></button>
            </StudioReveal>
          ))}
        </div>
        <StudioReveal as="small" className="studio-pricing-note" delay={0.3} reduceMotion={reduceMotion}>{t.pricing.note}</StudioReveal>
      </section>

      <StudioFaq copy={t.faq} reduceMotion={reduceMotion} />

      <StudioDemoForm copy={t.demo} reduceMotion={reduceMotion} onCreateShowroom={onCreateShowroom} />

      <section className="studio-close">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{t.close.kicker}</StudioReveal>
        <StudioHeadline lines={t.close.lines} reduceMotion={reduceMotion} delay={0.08} />
        <StudioReveal delay={0.3} reduceMotion={reduceMotion}><button type="button" className="studio-primary" onClick={onCreateShowroom}>{t.close.cta} <span>↗</span></button></StudioReveal>
      </section>
      {/* El pie era una línea con dos enlaces legales. En móvil la barra oculta
          navegación y acceso, así que este es el único sitio donde un dealer que ya
          tiene cuenta puede entrar, o ver planes y preguntas. */}
      <footer className="studio-footer">
        <div className="studio-footer-brand"><span>ZEVROA°</span><small>{t.footer.tagline}</small></div>
        <nav className="studio-footer-nav" aria-label={t.navAria}>
          <a href="#landing-platform">{t.nav.platform}</a>
          <a href="#landing-pricing">{t.pricing.kicker}</a>
          <a href="#landing-faq">{t.faq.kicker}</a>
          <button type="button" onClick={onViewDemo}>{t.nav.demo}</button>
          <button type="button" onClick={onDealerLogin}>{t.nav.login}</button>
        </nav>
        <div className="studio-footer-end">
          <nav className="studio-footer-legal" aria-label={t.footer.legalNav}>
            <button type="button" onClick={onOpenPrivacy}>{t.footer.privacy}</button>
            <button type="button" onClick={onOpenTerms}>{t.footer.terms}</button>
          </nav>
          {/* En pantallas estrechas la píldora superior solo tiene sitio para acceso
              y CTA, así que el idioma se cambia desde aquí. */}
          <div className="studio-footer-lang"><StudioLangToggle lang={lang} onChange={setLang} label={t.langAria} /></div>
        </div>
      </footer>
      {/* Contacto comercial de la plataforma: los showrooms de dealers siguen
          usando exclusivamente el número configurado en sus propios ajustes. */}
      <StudioWhatsApp number={whatsapp || "829 944 0111"} businessName="ZEVROA" />
    </main>
  );
}

function StudioPlatformSection({ data, reduceMotion, onViewDemo, motionScale = 1 }) {
  return (
      <section className="studio-platform" id="landing-platform">
      <div className="studio-platform-head">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{data.kicker}</StudioReveal>
        <StudioHeadline lines={data.lines} reduceMotion={reduceMotion} delay={0.05} />
        <StudioReveal as="p" delay={0.16} reduceMotion={reduceMotion}>{data.body}</StudioReveal>
      </div>
      <div className="studio-platform-grid">
        {data.items.map((item, index) => (
          <StudioDrift key={item.index} className="studio-platform-card" depth={18 + index * 8} delay={0.04 + index * 0.06} reduceMotion={reduceMotion} motionScale={motionScale}>
            <div className="studio-platform-card-top"><span className="studio-platform-index">{item.index}</span><LandingPlatformIcon index={index} /></div>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
            <ArrowUpRightIcon className="studio-platform-arrow" size={21} weight="light" aria-hidden="true" />
          </StudioDrift>
        ))}
      </div>
      <StudioReveal delay={0.24} reduceMotion={reduceMotion}>
        <button type="button" className="studio-text-action studio-platform-action" onClick={onViewDemo}>{data.action} <span>↗</span></button>
      </StudioReveal>
    </section>
  );
}

function StudioServiceFlow({ copy, reduceMotion, motionScale = 1 }) {
  const icons = [CarSimpleIcon, ChatsCircleIcon, CalendarBlankIcon, ChartLineUpIcon, GlobeHemisphereWestIcon];
  return (
    <section className="studio-service-flow" id="landing-flow" aria-labelledby="studio-service-flow-title">
      <div className="studio-service-flow-head">
        <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{copy.kicker}</StudioReveal>
        <StudioReveal as="h2" id="studio-service-flow-title" delay={0.08} reduceMotion={reduceMotion}>{copy.heading}</StudioReveal>
        <StudioReveal as="p" delay={0.16} reduceMotion={reduceMotion}>{copy.body}</StudioReveal>
      </div>
      <div className="studio-service-flow-track" aria-label={copy.ariaLabel}>
        {copy.items.map((item, index) => {
          const Icon = icons[index] || SquaresFourIcon;
          return (
            <StudioDrift key={item.index} className="studio-service-flow-card" depth={10 + index * 5} delay={0.04 + index * 0.05} reduceMotion={reduceMotion} motionScale={motionScale}>
              <div className="studio-service-flow-card-top">
                <span className="studio-service-flow-index">{item.index}</span>
                <span className="studio-service-flow-icon" aria-hidden="true"><Icon size={23} weight="light" /></span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <span className="studio-service-flow-status"><i aria-hidden="true" />{item.status}</span>
            </StudioDrift>
          );
        })}
      </div>
    </section>
  );
}

function LandingPlatformIcon({ index }) {
  const icons = [CarSimpleIcon, UsersThreeIcon, CalendarBlankIcon, FileTextIcon];
  const Icon = icons[index] || SquaresFourIcon;
  return <span className="studio-platform-icon" aria-hidden="true"><Icon size={24} weight="light" /></span>;
}

function StudioChapterMedia({ src, alt, reduceMotion, motionScale = 1 }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const reach = Math.round(7 * motionScale);
  const y = useTransform(scrollYProgress, [0, 1], reduceMotion ? ["0%", "0%"] : [`-${reach}%`, `${reach}%`]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], reduceMotion ? [1, 1, 1] : [1 + 0.07 * motionScale, 1.01, 1 + 0.07 * motionScale]);
  return (
    <div className="studio-chapter-media" ref={ref}>
      <motion.img style={reduceMotion ? undefined : { y, scale }} src={src} alt={alt} loading="lazy" />
    </div>
  );
}

// Continuous drift as the element crosses the viewport, plus a one-time entrance.
// The drift is what keeps the page feeling alive between reveals.
function StudioDrift({ children, className, depth = 28, delay = 0, reduceMotion, motionScale = 1 }) {
  const ref = useRef(null);
  // Deriva continua mientras cruza el viewport.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const reach = depth * motionScale;
  const y = useTransform(scrollYProgress, [0, 1], reduceMotion ? [0, 0] : [reach, -reach]);
  // Y la aparición también va atada al scroll, no a un disparo único: al subir,
  // la tarjeta se vuelve a guardar en lugar de quedarse visible.
  const start = Math.min(0.5, delay);
  const enter = useScrubbed(ref, { from: 0.95 - start * 0.2, to: 0.55 });
  const opacity = useTransform(enter, [0, 1], [0, 1]);
  const enterY = useTransform(enter, [0, 1], [reduceMotion ? 0 : 34, 0]);
  return (
    <motion.div ref={ref} className="studio-drift" style={reduceMotion ? undefined : { y }}>
      <motion.div className={className} style={{ opacity, y: enterY }} onPointerMove={reduceMotion ? undefined : updateSpotlight} onPointerLeave={reduceMotion ? undefined : clearSpotlight}>
        {children}
      </motion.div>
    </motion.div>
  );
}

// The thread draws itself as the chapter passes — Novo's signature connective move.
function StudioThread({ reduceMotion }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });
  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <svg ref={ref} className="studio-thread" viewBox="0 0 40 620" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <motion.path
        d="M20 4 C 4 130, 36 210, 20 310 C 4 410, 36 490, 20 616"
        fill="none"
        stroke="var(--studio-gold)"
        strokeWidth="1.4"
        strokeLinecap="round"
        style={reduceMotion ? { pathLength: 1 } : { pathLength }}
      />
    </svg>
  );
}

function StudioChapters({ reduceMotion, onViewDemo, chapters, motionScale = 1 }) {
  const ref = useRef(null);
  const [publish, respond, close] = chapters;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const amp = (v) => `${Math.round(v * motionScale)}%`;
  const glowOneY = useTransform(scrollYProgress, [0, 1], reduceMotion ? ["0%", "0%"] : [amp(-14), amp(26)]);
  const glowTwoY = useTransform(scrollYProgress, [0, 1], reduceMotion ? ["0%", "0%"] : [amp(18), amp(-22)]);
  const glowThreeX = useTransform(scrollYProgress, [0, 1], reduceMotion ? ["0%", "0%"] : [amp(-8), amp(10)]);
  const veilOpacity = useTransform(scrollYProgress, [0, 0.5, 1], reduceMotion ? [0.5, 0.5, 0.5] : [0.25, 0.6, 0.25]);
  return (
    <div className="studio-chapters" id="landing-product" ref={ref}>
      <div className="studio-ambient" aria-hidden="true">
        <motion.span className="studio-ambient-one" style={reduceMotion ? undefined : { y: glowOneY, opacity: veilOpacity }} />
        <motion.span className="studio-ambient-two" style={reduceMotion ? undefined : { y: glowTwoY }} />
        <motion.span className="studio-ambient-three" style={reduceMotion ? undefined : { x: glowThreeX }} />
      </div>

      <section className="studio-chapter">
        <div className="studio-chapter-copy">
          <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{publish.kicker}</StudioReveal>
          <StudioHeadline lines={publish.lines} reduceMotion={reduceMotion} delay={0.05} />
          <StudioReveal as="p" delay={0.18} reduceMotion={reduceMotion}>{publish.body}</StudioReveal>
        </div>
        <div className="studio-chapter-panel">
          <StudioDrift depth={34} delay={0.08} reduceMotion={reduceMotion} motionScale={motionScale}>
            <StudioChapterMedia src="/assets/audi-etron-gt.jpg" alt={publish.mediaAlt} reduceMotion={reduceMotion} motionScale={motionScale} />
          </StudioDrift>
          <StudioDrift className="studio-card studio-card-float" depth={62} delay={0.2} reduceMotion={reduceMotion} motionScale={motionScale}>
            <div className="studio-card-top"><span>{publish.card.tag}</span><b>{publish.card.status}</b></div>
            <div className="studio-card-vehicle">
               <img src="/assets/taycan-turbo-s-2.webp" alt="Porsche Taycan Turbo S destacado" />
              <div><strong>{publish.card.title}</strong><span>{publish.card.meta}</span></div>
            </div>
          </StudioDrift>
        </div>
      </section>

      <section className="studio-chapter">
        <div className="studio-chapter-copy">
          <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{respond.kicker}</StudioReveal>
          <StudioHeadline lines={respond.lines} reduceMotion={reduceMotion} delay={0.05} />
          <StudioReveal as="p" delay={0.18} reduceMotion={reduceMotion}>{respond.body}</StudioReveal>
        </div>
        <div className="studio-chapter-panel studio-chapter-thread">
          <StudioThread reduceMotion={reduceMotion} />
          {respond.steps.map((step, i) => (
            <StudioDrift key={step.index} className="studio-card" depth={20 + i * 28} delay={0.06 + i * 0.08} reduceMotion={reduceMotion} motionScale={motionScale}>
              <span className="studio-card-index">{step.index}</span>
              <h3>{step.title}</h3>
              {step.quote ? <p className="studio-card-quote">{step.quote}</p> : <p>{step.body}</p>}
              {step.meta && <span className="studio-card-meta">{step.meta}</span>}
            </StudioDrift>
          ))}
        </div>
      </section>

      <section className="studio-chapter">
        <div className="studio-chapter-copy">
          <StudioReveal as="span" className="studio-kicker" reduceMotion={reduceMotion}>{close.kicker}</StudioReveal>
          <StudioHeadline lines={close.lines} reduceMotion={reduceMotion} delay={0.05} />
          <StudioReveal as="p" delay={0.18} reduceMotion={reduceMotion}>{close.body}</StudioReveal>
          <StudioReveal delay={0.26} reduceMotion={reduceMotion}>
            <button type="button" className="studio-primary" onClick={onViewDemo}>{close.action} <span>↗</span></button>
          </StudioReveal>
        </div>
        <div className="studio-chapter-panel">
          <StudioDrift className="studio-card studio-card-appointment" depth={30} delay={0.06} reduceMotion={reduceMotion} motionScale={motionScale}>
            <div className="studio-card-top"><span>{close.appointment.tag}</span><b>{close.appointment.status}</b></div>
            <strong className="studio-card-time">{close.appointment.time}</strong>
            <span className="studio-card-meta">{close.appointment.meta}</span>
          </StudioDrift>
          <StudioDrift className="studio-list" depth={58} delay={0.16} reduceMotion={reduceMotion} motionScale={motionScale}>
            {close.list.map((item) => <div key={item.title}><h3>{item.title}</h3><p>{item.body}</p></div>)}
          </StudioDrift>
        </div>
      </section>
    </div>
  );
}

function FinanceCalculator({ price, vehicle, onApplyFinancing, whatsapp = "", businessName = getBrandName() }) {
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

  const whatsappNumber = whatsappDigits(whatsapp);
  const whatsappFinancingMessage = encodeURIComponent(
    `Hola, me interesa el ${vehicle?.brand || ""} ${vehicle?.model || ""}${vehicle?.year ? ` ${vehicle.year}` : ""} en ${businessName}. Calculé una cuota estimada de $${Math.round(payment).toLocaleString("en-US")} USD/mes (Inicial: $${downPayment.toLocaleString("en-US")} USD · Plazo: ${months} meses). ¿Tienen opciones de crédito disponibles? Ficha: ${window.location.origin}${vehicle ? vehiclePath(vehicle) : ""}`
  );
  const whatsappFinancingHref = `https://wa.me/${whatsappNumber}?text=${whatsappFinancingMessage}`;

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

        <div className="financing-actions-stack">
          <button
            className="primary-action"
            type="button"
            onClick={() => onApplyFinancing?.({ downPayment, downPercent, months, rate, monthlyPayment: payment })}
            style={{ width: "100%" }}
          >
            Solicitar financiamiento →
          </button>
          {whatsappNumber ? (
            <a
              className="secondary-action financing-whatsapp-btn"
              href={whatsappFinancingHref}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackEvent("whatsapp_click", { vehicleId: vehicle?.id, context: "financing" })}
            >
              💬 Consultar este plan por WhatsApp
            </a>
          ) : null}
        </div>
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
          phone: normalizePhone(form.phone),
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
                <PhoneField label="WhatsApp / Teléfono" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} required hint="Selecciona tu país e introduce el número donde responderás." />
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
      const response = await fetch(`${apiUrl}/api/leads`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("vehicle-lead") }, body: JSON.stringify({ name: form.name, email: form.email, phone: normalizePhone(form.phone), vehicleId: vehicle?.id || null, message: requestMessage, privacyConsent: form.privacyConsent, turnstileToken }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo registrar tu solicitud");
      trackEvent(isTradeIn ? "trade_in_submitted" : "search_alert_submitted", vehicle ? { vehicleId: vehicle.id } : {});
      setStatus({ loading: false, error: "", success: true });
    } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  return (
    <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className="lead-modal buyer-request-modal" role="dialog" aria-modal="true" aria-labelledby="buyer-request-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        {status.success ? (
          <div className="lead-success">
            <span className="eyebrow">SOLICITUD RECIBIDA</span>
            <h2>{isTradeIn ? "Revisaremos tu vehículo." : "Te avisaremos cuando aparezca."}</h2>
            <p>{isTradeIn ? "Un asesor revisará la información y te contactará para conocer el estado y la mejor forma de avanzar." : "Guardamos tu búsqueda. El equipo te escribirá cuando haya una opción relevante."}</p>
            <button className="primary-action" type="button" onClick={onClose}>Listo</button>
          </div>
        ) : (
          <>
            <span className="eyebrow">{isTradeIn ? "RENUEVA TU VEHÍCULO" : "BÚSQUEDA PERSONALIZADA"}</span>
            <h2 id="buyer-request-title">{title}</h2>
            <p className="buyer-request-intro">{subtitle}</p>
            <div className="buyer-request-progress" aria-label={`Paso ${step} de 2`}>
              <span className={step === 1 ? "is-active" : "is-done"}>1. Tus datos</span>
              <i aria-hidden="true" />
              <span className={step === 2 ? "is-active" : ""}>2. Lo que necesitas</span>
            </div>
            <form className="lead-form" onSubmit={(event) => { if (step === 1) { event.preventDefault(); advance(); } else submit(event); }}>
              {step === 1 ? (
                <>
                  <p className="buyer-request-step-note">Primero deja una forma de contactarte. Toma menos de un minuto.</p>
                  <label>Nombre<input value={form.name} onChange={(event) => change("name", event.target.value)} autoComplete="name" required /></label>
                  <div className="lead-form-grid">
                    <label>Correo<input type="email" value={form.email} onChange={(event) => change("email", event.target.value)} autoComplete="email" required /></label>
                    <PhoneField label="WhatsApp / Teléfono" value={form.phone} onChange={(value) => change("phone", value)} required hint="Selecciona tu país e introduce tu número." />
                  </div>
                  {status.error && <p className="state-message error" role="alert">{status.error}</p>}
                  <button className="primary-action" type="button" onClick={advance}>Continuar →</button>
                </>
              ) : (
                <>
                  <p className="buyer-request-step-note">Cuéntanos lo esencial para que el asesor llegue preparado.</p>
                  <label>{isTradeIn ? "Marca y modelo de tu vehículo" : "Qué vehículo estás buscando"}<input value={form.currentVehicle} onChange={(event) => change("currentVehicle", event.target.value)} placeholder={isTradeIn ? "Ej. Toyota RAV4 Limited" : "Ej. SUV familiar, 3 filas, automático"} required /></label>
                  <div className="lead-form-grid">
                    <label>{isTradeIn ? "Año" : "Año desde (opcional)"}<input type="number" min="1900" max="2100" value={form.year} onChange={(event) => change("year", event.target.value)} /></label>
                    {isTradeIn && <label>Kilometraje aproximado<input type="number" min="0" value={form.mileage} onChange={(event) => change("mileage", event.target.value)} /></label>}
                  </div>
                  <label>{isTradeIn ? "Estado o detalles relevantes (opcional)" : "Presupuesto, uso o preferencias (opcional)"}<textarea value={form.note} onChange={(event) => change("note", event.target.value)} placeholder={isTradeIn ? "Mantenimiento, daños, versión o extras…" : "Rango de precio, combustible, uso familiar, etc."} /></label>
                  <TurnstileField onTokenChange={setTurnstileToken} />
                  <label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => change("privacyConsent", event.target.checked)} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para responder esta solicitud.</span></label>
                  {status.error && <p className="state-message error" role="alert">{status.error}</p>}
                  <div className="buyer-request-actions">
                    <button className="text-button" type="button" onClick={() => setStep(1)}>← Volver</button>
                    <button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando…" : isTradeIn ? "Solicitar orientación" : "Guardar mi búsqueda"}</button>
                  </div>
                </>
              )}
            </form>
          </>
        )}
      </motion.section>
    </motion.div>
  );
}

function QuoteModal({ vehicle, financingTerms, onClose, businessName = getBrandName() }) {
  const dialogRef = useAccessibleDialog(onClose);
  const quoteFolio = useMemo(() => `COT-${String(vehicle?.brand || "ZEV").slice(0, 3).toUpperCase()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`, [vehicle]);
  const validUntil = useMemo(() => {
    const target = new Date();
    target.setDate(target.getDate() + 15);
    return new Intl.DateTimeFormat("es-DO", { day: "2-digit", month: "long", year: "numeric" }).format(target);
  }, []);
  const vehicleUrl = `${window.location.origin}${vehiclePath(vehicle)}`;
  const qrSvg = useMemo(() => generateQRCodeSVG(vehicleUrl, 100), [vehicleUrl]);

  return (
    <motion.div className="quote-overlay" role="dialog" aria-modal="true" aria-label="Cotización del vehículo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <section ref={dialogRef} className="quote-modal printable-quote-sheet">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar cotización">×</button>
        <div className="quote-sheet-header">
          <div>
            <div className="quote-brand">{businessName} <span>PROPUESTA COMERCIAL</span></div>
            <div className="quote-folio-meta">
              <span>Folio: <strong>{quoteFolio}</strong></span>
              <span>Vigente hasta: <strong>{validUntil}</strong></span>
            </div>
          </div>
          {qrSvg && (
            <div
              className="quote-qr-block"
              title="Escanea para consultar la ficha en vivo"
              aria-label="Código QR para ver la ficha en vivo"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
        </div>
        <div className="quote-heading">
          <span className="eyebrow">VEHÍCULO COTIZADO</span>
          <h2><TextReveal>{vehicle.brand}</TextReveal> <em><TextReveal delay={0.06}>{vehicle.model}</TextReveal></em></h2>
          <p>{vehicle.year} · {vehicle.variant || "Versión Estándar"} · {vehicle.condition === "new" ? "Nuevo inventario" : "Certificado"}</p>
        </div>
        <div className="quote-price">
          <span>Precio de lista</span>
          <strong><AnimatedNumber value={vehicle.priceUsd} format={(number) => `$${number.toLocaleString("en-US")} USD`} /></strong>
        </div>
        {financingTerms && <Disclosure title="Simulación financiera estimada" defaultOpen>
          <div className="quote-financing-summary">
            <span>Inicial sugerida: <strong><AnimatedNumber value={financingTerms.downPayment} format={(number) => `$${number.toLocaleString("en-US")} USD`} /></strong></span>
            <span>Plazo: <strong><AnimatedNumber value={financingTerms.months} suffix=" meses" /></strong></span>
            <span>Cuota estimada: <strong><AnimatedNumber value={financingTerms.monthlyPayment} format={formatFinancePrice} />/mes</strong></span>
          </div>
        </Disclosure>}
        <div className="quote-specs">
          <span>Motor <b>{vehicle.engine || "—"}</b></span>
          <span>Potencia <b>{vehicle.power || "—"}</b></span>
          <span>Transmisión <b>{vehicle.transmission || "—"}</b></span>
          <span>Kilometraje <b>{Number(vehicle.mileageKm || 0).toLocaleString("en-US")} km</b></span>
          <span>Garantía <b>{vehicle.warranty || "Garantía de concesionario"}</b></span>
        </div>
        <p className="quote-note">Esta propuesta comercial es informativa y está sujeta a disponibilidad del inventario, inspección física y aprobación crediticia final.</p>
        <div className="quote-actions">
          <button className="primary-action" type="button" onClick={() => window.print()}>🖨️ Imprimir / Guardar en PDF</button>
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
  useEffect(() => { document.title = quote ? `${quote.quoteNumber} · ZEVROA` : "Cotización · ZEVROA"; setRobots(false); }, [quote]);
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
  if (state === "error" || !quote) return <main className="public-quote-page"><section className="public-quote-error"><span className="eyebrow">ZEVROA · PROPUESTA</span><h1>Este enlace ya no está disponible.</h1><p>La cotización pudo vencer, cancelarse o el enlace pudo expirar.</p></section></main>;
  const accepted = quote.status === "accepted" || (decisionState === "success" && decision === "accepted");
  return (
    <main className="public-quote-page">
      <article className="public-quote-card">
        <header>
          <span className="brand-mark">ZEVROA°</span>
          <span className="eyebrow">PROPUESTA COMERCIAL · {quote.quoteNumber}</span>
        </header>
        {quote.imageUrl && <img className="public-quote-image" src={publicMediaUrl(quote.imageUrl)} alt={`${quote.brand || "Vehículo"} ${quote.model || ""}`} />}
        <div className="public-quote-heading">
          <span className="eyebrow">PREPARADA PARA {quote.customerName}</span>
          <h1>{quote.brand ? `${quote.brand} ${quote.model}` : "Tu vehículo seleccionado"}</h1>
          <p>{quote.year ? `${quote.year} · ` : ""}{quote.variant || "Propuesta ZEVROA"}</p>
        </div>
        <div className="public-quote-price">
          <span>Total propuesto</span>
          <strong>{formatPrice(quote.totalUsd)}</strong>
          {quote.validUntil && <small>Válida hasta {dateLabel(quote.validUntil)}</small>}
        </div>
        <div className="public-quote-specs">
          <span>Precio base <b>{formatPrice(quote.basePriceUsd)}</b></span>
          <span>Descuento <b>{Number(quote.discountUsd) ? `-${formatPrice(quote.discountUsd)}` : "Sin descuento"}</b></span>
          <span>Condición <b>{accepted ? "Aceptada" : "Enviada"}</b></span>
        </div>
        {quote.notes && <p className="public-quote-notes">{quote.notes}</p>}
        {accepted ? (
          <section className="public-quote-feedback success" aria-live="polite">
            <strong>✓ Cotización aceptada</strong>
            <p>Gracias. Nuestro equipo continuará contigo para coordinar los próximos pasos.</p>
          </section>
        ) : decisionState === "success" && decision === "changes" ? (
          <section className="public-quote-feedback success" aria-live="polite">
            <strong>✓ Solicitud recibida</strong>
            <p>Registramos tus cambios. Un asesor se pondrá en contacto contigo.</p>
          </section>
        ) : (
          <section className="public-quote-decisions" aria-label="Decidir sobre la cotización">
            <div>
              <span className="eyebrow">SIGUIENTE PASO</span>
              <h2>¿Cómo quieres continuar?</h2>
              <p>Acepta la propuesta o indícanos qué te gustaría ajustar.</p>
            </div>
            <div className="public-quote-decision-actions">
              <button className="primary-action" type="button" onClick={() => submitDecision("accepted")} disabled={decisionState === "sending"}>✓ Aceptar cotización</button>
              <button className="secondary-action" type="button" onClick={() => setDecisionState("writing")} disabled={decisionState === "sending"}>Solicitar cambios</button>
            </div>
            {decisionState === "writing" && (
              <div className="public-quote-change-form">
                <label htmlFor="quote-change-message">¿Qué te gustaría ajustar? <span>Opcional</span></label>
                <textarea id="quote-change-message" value={decisionMessage} maxLength={500} onChange={(event) => setDecisionMessage(event.target.value)} placeholder="Ej. Me gustaría revisar el descuento o la forma de pago." />
                <div>
                  <small>{decisionMessage.length}/500</small>
                  <button className="primary-action" type="button" onClick={() => submitDecision("changes")} disabled={decisionState === "sending"}>{decisionState === "sending" ? "Enviando…" : "Enviar solicitud"}</button>
                </div>
              </div>
            )}
            {decisionError && <p className="public-quote-decision-error" role="alert">{decisionError}</p>}
          </section>
        )}
        <footer>
          <span>Informativa y sujeta a disponibilidad, inspección y aprobación comercial.</span>
          <button className="primary-action" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button>
        </footer>
      </article>
    </main>
  );
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
    <div className="vehicle-studio-heading"><div><span className="eyebrow">ZEVROA / REAL 3D</span><h2>Explóralo en detalle.</h2></div><span className="vehicle-3d-status">{state === "ready" ? "MODELO LISTO" : state === "error" ? "NO DISPONIBLE" : "CARGANDO MODELO"}</span></div>
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
  return <section className="vehicle-video-showcase" aria-label={`Video de ${vehicle.brand} ${vehicle.model}`}><div className="vehicle-studio-heading"><div><span className="eyebrow">ZEVROA / MOTION FILM</span><h2>Verlo en movimiento.</h2></div><span className="vehicle-3d-status">VIDEO OFICIAL</span></div><div className="vehicle-video-frame"><video controls playsInline preload="metadata" poster={publicMediaUrl(video.posterUrl || vehicle.images?.[0]?.url)} aria-label={`Video de ${vehicle.brand} ${vehicle.model}`} onError={() => setFailed(true)}><source src={publicMediaUrl(video.url)} onError={() => setFailed(true)} /></video></div></section>;
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
    <div className="vehicle-studio-heading"><div><span className="eyebrow">ZEVROA / VISTA 360</span><h2>Mira alrededor.</h2></div><span className="vehicle-3d-status">{state === "ready" ? "PANORAMA LISTO" : "CARGANDO VISTA"}</span></div>
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
  const whatsappNumber = whatsappDigits(whatsapp);
  const whatsappText = encodeURIComponent(`Mira este ${vehicle.brand} ${vehicle.model} en ${businessName}: ${window.location.origin}${vehiclePath(vehicle)}`);
  const whatsappHref = `https://wa.me/${whatsappNumber}${whatsappText ? `?text=${whatsappText}` : ""}`;
  const [shareStatus, setShareStatus] = useState("");
  const reduceMotion = useReducedMotion();
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
      onPointerMove={reduceMotion ? undefined : updateSpotlight}
      onPointerLeave={reduceMotion ? undefined : clearSpotlight}
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
    const body = { vehicleId: vehicle.id, ...form, buyerPhone: normalizePhone(form.buyerPhone), amountUsd: Number(form.amountUsd), turnstileToken };
    try {
      const response = await fetch(`${apiUrl}/api/offers`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("offer"), ...(customerToken ? { Authorization: `Bearer ${customerToken}` } : {}) }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar la solicitud");
      trackEvent("offer_submitted", { vehicleId: vehicle.id });
      setStatus({ loading: false, error: "", success: true });
    } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  return <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }}><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>{status.success ? <div className="lead-success"><span className="eyebrow">OFERTA RECIBIDA</span><h2>Tu oferta está en revisión.</h2><p>El equipo de {getBrandName()} revisará los datos y se pondrá en contacto contigo.</p><button className="primary-action" type="button" onClick={onClose}>Cerrar</button></div> : <><span className="eyebrow">CONTACTO COMERCIAL</span><h2 id="lead-title">Hacer una oferta.</h2><p className="modal-vehicle">{vehicle.brand} {vehicle.model} · {formatPrice(vehicle.priceUsd)}</p><form className="lead-form" onSubmit={submit}><label>Nombre<input value={form.buyerName} onChange={(event) => change("buyerName", event.target.value)} required /></label><div className="lead-form-grid"><label>Correo<input type="text" inputMode="email" autoComplete="email" value={form.buyerEmail} onChange={(event) => change("buyerEmail", event.target.value)} /></label><PhoneField label="Teléfono" value={form.buyerPhone} onChange={(value) => change("buyerPhone", value)} hint="Selecciona tu país e introduce tu número." /></div><label>Monto de oferta USD<input type="number" min="1" step="0.01" value={form.amountUsd} onChange={(event) => change("amountUsd", event.target.value)} required /></label><label>Mensaje<textarea value={form.message} onChange={(event) => change("message", event.target.value)} placeholder="Cuéntanos algo sobre tu propuesta..." /></label><TurnstileField onTokenChange={setTurnstileToken} /><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => change("privacyConsent", event.target.checked)} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para esta solicitud.</span></label>{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando…" : "Enviar oferta"}</button></form></>}</motion.section></motion.div>;
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
    try { const response = await fetch(`${apiUrl}/api/appointments`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("appointment") }, body: JSON.stringify({ ...form, phone: normalizePhone(form.phone), vehicleId: vehicle.id, turnstileToken }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo registrar la cita"); trackEvent("appointment_submitted", { vehicleId: vehicle.id }); setStatus({ loading: false, error: "", success: true }); } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  const minDate = localIsoDate();
  const dateOptions = Array.from({ length: 10 }, (_, index) => {
    const date = new Date(`${minDate}T12:00:00`);
    date.setDate(date.getDate() + index);
    const iso = localIsoDate(date);
    return { iso, day: new Intl.DateTimeFormat("es-DO", { weekday: "short" }).format(date).replace(".", ""), number: date.getDate(), month: new Intl.DateTimeFormat("es-DO", { month: "short" }).format(date).replace(".", "") };
  });
  const availableTimes = availability.slots.filter((slot) => slot.available);
  return (
    <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .2, ease: "easeOut" }}>
      <motion.section className="lead-modal test-drive-modal" role="dialog" aria-modal="true" aria-labelledby="test-drive-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        {status.success ? (
          <div className="lead-success">
            <span className="eyebrow">CITA RECIBIDA</span>
            <h2>Tu cita está en revisión.</h2>
            <p>Un asesor confirmará el horario y te contactará con los detalles de tu visita para el {vehicle.brand} {vehicle.model}.</p>
            <div className="appointment-calendar-actions">
              <a
                className="primary-action"
                href={googleCalendarUrl({
                  title: `Cita / Test Drive: ${vehicle.brand} ${vehicle.model} - ${getBrandName()}`,
                  description: `Cita solicitada para ver el vehículo ${vehicle.brand} ${vehicle.model} (${vehicle.year}). Concesionario: ${getBrandName()}.`,
                  location: getBrandName(),
                  startDate: `${form.date}T${form.time || "10:00"}:00`,
                  durationMinutes: 45,
                })}
                target="_blank"
                rel="noreferrer"
              >
                📅 Añadir a Google Calendar
              </a>
              <button
                className="secondary-action"
                type="button"
                onClick={() => downloadCalendarIcs({
                  title: `Cita / Test Drive: ${vehicle.brand} ${vehicle.model} - ${getBrandName()}`,
                  description: `Cita solicitada para ver el vehículo ${vehicle.brand} ${vehicle.model} (${vehicle.year}). Concesionario: ${getBrandName()}.`,
                  location: getBrandName(),
                  startDate: `${form.date}T${form.time || "10:00"}:00`,
                  durationMinutes: 45,
                })}
              >
                📥 Descargar archivo .ics (Apple / Outlook)
              </button>
            </div>
            <button className="text-button" type="button" onClick={onClose} style={{ marginTop: "1rem" }}>Listo, cerrar ventana</button>
          </div>
        ) : (
          <>
            <span className="eyebrow">AGENDA · {getBrandName()}</span>
            <h2 id="test-drive-title">Agenda tu cita.</h2>
            <p className="modal-vehicle">{vehicle.brand} {vehicle.model} · {vehicle.year}</p>
            <div className="appointment-flow-steps" aria-label="Pasos para agendar">
              <span className={form.date ? "is-done" : "is-active"}><b>01</b>Día</span>
              <span className={form.time ? "is-done" : form.date ? "is-active" : ""}><b>02</b>Hora</span>
              <span className={form.name && form.email && form.phone ? "is-active" : ""}><b>03</b>Tus datos</span>
            </div>
            <form className="lead-form" onSubmit={submit}>
              <section className="appointment-picker-section" aria-labelledby="appointment-day-label">
                <div className="appointment-picker-heading">
                  <span id="appointment-day-label">Elige el día</span>
                  <small>Horarios locales de {getBrandName()}</small>
                </div>
                <div className="appointment-date-strip" role="list" aria-label="Días disponibles">
                  {dateOptions.map((option) => (
                    <button type="button" role="listitem" className={form.date === option.iso ? "is-selected" : ""} key={option.iso} onClick={() => { change("date", option.iso); change("time", ""); }} aria-pressed={form.date === option.iso}>
                      <small>{option.day}</small>
                      <strong>{option.number}</strong>
                      <span>{option.month}</span>
                    </button>
                  ))}
                </div>
                <input className="appointment-date-fallback" type="date" min={minDate} value={form.date} onChange={(event) => { change("date", event.target.value); change("time", ""); }} aria-label="Elegir otra fecha" required />
              </section>
              <section className="appointment-picker-section" aria-labelledby="appointment-time-label">
                <div className="appointment-picker-heading">
                  <span id="appointment-time-label">Elige el horario</span>
                  <small>{availability.message}</small>
                </div>
                {form.date && availableTimes.length ? (
                  <div className="appointment-time-grid" role="list" aria-label="Horarios disponibles">
                    {availableTimes.map((slot) => (
                      <button type="button" role="listitem" className={form.time === slot.time ? "is-selected" : ""} key={slot.time} onClick={() => change("time", slot.time)} aria-pressed={form.time === slot.time}>
                        {String(slot.time).slice(0, 5)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={`appointment-availability-note${availability.slots.length && !availableTimes.length ? " is-full" : ""}`}>{form.date ? availability.message : "Selecciona un día para ver los horarios disponibles."}</p>
                )}
              </section>
              <div className="lead-form-grid">
                <label>Nombre<input value={form.name} onChange={(event) => change("name", event.target.value)} autoComplete="name" required /></label>
                <PhoneField label="Teléfono" value={form.phone} onChange={(value) => change("phone", value)} required hint="Selecciona tu país e introduce tu número." />
              </div>
              <label>Correo<input type="email" value={form.email} onChange={(event) => change("email", event.target.value)} autoComplete="email" required /></label>
              {form.date && form.time && (
                <p className="appointment-selection-summary" role="status">
                  <CalendarBlankIcon size={18} weight="bold" /> Visita solicitada: <strong>{new Intl.DateTimeFormat("es-DO", { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${form.date}T12:00:00`))}</strong> a las <strong>{String(form.time).slice(0, 5)}</strong>
                </p>
              )}
              <TurnstileField onTokenChange={setTurnstileToken} />
              <label className="consent-check">
                <input type="checkbox" checked={form.privacyConsent} onChange={(event) => change("privacyConsent", event.target.checked)} required />
                <span>Acepto la política de privacidad y autorizo el uso de mis datos para coordinar la visita.</span>
              </label>
              {status.error && <p className="state-message error">{status.error}</p>}
              <button className="primary-action" type="submit" disabled={status.loading || availability.loading || !form.time}>
                {status.loading ? "Registrando…" : "Solicitar cita"}
              </button>
            </form>
          </>
        )}
      </motion.section>
    </motion.div>
  );
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
        <div className="account-favorites"><div className="account-activity-head"><span className="eyebrow">MI SELECCIÓN</span><span>{favoriteVehicles.length ? "Guardados para volver" : "Todavía vacío"}</span></div>{favoriteVehicles.length ? <div className="account-favorites-grid">{favoriteVehicles.slice(0, 4).map((vehicle) => { const number = whatsappDigits(whatsapp); const message = encodeURIComponent(`Mira este ${vehicle.brand} ${vehicle.model} en ${businessName}: ${window.location.origin}${vehiclePath(vehicle)}`); return <article className="account-favorite-card" key={vehicle.id}><button type="button" onClick={() => onOpenVehicle?.(vehicle)} aria-label={`Abrir ${vehicle.brand} ${vehicle.model}`}><img src={publicMediaUrl(vehicle.images?.[0]?.url) || "/assets/hero-highway.webp"} alt="" loading="lazy" /><span><strong>{vehicle.brand} {vehicle.model}</strong><small>{formatPrice(vehicle.priceUsd)}</small></span></button><div className="account-favorite-actions"><button type="button" onClick={() => onQuickAction?.(vehicle, "appointment")}>Cita</button><button type="button" onClick={() => onQuickAction?.(vehicle, "quote")}>Cotizar</button><a href={`https://wa.me/${number}?text=${message}`} target="_blank" rel="noreferrer" onClick={() => number && trackEvent("whatsapp_click", { vehicleId: vehicle.id })}>{number ? "WhatsApp" : "Compartir"}</a></div><button className="account-favorite-remove" type="button" onClick={() => onToggleFavorite?.(vehicle)} aria-label={`Quitar ${vehicle.brand} ${vehicle.model} de favoritos`}>×</button></article>; })}</div> : <p className="account-activity-empty">Guarda un vehículo desde el catálogo para encontrarlo aquí cuando regreses.</p>}</div>
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
          {mode === "register" && <PhoneField label="Teléfono (opcional)" value={form.phone} onChange={(value) => onChange("phone", value)} hint="Podrás recibir novedades y coordinar tu compra más rápido." />}
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
      const response = await fetch(`${apiUrl}/api/leads`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": publicRequestKey("contact") }, body: JSON.stringify({ ...form, phone: normalizePhone(form.phone), turnstileToken }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar el mensaje");
      setStatus({ loading: false, error: "", success: true }); trackEvent("contact_submitted"); setForm({ name: "", email: "", phone: "", message: "", privacyConsent: false });
    } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  return <section className="contact-section" id="contact"><div><span className="eyebrow">CONTACTO DIRECTO</span><h2>Hablemos de tu próximo vehículo.</h2><p>Déjanos tus datos y un asesor de {getBrandName()} se pondrá en contacto contigo.</p><p className="response-time-note"><strong>¿Qué pasa después?</strong> Revisaremos tu mensaje durante el horario de atención y te responderemos con el siguiente paso.</p></div><form className="contact-form" onSubmit={submit}><label>Nombre<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><div className="lead-form-grid"><label>Correo<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><PhoneField label="Teléfono" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} hint="Selecciona tu país e introduce tu número." /></div><label>Mensaje<textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} required /></label><TurnstileField onTokenChange={setTurnstileToken} /><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => setForm({ ...form, privacyConsent: event.target.checked })} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para responder este mensaje.</span></label>{status.success && <p className="form-message success-message">Mensaje recibido. Te contactaremos pronto. No necesitas enviarlo otra vez.</p>}{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando…" : "Enviar mensaje"}</button></form></section>;
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
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const syncPath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", syncPath);
    window.addEventListener("zevroa:navigation", syncPath);
    return () => {
      window.removeEventListener("popstate", syncPath);
      window.removeEventListener("zevroa:navigation", syncPath);
    };
  }, []);
  const isPublicExperience = path === "/" || path.startsWith("/vehiculos/") || path.startsWith("/blog/");
  if (!visible || !isPublicExperience) return null;
  const accept = () => { localStorage.setItem("authentiq_cookie_consent", "accepted"); setVisible(false); };
  const reject = () => { localStorage.setItem("authentiq_cookie_consent", "rejected"); setVisible(false); };
  return <aside className="cookie-consent" role="dialog" aria-label="Preferencias de cookies"><div><strong>Tu privacidad importa.</strong><p>Usamos cookies esenciales para que el showroom funcione. La analítica solo se activa si la aceptas.</p></div><div className="cookie-consent-actions"><button type="button" className="secondary-action" onClick={reject}>Solo esenciales</button><button type="button" className="primary-action" onClick={accept}>Aceptar analítica</button></div></aside>;
}

function BlogSection({ posts }) {
  if (!posts.length) return null;
  return <section className="blog-public" id="journal"><div className="section-head"><div><span className="eyebrow">JOURNAL · {getBrandName()}</span><h2>Ideas para conducir mejor.</h2></div><p>Guías, historias y cultura automotriz.</p></div><div className="blog-public-grid">{posts.map((post) => <article className="blog-public-card" key={post.id}>{post.coverImageUrl && <img src={post.coverImageUrl} alt={`Portada: ${post.title}`} />}{!post.coverImageUrl && <div className="blog-public-placeholder" />}<div><span className="eyebrow">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : getBrandName()}</span><h3>{post.title}</h3>{post.category && <span className="blog-category">{post.category}</span>}{post.tags?.length > 0 && <small className="blog-tags">{post.tags.join(" · ")}</small>}<p>{post.summary}</p><a href={`/blog/${post.slug}`}>Leer artículo →</a></div></article>)}</div></section>;
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
    // no se duplica el sufijo cuando ya termina en "ZEVROA".
    const title = /zevroa\s*$/i.test(baseTitle.trim()) ? baseTitle.trim() : `${baseTitle} · ZEVROA`;
    const description = post.seoDescription || post.summary || `${post.title} · Journal de ZEVROA`;
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
      publisher: { "@type": "Organization", name: "ZEVROA" },
    }).replace(/</g, "\\u003c");
    document.head.appendChild(structured);
    return () => structured.remove();
  }, [post, status]);
  if (status === "loading") return <main className="article-page"><button className="back-button" type="button" onClick={onBack}>← Volver al catálogo</button><p className="state-message">Cargando artículo…</p></main>;
  if (status === "error" || !post) return <main className="article-page"><button className="back-button" type="button" onClick={onBack}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">ZEVROA · JOURNAL</span><h1>Este artículo ya no está disponible.</h1><p>Puede haber sido archivado o la dirección puede haber cambiado.</p></section></main>;
  return <main className="article-page"><button className="back-button" type="button" onClick={onBack}>← Volver al catálogo</button><article className="article-body"><header><span className="eyebrow">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("es-DO", { day: "2-digit", month: "long", year: "numeric" }) : "ZEVROA · JOURNAL"}</span><h1>{post.title}</h1>{post.summary && <p className="article-summary">{post.summary}</p>}</header>{post.coverImageUrl && <img className="article-cover" src={publicMediaUrl(post.coverImageUrl)} alt={post.title} /> }<div className="article-content">{post.content.split(/\r?\n/).map((paragraph, index) => paragraph.trim() ? <p key={`${post.id}-${index}`}>{paragraph}</p> : <br key={`${post.id}-space-${index}`} />)}</div></article></main>;
}

function DetailTrustStrip({ vehicle, onTradeIn }) {
  const freshness = vehicle.updatedAt || vehicle.createdAt;
  const freshnessLabel = freshness
    ? `Actualizado ${new Date(freshness).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}`
    : "Información disponible para revisar";
  const detailCount = [vehicle.engine, vehicle.power, vehicle.transmission, vehicle.fuelType, vehicle.mileageKm, vehicle.location, vehicle.warranty].filter(Boolean).length;
  const detailLabel = detailCount >= 5 ? "Ficha completa" : detailCount >= 3 ? "Ficha esencial" : "Información visible";
  return <section className="detail-trust-strip" aria-label="Información para decidir con confianza"><div><span className="detail-trust-mark">01</span><strong>{vehicle.status === "reserved" ? "Reserva en curso" : "Disponibilidad visible"}</strong><p>{vehicle.location ? `Ubicado en ${vehicle.location}. Confirma la visita con el equipo.` : "El equipo confirma disponibilidad antes de tu visita."}</p><small className="detail-trust-meta">{freshnessLabel}</small></div><div><span className="detail-trust-mark">02</span><strong>{detailLabel}</strong><p>{vehicle.warranty ? `${vehicle.warranty}. Cobertura informada por el concesionario.` : "Precio, especificaciones y condiciones a la vista para comparar mejor."}</p><small className="detail-trust-meta">{detailCount} datos clave conectados</small></div><div><span className="detail-trust-mark">03</span><strong>Renueva con contexto</strong><p>¿Tienes vehículo actual? Cuéntanos y prepara una conversación más completa.</p><button type="button" className="detail-trust-action" onClick={onTradeIn}>Solicitar orientación →</button></div></section>;
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

function DetailImageCarousel({ images, vehicle, activeImage, onSelect, onOpen }) {
  const [viewportRef, emblaApi] = useEmblaCarousel({ align: "start", containScroll: "trimSnaps", skipSnaps: false });
  const handleSelect = useCallback((api) => onSelect(api?.selectedScrollSnap?.() || 0), [onSelect]);

  useEffect(() => {
    if (!emblaApi) return undefined;
    handleSelect(emblaApi);
    emblaApi.on("select", handleSelect);
    return () => emblaApi.off("select", handleSelect);
  }, [emblaApi, handleSelect]);

  useEffect(() => {
    if (emblaApi && emblaApi.selectedScrollSnap() !== activeImage) emblaApi.scrollTo(activeImage);
  }, [activeImage, emblaApi]);

  return (
    <div className="detail-image-carousel">
      <div className="detail-image-wrap embla-viewport" ref={viewportRef} role="region" aria-roledescription="carrusel" aria-label={`Galería de ${vehicle.brand} ${vehicle.model}`}>
        <div className="embla-container">
          {images.map((item, index) => (
            <button className="embla-slide" type="button" key={item.id || item.url || index} onClick={onOpen} aria-label={`Ampliar imagen ${index + 1} de ${vehicle.brand} ${vehicle.model}`}>
              <img src={publicMediaUrl(item.url)} alt={item.altText || `Vista ${index + 1} de ${vehicle.brand} ${vehicle.model}`} className="detail-image" loading={index === 0 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : undefined} decoding="async" />
            </button>
          ))}
        </div>
      </div>
      {images.length > 1 && <div className="detail-carousel-controls" aria-label="Controles de galería">
        <button type="button" onClick={() => emblaApi?.scrollPrev()} aria-label="Imagen anterior">←</button>
        <span aria-live="polite">{String(activeImage + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}</span>
        <button type="button" onClick={() => emblaApi?.scrollNext()} aria-label="Imagen siguiente">→</button>
      </div>}
    </div>
  );
}

function VehicleDetail({ vehicle, vehicles = [], onBack, isFavorite = false, onToggleFavorite = () => {}, customerToken = "", compareVehicles = [], favoriteIds = [], onOpenVehicle = () => {}, onToggleCompare = () => {}, whatsapp = "" }) {
  const whatsappNumber = whatsappDigits(whatsapp);
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
      <div className="detail-topbar"><button className="back-button" type="button" onClick={onBack}>Volver al catálogo</button><span className="detail-topbar-context">{vehicle.brand} · {vehicle.model}</span><a href="#similar-vehicles" className="detail-topbar-link">Ver similares ↓</a></div>
      <Breadcrumbs vehicle={vehicle} />
      <section className="detail-grid">
        <div>
          <DetailImageCarousel images={images} vehicle={vehicle} activeImage={activeImage} onSelect={setActiveImage} onOpen={() => setLightboxOpen(true)} />
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
                 <img src={publicMediaUrl(item.url)} alt={`Vista ${index + 1} de ${vehicle.brand} ${vehicle.model}`} loading="lazy" decoding="async" />
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
    eyebrow: "ZEVROA · CONTACTO",
    title: <>Hablemos de tu <em>próximo vehículo.</em></>,
    intro: "Nuestro equipo está disponible para orientarte sobre inventario y ofertas.",
    sections: [
      ["Atención comercial", "Usa el formulario de contacto del catálogo para dejar tus datos y te responderemos personalmente."],
      ["Ubicación", "La dirección y el horario de atención se configurarán antes de la publicación final."],
    ],
  },
  location: {
    eyebrow: "ZEVROA · UBICACIÓN",
    title: <>Encuéntranos <em>en persona.</em></>,
    intro: "La experiencia ZEVROA está pensada para conocer cada vehículo con calma y confianza.",
    sections: [["Showroom", "La dirección del showroom, el mapa y el horario serán agregados cuando el negocio confirme esos datos."]],
  },
  privacy: {
    eyebrow: "ZEVROA · PRIVACIDAD",
    title: <>Tus datos, tratados con <em>respeto.</em></>,
    intro: "Esta página resume el compromiso de ZEVROA con la protección de la información de sus clientes.",
    sections: [["Aviso importante", "El texto legal definitivo, la entidad responsable y los canales de privacidad están pendientes de aprobación antes del lanzamiento público."], ["Mientras tanto", "Solo solicitamos los datos necesarios para responder consultas y ofertas."]],
  },
  terms: {
    eyebrow: "ZEVROA · TÉRMINOS",
    title: <>Una experiencia clara, de principio a <em>fin.</em></>,
    intro: "La información del catálogo está sujeta a confirmación comercial y disponibilidad.",
    sections: [["Aviso importante", "Los términos y condiciones definitivos, incluyendo jurisdicción, reservas y políticas de compra, están pendientes de aprobación antes del lanzamiento público."], ["Disponibilidad", "Enviar una oferta no constituye una compra ni una reserva confirmada."]],
  },
};

const institutionalRoutes = { "/contacto": "contact", "/ubicacion": "location", "/privacidad": "privacy", "/terminos": "terms" };

function InstitutionalPage({ type, settings = {}, onBack }) {
  const content = institutionalContent[type] || institutionalContent.contact;
  const brand = settings.businessName || getBrandName();
  const configuredSections = type === "location" ? [["Showroom", settings.address || "La dirección del showroom será publicada cuando el negocio confirme esos datos."], ["Horario", settings.hours || "Horario pendiente de confirmación."]] : type === "privacy" ? [["Política vigente", settings.privacyText || content.sections[0][1]]] : type === "terms" ? [["Términos vigentes", settings.termsText || content.sections[0][1]]] : content.sections;
  return <motion.main className="institutional-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24, ease: "easeOut" }}>
     <button className="back-button" type="button" onClick={onBack}>← Volver al catálogo</button>
    <section className="institutional-hero"><span className="eyebrow">{content.eyebrow.replace(/ZEVROA/g, brand)}</span><h1>{content.title}</h1><p>{content.intro.replace(/ZEVROA/g, brand)}</p></section>
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

function BudgetSearchPanel({ vehicles, activeBudget, activeDownPayment = 20, activeMonths = 60, onApply, onClear }) {
  const [budget, setBudget] = useState(activeBudget || "");
  const [downPayment, setDownPayment] = useState(activeDownPayment);
  const [months, setMonths] = useState(activeMonths);
  useEffect(() => {
    setBudget(activeBudget || "");
    setDownPayment(activeDownPayment);
    setMonths(activeMonths);
  }, [activeBudget, activeDownPayment, activeMonths]);
  if (!vehicles.length) return null;
  const numericBudget = Math.max(Number(budget) || 0, 0);
  const rate = 0.12 / 12;
  const paymentFor = (vehicle) => {
    const principal = Math.max(Number(vehicle.priceUsd || 0) * (1 - downPayment / 100), 0);
    return principal && rate ? principal * (rate * (1 + rate) ** months) / ((1 + rate) ** months - 1) : 0;
  };
  const matches = numericBudget ? vehicles.filter((vehicle) => paymentFor(vehicle) <= numericBudget) : [];
  const apply = () => {
    if (!numericBudget) return;
    onApply?.({ amount: numericBudget, downPayment, months });
  };
  return <section className={`budget-search-panel${activeBudget ? " is-active" : ""}`} aria-label="Buscar vehículos por presupuesto mensual"><div className="budget-search-copy"><span className="eyebrow">BUSCAR POR PRESUPUESTO</span><h2>Empieza por la cuota que te conviene.</h2><p>Te mostramos vehículos que caben en tu presupuesto estimado. No es una aprobación financiera.</p>{activeBudget && <button type="button" className="text-button budget-clear" onClick={onClear}>Quitar presupuesto</button>}</div><div className="budget-search-controls"><label>Cuota máxima mensual<strong><span>$</span><input type="number" min="0" step="25" value={budget} onChange={(event) => setBudget(event.target.value)} aria-label="Cuota máxima mensual" /><span>USD</span></strong></label><label>Inicial <output>{downPayment}%</output><input type="range" min="0" max="70" step="5" value={downPayment} aria-label="Porcentaje de inicial" onChange={(event) => setDownPayment(Number(event.target.value))} /></label><label>Plazo <output>{months} meses</output><select value={months} aria-label="Plazo de financiamiento" onChange={(event) => setMonths(Number(event.target.value))}><option value="36">36 meses</option><option value="48">48 meses</option><option value="60">60 meses</option><option value="72">72 meses</option><option value="84">84 meses</option></select></label><div className="budget-search-result" aria-live="polite"><strong>{numericBudget ? matches.length : "—"}</strong><span>{numericBudget ? `vehículo${matches.length === 1 ? "" : "s"} encaja${matches.length === 1 ? "" : "n"}` : "define una cuota"}</span></div><button type="button" className="primary-action" onClick={apply} disabled={!numericBudget}>{activeBudget ? "Actualizar resultados →" : "Ver vehículos que encajan →"}</button></div><small className="budget-search-note">Estimación con 12% anual · inicial {downPayment}% · sin seguros ni gastos adicionales.</small></section>;
}

function SmartVehicleSearch({ vehicles, value, onChange, resultCount, onClear }) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const query = normalizeSearchText(value);
  const suggestions = useMemo(() => {
    if (!query) return [];
    const options = [];
    const seen = new Set();
    const addOption = (option) => {
      const key = `${option.type}:${normalizeSearchText(option.query)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const normalizedTitle = normalizeSearchText(option.title);
      const starts = normalizedTitle.startsWith(query) ? 0 : normalizedTitle.includes(query) ? 1 : 2;
      options.push({ ...option, score: starts });
    };
    vehicles.forEach((vehicle) => {
      if (!vehicleMatchesSearch(vehicle, query)) return;
      addOption({
        type: "vehicle",
        query: `${vehicle.brand} ${vehicle.model}`,
        title: `${vehicle.brand} ${vehicle.model}`,
        detail: [vehicle.year, vehicle.variant, vehicle.priceUsd ? formatPrice(vehicle.priceUsd) : ""].filter(Boolean).join(" · "),
      });
    });
    const valuesByType = [
      ["brand", "Marca", vehicles.map((vehicle) => vehicle.brand)],
      ["category", "Tipo", vehicles.map((vehicle) => vehicle.category)],
      ["fuelType", "Combustible", vehicles.map((vehicle) => vehicle.fuelType)],
      ["transmission", "Transmisión", vehicles.map((vehicle) => vehicle.transmission)],
      ["location", "Ubicación", vehicles.map((vehicle) => vehicle.location)],
    ];
    valuesByType.forEach(([type, label, values]) => [...new Set(values.filter(Boolean))].forEach((item) => {
      const normalizedItem = normalizeSearchText(item);
      if (!normalizedItem.includes(query) && !(query.length >= 4 && editDistance(query, normalizedItem) <= Math.min(2, Math.floor(query.length / 3)))) return;
      addOption({ type, query: item, title: item, detail: label });
    }));
    return options.sort((left, right) => left.score - right.score || left.title.localeCompare(right.title)).slice(0, 7);
  }, [query, vehicles]);

  useEffect(() => {
    const closeOnOutsideClick = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);
  useEffect(() => { setHighlightedIndex(0); }, [query]);

  const chooseSuggestion = (suggestion) => {
    onChange(suggestion.query);
    setOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };
  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setHighlightedIndex((current) => suggestions.length ? (current + 1) % suggestions.length : 0); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); setHighlightedIndex((current) => suggestions.length ? (current - 1 + suggestions.length) % suggestions.length : 0); }
    else if (event.key === "Enter" && open && suggestions[highlightedIndex]) { event.preventDefault(); chooseSuggestion(suggestions[highlightedIndex]); }
    else if (event.key === "Escape") { setOpen(false); }
  };
  const listId = "vehicle-search-suggestions";
  const activeId = open && suggestions[highlightedIndex] ? `${listId}-${highlightedIndex}` : undefined;
  return <div className="smart-search" ref={rootRef}>
    <div className="smart-search-label"><span className="eyebrow">BUSCAR EN INVENTARIO</span><span>{query ? `${resultCount} resultado${resultCount === 1 ? "" : "s"}` : "Marca, modelo, versión o especificación"}</span></div>
    <div className="smart-search-control">
      <MagnifyingGlassIcon className="smart-search-icon" size={20} aria-hidden="true" />
      <input ref={inputRef} className="catalog-search" value={value} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onFocus={() => query && setOpen(true)} onKeyDown={handleKeyDown} placeholder="Ej. Porsche, SUV, eléctrico o 2024" aria-label="Buscar vehículos por marca, modelo o especificación" role="combobox" aria-expanded={open && query.length > 0} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeId} />
      {value && <button className="smart-search-clear" type="button" onClick={() => { onClear(); setOpen(false); inputRef.current?.focus(); }} aria-label="Limpiar búsqueda">×</button>}
    </div>
    {open && query && <div className="smart-search-popover" id={listId} role="listbox" aria-label="Sugerencias de búsqueda">
      {suggestions.length ? suggestions.map((suggestion, index) => <button key={`${suggestion.type}-${suggestion.query}`} id={`${listId}-${index}`} className={`smart-search-option ${index === highlightedIndex ? "is-highlighted" : ""}`} type="button" role="option" aria-selected={index === highlightedIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)}><span><strong>{suggestion.title}</strong><small>{suggestion.detail}</small></span><span className="smart-search-option-arrow">↗</span></button>) : <div className="smart-search-empty" role="status">No encontramos coincidencias cercanas. Prueba con marca, modelo o año.</div>}
    </div>}
  </div>;
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

function ShowroomNav({ theme, setTheme, customer, onAccount, onBackoffice, onRegisterDealer, businessName = "ZEVROA", logoUrl = "" }) {
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

function PresentationMode({ vehicles, loading, onExit, onOpenVehicle, businessName = "ZEVROA", logoUrl = "" }) {
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
  useEffect(() => {
    if (!state.success) return undefined;
    const timer = window.setTimeout(() => window.location.assign(isCustomer ? "/" : "/backoffice"), 1400);
    return () => window.clearTimeout(timer);
  }, [state.success, isCustomer]);
  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) return setState({ loading: false, error: "La contraseña debe tener al menos 8 caracteres", success: false });
    if (password !== confirm) return setState({ loading: false, error: "Las contraseñas no coinciden", success: false });
    setState({ loading: true, error: "", success: false });
    try {
      const response = await fetch(`${apiUrl}${isCustomer ? "/api/customer/auth/password-reset/confirm" : "/api/auth/password-reset/confirm"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, newPassword: password }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo restablecer la contraseña");
      setState({ loading: false, error: "", success: true });
    } catch (error) { setState({ loading: false, error: error.message, success: false }); }
  };
  const returnPath = isCustomer ? "/" : "/backoffice";
  if (!token) return <main className="admin-page admin-login-page"><section className="admin-login"><span className="eyebrow">ZEVROA · SEGURIDAD</span><h1>Este enlace ya no está disponible.</h1><p className="state-message error" role="alert">Solicita un nuevo correo de recuperación para continuar.</p><button className="primary-action" type="button" onClick={() => window.location.assign(returnPath)}>{isCustomer ? "Volver al showroom" : "Ir al inicio de sesión"}</button></section></main>;
  return <main className="admin-page admin-login-page"><form className="admin-login" onSubmit={submit}><span className="eyebrow">ZEVROA · SEGURIDAD</span><h1>Crea tu <em>nueva contraseña.</em></h1>{state.success ? <><p className="state-message success">Contraseña actualizada. Ya puedes volver a iniciar sesión.</p><button className="primary-action" type="button" onClick={() => window.location.assign(returnPath)}>{isCustomer ? "Volver al showroom" : "Ir al inicio de sesión"}</button></> : <><p className="account-welcome">El enlace vence en 30 minutos y solo funciona una vez.</p><label>Nueva contraseña<input type="password" autoComplete="new-password" minLength="8" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Repite la contraseña<input type="password" autoComplete="new-password" minLength="8" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>{state.error && <p className="state-message error" role="alert">{state.error}</p>}<button className="primary-action" type="submit" disabled={state.loading}>{state.loading ? "Guardando…" : "Guardar contraseña"}</button></>}</form></main>;
}

function App() {
  const prefersReducedMotion = useReducedMotion();
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [compareVehicles, setCompareVehicles] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(() => { try { return JSON.parse(localStorage.getItem("authentiq_favorite_vehicles") || "[]"); } catch { return []; } });
  const [recentVehicleIds, setRecentVehicleIds] = useState(() => { try { return JSON.parse(localStorage.getItem("authentiq_recent_vehicles") || "[]"); } catch { return []; } });
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [customerToken, setCustomerToken] = useState("");
  const [customer, setCustomer] = useState(null);
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
  const [maxMonthlyPayment, setMaxMonthlyPayment] = useState("");
  const [budgetDownPayment, setBudgetDownPayment] = useState(20);
  const [budgetMonths, setBudgetMonths] = useState(60);
  const [minYear, setMinYear] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tenantNotFound, setTenantNotFound] = useState(false);
  const [screen, setScreen] = useState(() => impersonatePayload || window.location.pathname === "/backoffice" ? "admin" : (institutionalRoutes[window.location.pathname] || "catalog"));
  const [showDemoCatalog, setShowDemoCatalog] = useState(false);
  const [adminInitialMode, setAdminInitialMode] = useState("login");
  const [posts, setPosts] = useState([]);
  const [businessSettings, setBusinessSettings] = useState({ businessName: "ZEVROA", logoUrl: "", primaryColor: "#c8a24b", accentColor: "#b28b37", faviconUrl: "", phone: "", whatsapp: "", email: "", address: "", hours: "", instagramUrl: "", facebookUrl: "", privacyText: "", termsText: "", heroHeadline: "", heroSubheadline: "", heroImageUrl: "" });
  // Evita el destello de contenido incorrecto en "/": hasta que /api/settings confirme si
  // este host es la landing de la plataforma o el showroom de un dealer, no hay forma de
  // saber qué renderizar. Sin esta bandera se veía brevemente el catálogo por defecto.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("authentiq_theme") || "light");
  publicBrandName = businessSettings.businessName || "ZEVROA";
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
    root.style.setProperty("--tenant-on-primary", readableInkOn(primaryColor));
    root.style.setProperty("--tenant-primary-hover", lighten(primaryColor));
    // El hero y la barra sin scroll son oscuros: ahí el tono de marca se aclara
    // en vez de oscurecerse, o una marca granate o añil queda ilegible.
    root.style.setProperty("--tenant-primary-on-dark", contrastSafeTint(primaryColor, "#111315"));
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
    const brand = businessSettings.businessName || "ZEVROA";
    document.title = document.title.replace(/AUTHENTIQ/g, brand).replace(/ZEVROA/g, brand);
  }, [businessSettings.businessName]);

  const customerRequest = async (path, options = {}) => {
    const response = await fetch(`${apiUrl}${path}`, { ...options, credentials: "include", headers: { "Content-Type": "application/json", ...(customerToken ? { Authorization: `Bearer ${customerToken}` } : {}), ...(options.headers || {}) } });
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
  useEffect(() => { localStorage.setItem("authentiq_favorite_vehicles", JSON.stringify(favoriteIds)); }, [favoriteIds]);
  useEffect(() => { localStorage.setItem("authentiq_recent_vehicles", JSON.stringify(recentVehicleIds)); }, [recentVehicleIds]);
  useEffect(() => { localStorage.setItem("authentiq_catalog_view", catalogView); }, [catalogView]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Primero comprobamos la sesión. La cookie HttpOnly puede existir aunque
        // no tengamos token en memoria; si el visitante es anónimo evitamos dos
        // consultas privadas adicionales que siempre acabarían en 401.
        const profile = await customerRequest("/api/customer/me");
        if (cancelled) return;
        const [favorites, activity] = await Promise.all([customerRequest("/api/customer/favorites"), customerRequest("/api/customer/activity")]);
        if (cancelled) return;
        setCustomer(profile.data);
        setCustomerActivity(activity.data || { offers: [], quotes: [], notifications: [] });
        const serverIds = favorites.data || [];
        const localIds = JSON.parse(localStorage.getItem("authentiq_favorite_vehicles") || "[]");
        const mergedIds = [...new Set([...serverIds, ...localIds])];
        setFavoriteIds(mergedIds);
        await Promise.all(localIds.filter((id) => !serverIds.includes(id)).map((id) => customerRequest(`/api/customer/favorites/${id}`, { method: "PUT" }).catch(() => null)));
      } catch {
        if (!cancelled) { setCustomerToken(""); setCustomer(null); setCustomerActivity({ offers: [], quotes: [], notifications: [] }); }
      }
    })();
    return () => { cancelled = true; };
  }, [customerToken]);

  useEffect(() => {
    const handlePopState = () => {
      const nextPath = window.location.pathname;
      setPathname(nextPath);
      setScreen(nextPath === "/backoffice" ? "admin" : (institutionalRoutes[nextPath] || "catalog"));
      setSelected(null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path) => {
    const demoSearch = requestedDealerSlug ? `?dealer=${encodeURIComponent(requestedDealerSlug)}` : "";
    const applyRoute = () => {
      window.history.pushState({}, "", `${path}${demoSearch}`);
      setPathname(path);
      window.dispatchEvent(new Event("zevroa:navigation"));
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
    const brandName = businessSettings.businessName || "ZEVROA";
    const replaceDefaultBrand = (value) => String(value || "").replace(/AUTHENTIQ/gi, brandName);
    const privateRoute = pathname === "/backoffice" || pathname.endsWith("/restablecer-contrasena");
    const title = privateRoute
      ? `${brandName} · Panel de control`
      : activeVehicle
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
    setRobots(!privateRoute && pathname !== "/preview" && (!activeVehicle || ["published", "reserved"].includes(activeVehicle.status)));
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
      const price = Number(vehicle.priceUsd);
      const year = Number(vehicle.year);
      const monthlyBudget = Number(maxMonthlyPayment);
      const principal = Math.max(price * (1 - budgetDownPayment / 100), 0);
      const monthlyRate = 0.12 / 12;
      const estimatedPayment = principal && monthlyRate ? principal * (monthlyRate * (1 + monthlyRate) ** budgetMonths) / ((1 + monthlyRate) ** budgetMonths - 1) : 0;
      return (!favoritesOnly || favoriteIds.includes(vehicle.id)) &&
        (brand === "all" || vehicle.brand === brand) &&
        (category === "all" || vehicle.category === category) &&
        (condition === "all" || vehicle.condition === condition) &&
        (fuelType === "all" || vehicle.fuelType === fuelType) &&
        (transmission === "all" || vehicle.transmission === transmission) &&
        (!minPrice || price >= Number(minPrice)) &&
        (!maxPrice || price <= Number(maxPrice)) &&
        (!monthlyBudget || estimatedPayment <= monthlyBudget) &&
        (!minYear || year >= Number(minYear)) &&
        vehicleMatchesSearch(vehicle, search);
    })
    .sort((left, right) => {
      if (sort === "price-low") return Number(left.priceUsd) - Number(right.priceUsd);
      if (sort === "price-high") return Number(right.priceUsd) - Number(left.priceUsd);
      if (sort === "mileage") return Number(left.mileageKm) - Number(right.mileageKm);
      if (sort === "year") return Number(right.year) - Number(left.year);
      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    }), [vehicles, favoriteIds, favoritesOnly, brand, category, condition, fuelType, transmission, minPrice, maxPrice, maxMonthlyPayment, budgetDownPayment, budgetMonths, minYear, search, sort]);

  const clearFilters = () => {
    setSearch(""); setBrand("all"); setCategory("all"); setCondition("all"); setFuelType("all"); setTransmission("all");
    setMinPrice(""); setMaxPrice(""); setMaxMonthlyPayment(""); setBudgetDownPayment(20); setBudgetMonths(60); setMinYear(""); setSort("newest"); setFavoritesOnly(false);
  };
  const applyBudget = ({ amount, downPayment, months }) => {
    setSearch(""); setBrand("all"); setCategory("all"); setCondition("all"); setFuelType("all"); setTransmission("all");
    setMinPrice(""); setMaxPrice(""); setMinYear(""); setSort("newest"); setFavoritesOnly(false); setMaxMonthlyPayment(String(amount)); setBudgetDownPayment(Number(downPayment) || 20); setBudgetMonths(Number(months) || 60);
    window.requestAnimationFrame(() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
      const body = { name: accountForm.name, email: accountForm.email, phone: normalizePhone(accountForm.phone), password: accountForm.password };
      if (accountMode === "register") body.turnstileToken = accountTurnstileToken;
      const response = await fetch(`${apiUrl}${endpoint}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo completar la cuenta");
      setCustomerToken(payload.token);
      setCustomer(payload.user);
      setAccountForm({ name: "", email: "", phone: "", password: "" });
      setAccountStatus({ loading: false, error: "" });
    } catch (requestError) { setAccountStatus({ loading: false, error: requestError.message }); }
  };
  const logoutCustomer = async () => { await fetch(`${apiUrl}/api/customer/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {}); setCustomerToken(""); setCustomer(null); setCustomerActivity({ offers: [], quotes: [], notifications: [] }); setAccountStatus({ loading: false, error: "" }); };
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
  if (screen === "admin" || pathname === "/backoffice") return <Suspense fallback={<main className="admin-page"><p className="state-message">Cargando panel de control…</p></main>}><Backoffice initialMode={adminInitialMode} impersonation={impersonatePayload} onBack={() => { setScreen("catalog"); setAdminInitialMode("login"); navigate("/"); refreshVehicles(); }} onVehiclesChanged={syncCatalogVehicle} /></Suspense>;
  if (tenantNotFound) return <TenantNotFoundPage />;
  if (pathname === "/presentacion") return <PresentationMode vehicles={vehicles} loading={loading} businessName={businessSettings.businessName} logoUrl={businessSettings.logoUrl} onExit={() => { if (requestedDealerSlug) navigate(`/?dealer=${encodeURIComponent(requestedDealerSlug)}`); else { setShowDemoCatalog(true); navigate("/"); } }} onOpenVehicle={(vehicle) => navigate(vehiclePath(vehicle))} />;
  if (pathname.startsWith("/cotizaciones/") && pathname.slice("/cotizaciones/".length)) return <PublicQuotePage token={pathname.slice("/cotizaciones/".length)} />;
  if (pathname === "/preview") return previewVehicle ? <VehicleDetail vehicle={{ ...previewVehicle, status: "draft" }} onBack={() => navigate("/")} /> : <main className="article-page"><button className="back-button" type="button" onClick={() => navigate("/")}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">ZEVROA · VISTA PREVIA</span><h1>No hay una ficha para previsualizar.</h1><p>Regresa al panel, completa el formulario y vuelve a abrir la vista previa.</p></section></main>;
  if (pathname.startsWith("/blog/")) return <BlogArticle slug={pathname.slice("/blog/".length)} onBack={() => navigate("/")} />;
  if (pathname.startsWith("/vehiculos/") && loading) return <main className="article-page"><p className="state-message">Cargando vehículo…</p></main>;
  if (pathname.startsWith("/vehiculos/") && !routeVehicle) return <main className="article-page"><button className="back-button" type="button" onClick={() => navigate("/")}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">ZEVROA · INVENTARIO</span><h1>Este vehículo no está disponible.</h1><p>Puede haber sido vendido, archivado o la dirección puede haber cambiado.</p></section></main>;
  const knownPath = pathname === "/" || pathname === "/backoffice" || pathname === "/presentacion" || pathname === "/preview" || pathname === "/backoffice/restablecer-contrasena" || pathname === "/cuenta/restablecer-contrasena" || Boolean(institutionalRoutes[pathname]) || pathname.startsWith("/cotizaciones/") || pathname.startsWith("/blog/") || pathname.startsWith("/vehiculos/");
  if (!knownPath) return <NotFoundPage onBack={() => navigate("/")} />;
  if (institutionalRoutes[pathname]) return <InstitutionalPage type={institutionalRoutes[pathname]} settings={businessSettings} onBack={() => navigate("/")} />;
  if (["contact", "location", "privacy", "terms"].includes(screen)) return <InstitutionalPage type={screen} settings={businessSettings} onBack={() => navigate("/")} />;
  if (activeVehicle) return <VehicleDetail vehicle={activeVehicle} vehicles={vehicles} onBack={() => navigate("/")} isFavorite={favoriteIds.includes(activeVehicle.id)} onToggleFavorite={toggleFavorite} customerToken={customerToken} compareVehicles={compareVehicles} favoriteIds={favoriteIds} onOpenVehicle={(vehicle) => navigate(vehiclePath(vehicle))} onToggleCompare={toggleCompare} whatsapp={businessSettings.whatsapp} />;
  if (pathname === "/" && !settingsLoaded && !showDemoCatalog && !requestedDealerSlug) return <main className="app-boot-shell" aria-hidden="true" />;
  if (pathname === "/" && (businessSettings.isPlatformHome || previewPlatformLanding) && !showDemoCatalog && !requestedDealerSlug) return <LandingPage testimonials={businessSettings.testimonials} whatsapp={businessSettings.whatsapp} onCreateShowroom={() => { setAdminInitialMode("register"); setScreen("admin"); navigate("/backoffice"); }} onDealerLogin={() => { setAdminInitialMode("login"); setScreen("admin"); navigate("/backoffice"); }} onViewDemo={() => setShowDemoCatalog(true)} onOpenPrivacy={() => navigate("/privacidad")} onOpenTerms={() => navigate("/terminos")} />;

  const heroVideoUrl = String(import.meta.env.VITE_HERO_VIDEO_URL || "").trim();
  // El showroom de un concesionario no debe presumir de lo que no tiene ni pedir
  // prestada la foto de la plataforma. Todo lo que sigue sale de su propio inventario.
  const heroFallbackVehicleImage = vehicles.find((vehicle) => vehicle.images?.[0]?.url)?.images?.[0]?.url || "";
  const heroImage = publicMediaUrl(businessSettings.heroImageUrl) || publicMediaUrl(heroFallbackVehicleImage) || "";
  const showroomCity = String(businessSettings.address || "").split(",").map((part) => part.trim()).filter(Boolean).pop() || "";
  const heroBrandCount = new Set(vehicles.map((vehicle) => vehicle.brand).filter(Boolean)).size;
  const hasInventory = vehicles.length > 0;
  return (
    <><a className="skip-link" href="#top">Saltar al contenido</a><main id="top">
      <ShowroomNav theme={theme} setTheme={setTheme} customer={customer} businessName={businessSettings.businessName} logoUrl={businessSettings.logoUrl} onAccount={() => { setAccountOpen(true); setAccountStatus({ loading: false, error: "" }); }} onBackoffice={() => { setAdminInitialMode("login"); setScreen("admin"); navigate("/backoffice"); }} onRegisterDealer={() => { setAdminInitialMode("register"); setScreen("admin"); navigate("/backoffice"); }} />
      <section className="hero">
        {heroVideoUrl
          ? <video className="hero-background hero-video" autoPlay={!prefersReducedMotion} muted loop playsInline preload="metadata" poster={heroImage || undefined} aria-label={`Vehículo de ${getBrandName()}`}><source src={heroVideoUrl} /></video>
          : heroImage
            ? <img src={heroImage} alt={`Vehículo destacado de ${getBrandName()}`} className="hero-background" loading="eager" fetchPriority="high" decoding="async" />
            : <div className="hero-background hero-background-blank" aria-hidden="true" />}
        <div className="hero-overlay" />
        <div className="hero-content">
          <span className="eyebrow">{showroomCity ? `${getBrandName()} · ${showroomCity}` : getBrandName()}</span>
          {businessSettings.heroHeadline ? <h1>{businessSettings.heroHeadline}</h1> : <h1>Elige lo que <em>te mueve.</em></h1>}
          <p>{businessSettings.heroSubheadline || "Vehículos con carácter, información clara y una atención diseñada alrededor de tu próxima historia."}</p>
          <div className="hero-actions"><a href="#catalog" className="hero-link primary-action hero-primary-action">Explorar inventario ↓</a><a href={`/presentacion${requestedDealerSlug ? `?dealer=${encodeURIComponent(requestedDealerSlug)}` : ""}`} className="hero-link hero-secondary-action">Ver presentación →</a><button type="button" className="hero-link hero-tertiary-action" onClick={() => setBuyerRequestKind("trade-in")}>¿Tienes vehículo? Valóralo →</button></div>
        </div>
        {hasInventory && <div className="hero-proof" aria-label={`Inventario de ${getBrandName()}`}>
          <span><strong><AnimatedMetric value={vehicles.length} suffix="" /></strong> {vehicles.length === 1 ? "vehículo disponible" : "vehículos disponibles"}</span>
          {heroBrandCount > 0 && <span><strong><AnimatedMetric value={heroBrandCount} suffix="" /></strong> {heroBrandCount === 1 ? "marca" : "marcas"}</span>}
          {businessSettings.hours && <span>{businessSettings.hours}</span>}
        </div>}
        <a className="hero-scroll-cue" href="#catalog" aria-label="Bajar al catálogo"><span /> SCROLL</a>
      </section>
      {/* Antes esta franja imponía a todo concesionario la misma pose de boutique
        ("PRIVATE SELECTION / no llenamos el catálogo"). Ahora dice lo que el comprador
        necesita saber de *este* concesionario, y desaparece si no hay nada que contar. */}
      {(businessSettings.address || businessSettings.hours || hasInventory) && <Reveal className="showroom-signal"><div className="showroom-signal-inner">
        <span className="showroom-signal-label">{businessSettings.address ? `${getBrandName()} · Dónde estamos` : getBrandName()}</span>
        <p>{businessSettings.address
          ? `${businessSettings.address}${businessSettings.hours ? ` · ${businessSettings.hours}` : ""}`
          : hasInventory
            ? `${vehicles.length} ${vehicles.length === 1 ? "vehículo disponible" : "vehículos disponibles"} con ficha completa, fotos y precio a la vista.`
            : ""}</p>
        {businessSettings.address
          ? <button type="button" onClick={() => navigate("/ubicacion")}>Cómo llegar <span>→</span></button>
          : <a href="#catalog">Ver el inventario <span>→</span></a>}
      </div></Reveal>}
      <IntentRail categories={categories} conditions={conditions} fuelTypes={fuelTypes} onChoose={chooseIntent} />
      <CompareDock vehicles={compareVehicles} onRemove={(id) => setCompareVehicles((current) => current.filter((item) => item.id !== id))} onClear={() => setCompareVehicles([])} />

      <section className="catalog" id="catalog" aria-busy={loading}>
        <div className="section-head"><div><span className="eyebrow">INVENTARIO · {vehicles.length.toString().padStart(2, "0")} MODELOS</span><h2>Catálogo activo.</h2></div><p>Inventario actualizado para ayudarte a decidir mejor.</p></div>
         <div className="catalog-intro-note">Una selección breve, pensada para decidir mejor.</div>
         <BudgetSearchPanel vehicles={vehicles} activeBudget={Number(maxMonthlyPayment) || 0} activeDownPayment={budgetDownPayment} activeMonths={budgetMonths} onApply={applyBudget} onClear={clearFilters} />
         <div className="filters-heading"><div><span className="eyebrow">BÚSQUEDA AVANZADA</span><strong>Filtra por lo que importa.</strong></div><span>Marca, precio, año y especificaciones</span><button className="filters-toggle" type="button" onClick={() => setFiltersOpen((current) => !current)} aria-expanded={filtersOpen}>{filtersOpen ? "Ocultar filtros" : "Más filtros"} <span>{filtersOpen ? "↑" : "↓"}</span></button></div>
         <div className={`filters ${filtersOpen ? "filters-expanded" : ""}`}>
          <SmartVehicleSearch vehicles={vehicles} value={search} onChange={setSearch} resultCount={filteredVehicles.length} onClear={() => setSearch("")} />
          <select className="filter-secondary" value={brand} onChange={(event) => setBrand(event.target.value)} aria-label="Filtrar por marca"><option value="all">Todas las marcas</option>{brands.map((item) => <option key={item} value={item}>{item}</option>)}</select>
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
         <div className="catalog-toolbar"><span aria-live="polite">{loading ? "Consultando inventario" : <><AnimatedMetric value={filteredVehicles.length} /> de <AnimatedMetric value={vehicles.length} /> vehículos visibles</>}</span><span className="catalog-toolbar-line" /><span>{maxMonthlyPayment ? `Hasta ${formatFinancePrice(Number(maxMonthlyPayment))}/mes` : "Desliza para explorar"}</span><button className={`favorites-filter ${favoritesOnly ? "is-active" : ""}`} type="button" onClick={() => setFavoritesOnly((current) => !current)} aria-pressed={favoritesOnly}>♡ Favoritos {favoriteIds.length ? <>· <AnimatedMetric value={favoriteIds.length} /></> : ""}</button></div>
        <div className="catalog-view-switcher" role="group" aria-label="Vista del catálogo"><span>Mostrar como</span><button type="button" className={catalogView === "grid" ? "is-active" : ""} onClick={() => setCatalogView("grid")} aria-pressed={catalogView === "grid"}>Cuadrícula</button><button type="button" className={catalogView === "list" ? "is-active" : ""} onClick={() => setCatalogView("list")} aria-pressed={catalogView === "list"}>Lista</button></div>
        {loading && <CatalogSkeleton />}
        {error && <CatalogError message={`${error}. Verifica que la API esté corriendo en el puerto 3001.`} onRetry={() => { setLoading(true); refreshVehicles(); }} />}
        {!loading && !error && (filteredVehicles.length ? <div className={`vehicle-grid ${catalogView === "list" ? "is-list-view" : ""}`}><AnimatePresence mode="popLayout" initial={false}>{filteredVehicles.map((vehicle, index) => <VehicleCard key={vehicle.id} vehicle={vehicle} isCompared={compareVehicles.some((item) => item.id === vehicle.id)} isFavorite={favoriteIds.includes(vehicle.id)} onToggleFavorite={toggleFavorite} onToggleCompare={toggleCompare} onOpen={(item) => navigate(vehiclePath(item))} imageLoading={index < 3 ? "eager" : "lazy"} />)}</AnimatePresence></div> : <div className="catalog-empty"><span className="eyebrow">BÚSQUEDA PERSONALIZADA</span><h3>No encontramos vehículos con esos criterios.</h3><p>Prueba limpiando la búsqueda o, si buscas algo específico, déjanos encontrarlo por ti.</p><div className="catalog-empty-actions"><button type="button" className="secondary-action" onClick={clearFilters}>Limpiar filtros</button><button type="button" className="text-button" onClick={() => setBuyerRequestKind("search-alert")}>Pedir ayuda al equipo →</button></div></div>)}
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
          {(businessSettings.phone || businessSettings.whatsapp || businessSettings.email || businessSettings.instagramUrl || businessSettings.facebookUrl) && <div className="site-footer-contact">{businessSettings.phone && <a href={`tel:${businessSettings.phone}`}>{businessSettings.phone}</a>}{businessSettings.whatsapp && <a href={`https://wa.me/${whatsappDigits(businessSettings.whatsapp)}`} target="_blank" rel="noreferrer" onClick={() => trackEvent("whatsapp_click")}>WhatsApp</a>}{businessSettings.email && <a href={`mailto:${businessSettings.email}`}>{businessSettings.email}</a>}{businessSettings.instagramUrl && <a href={businessSettings.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a>}{businessSettings.facebookUrl && <a href={businessSettings.facebookUrl} target="_blank" rel="noreferrer">Facebook ↗</a>}</div>}
          <div><span className="brand-mark">{businessSettings.businessName || "ZEVROA"}</span><p>Vehículos premium · inventario verificado.</p></div>
          <nav aria-label="Enlaces institucionales">
            <button type="button" onClick={() => navigate("/contacto")}>Contacto</button>
            <button type="button" onClick={() => navigate("/ubicacion")}>Ubicación</button>
            <button type="button" onClick={() => navigate("/privacidad")}>Privacidad</button>
            <button type="button" onClick={() => navigate("/terminos")}>Términos</button>
            <button type="button" onClick={() => { setAdminInitialMode("register"); setScreen("admin"); navigate("/backoffice"); }} style={{ color: "var(--auth-gold)" }}>¿Eres Dealer? Crea tu Showroom</button>
          </nav>
        </footer>
      </section>
      <StudioWhatsApp number={businessSettings.whatsapp} businessName={businessSettings.businessName || getBrandName()} className="studio-whatsapp showroom-whatsapp" label="Habla con ventas" ariaLabel={`Hablar con ${businessSettings.businessName || getBrandName()} por WhatsApp`} messageText={`Hola, me interesa conocer un vehículo de ${businessSettings.businessName || getBrandName()}.`} />
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
  componentDidCatch(error, info) { console.error("[ZEVROA] Error global de interfaz", error, info); reportError(error, { componentStack: info?.componentStack }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-error-boundary"><span className="eyebrow">{getBrandName()}</span><h1>Estamos afinando esta experiencia.</h1><p>La página encontró un problema inesperado. Puedes volver a cargarla para continuar.</p><button className="primary-action" type="button" onClick={() => window.location.reload()}>Recargar página</button></main>;
  }
}

export default function AppRoot() {
  return <AppErrorBoundary><App /><CookieConsentBanner /><SpeedInsights /></AppErrorBoundary>;
}

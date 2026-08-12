import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";

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

const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);

function publicMediaUrl(url) {
  if (!url) return url;
  // Los datos locales heredados guardaban el host de desarrollo. En una URL
  // pública el navegador del cliente no debe intentar cargar archivos desde
  // su propio localhost: se resuelven contra la API configurada.
  return String(url).replace(/^https?:\/\/(?:localhost|127\.0\.0\.1):3001(?=\/uploads\/)/i, apiUrl);
}

const analyticsSessionId = (() => { const key = "authentiq_analytics_session"; const current = localStorage.getItem(key); if (current) return current; const next = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(key, next); return next; })();
function trackEvent(eventName, payload = {}) { fetch(`${apiUrl}/api/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventName, path: window.location.pathname, sessionId: analyticsSessionId, ...payload }) }).catch(() => {}); }

function formatPrice(value) {
  return `$${Number(value).toLocaleString("en-US")} USD`;
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
  const ref = useRef(null);
  const visible = useInView(ref, { once: true, amount: 0.12 });
  return <motion.div ref={ref} className={className} initial={{ opacity: 0, y: 14 }} animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>;
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
  const share = async (event) => { event.stopPropagation(); const url = `${window.location.origin}${vehiclePath(vehicle)}`; try { if (navigator.share) await navigator.share({ title: `${vehicle.brand} ${vehicle.model}`, text: `Mira este ${vehicle.brand} ${vehicle.model} en ${getBrandName()}`, url }); else { await navigator.clipboard.writeText(url); setShared(true); window.setTimeout(() => setShared(false), 1600); } trackEvent("vehicle_share", { vehicleId: vehicle.id }); } catch { setShared(false); } };
  return <button className="detail-utility-action" type="button" onClick={share}>{shared ? "Enlace copiado ✓" : "Compartir vehículo ↗"}</button>;
}

function FinanceCalculator({ price }) {
  const [downPayment, setDownPayment] = useState(Math.round(Number(price) * .2));
  const [months, setMonths] = useState(60);
  const [rate, setRate] = useState(9.5);
  const principal = Math.max(Number(price) - Number(downPayment || 0), 0);
  const monthlyRate = Number(rate) / 100 / 12;
  const payment = principal && monthlyRate ? principal * (monthlyRate * (1 + monthlyRate) ** months) / ((1 + monthlyRate) ** months - 1) : principal / months;
  return <details className="finance-calculator"><summary>Estimar cuota mensual</summary><div className="finance-grid"><label>Inicial<input type="number" min="0" max={price} value={downPayment} onChange={(event) => setDownPayment(event.target.value)} /></label><label>Plazo<select value={months} onChange={(event) => setMonths(Number(event.target.value))}><option value="36">36 meses</option><option value="48">48 meses</option><option value="60">60 meses</option><option value="72">72 meses</option></select></label><label>Tasa estimada<input type="number" min="0" step=".1" value={rate} onChange={(event) => setRate(event.target.value)} /></label></div><div className="finance-result"><span>Cuota estimada</span><strong>{formatPrice(payment)} <small>/ mes</small></strong><p>No constituye una oferta financiera final.</p></div></details>;
}

function QuoteModal({ vehicle, onClose }) {
  return <motion.div className="quote-overlay" role="dialog" aria-modal="true" aria-label="Cotización del vehículo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><section className="quote-modal"><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar cotización">×</button><div className="quote-brand">{getBrandName()} <span>COTIZACIÓN DE VEHÍCULO</span></div><div className="quote-heading"><span className="eyebrow">PROPUESTA COMERCIAL</span><h2>{vehicle.brand} <em>{vehicle.model}</em></h2><p>{vehicle.year} · {vehicle.condition === "new" ? "Nuevo" : "Certificado"}</p></div><div className="quote-price"><span>Precio de lista</span><strong>{formatPrice(vehicle.priceUsd)}</strong></div><div className="quote-specs"><span>Motor <b>{vehicle.engine || "—"}</b></span><span>Potencia <b>{vehicle.power || "—"}</b></span><span>Transmisión <b>{vehicle.transmission || "—"}</b></span></div><p className="quote-note">Esta cotización es informativa y está sujeta a disponibilidad, inspección y aprobación comercial.</p><div className="quote-actions"><button className="primary-action" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button><button className="secondary-action" type="button" onClick={onClose}>Cerrar</button></div></section></motion.div>;
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
  return <main className="public-quote-page"><article className="public-quote-card"><header><span className="brand-mark">AUTHENTIQ°</span><span className="eyebrow">PROPUESTA COMERCIAL · {quote.quoteNumber}</span></header>{quote.imageUrl && <img className="public-quote-image" src={publicMediaUrl(quote.imageUrl)} alt={`${quote.brand || "Vehículo"} ${quote.model || ""}`} /> }<div className="public-quote-heading"><span className="eyebrow">PREPARADA PARA {quote.customerName}</span><h1>{quote.brand ? `${quote.brand} ${quote.model}` : "Tu vehículo seleccionado"}</h1><p>{quote.year ? `${quote.year} · ` : ""}{quote.variant || "Propuesta AUTHENTIQ"}</p></div><div className="public-quote-price"><span>Total propuesto</span><strong>{formatPrice(quote.totalUsd)}</strong><small>Válida hasta {dateLabel(quote.validUntil)}</small></div><div className="public-quote-specs"><span>Precio base <b>{formatPrice(quote.basePriceUsd)}</b></span><span>Descuento <b>{Number(quote.discountUsd) ? `-${formatPrice(quote.discountUsd)}` : "Sin descuento"}</b></span><span>Condición <b>{accepted ? "Aceptada" : "Enviada"}</b></span></div>{quote.notes && <p className="public-quote-notes">{quote.notes}</p>}{accepted ? <section className="public-quote-feedback success" aria-live="polite"><strong>✓ Cotización aceptada</strong><p>Gracias. Nuestro equipo continuará contigo para coordinar los próximos pasos.</p></section> : decisionState === "success" && decision === "changes" ? <section className="public-quote-feedback success" aria-live="polite"><strong>✓ Solicitud recibida</strong><p>Registramos tus cambios. Un asesor se pondrá en contacto contigo.</p></section> : <section className="public-quote-decisions" aria-label="Decidir sobre la cotización"><div><span className="eyebrow">SIGUIENTE PASO</span><h2>¿Cómo quieres continuar?</h2><p>Acepta la propuesta o indícanos qué te gustaría ajustar.</p></div><div className="public-quote-decision-actions"><button className="primary-action" type="button" onClick={() => submitDecision("accepted")} disabled={decisionState === "sending"}>✓ Aceptar cotización</button><button className="secondary-action" type="button" onClick={() => setDecisionState("writing")} disabled={decisionState === "sending"}>Solicitar cambios</button></div>{decisionState === "writing" && <div className="public-quote-change-form"><label htmlFor="quote-change-message">¿Qué te gustaría ajustar? <span>Opcional</span></label><textarea id="quote-change-message" value={decisionMessage} maxLength={500} onChange={(event) => setDecisionMessage(event.target.value)} placeholder="Ej. Me gustaría revisar el descuento o la forma de pago." /><div><small>{decisionMessage.length}/500</small><button className="primary-action" type="button" onClick={() => submitDecision("changes")} disabled={decisionState === "sending"}>{decisionState === "sending" ? "Enviando…" : "Enviar solicitud"}</button></div></div>}{decisionError && <p className="public-quote-decision-error" role="alert">{decisionError}</p>}</section>}<footer><span>Informativa y sujeta a disponibilidad, inspección y aprobación comercial.</span><button className="primary-action" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button></footer></article></main>;
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
      const handleLoad = () => { syncAnimations(); setProgress(100); setState("ready"); frameTimer = window.setTimeout(() => { void frameViewer(); }, 80); };
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
      <model-viewer ref={viewerRef} src={shouldLoad ? modelUrl : undefined} poster={poster} alt={model.altText || `${vehicle.brand} ${vehicle.model}, modelo 3D`} camera-controls auto-rotate auto-rotate-delay="1600" rotation-per-second="10deg" shadow-intensity="1" shadow-softness=".72" exposure="1" tone-mapping="aces" touch-action="pan-y" loading="eager" reveal="auto" ar ar-modes="webxr scene-viewer quick-look" />
      {state === "loading" && <div className="vehicle-3d-loading" role="status" aria-live="polite"><div className="vehicle-3d-loader-mark" aria-hidden="true"><span /><i /><b /></div><span>{shouldLoad ? "Preparando la experiencia 3D" : "Preparando el estudio visual"}</span><div className="vehicle-3d-loading-track"><i style={{ transform: `scaleX(${Math.max(progress / 100, shouldLoad ? 0.08 : 0.02)})` }} /></div></div>}
      {state === "ready" && availableAnimations.length > 0 && <div className="vehicle-3d-animation-controls" aria-label="Animaciones del modelo 3D">
        <button type="button" onClick={toggleAnimation} aria-pressed={animationPlaying}>{animationPlaying ? "Pausar animación" : "Reproducir animación"}</button>
        {availableAnimations.length > 1 && <select value={activeAnimation} onChange={chooseAnimation} aria-label="Seleccionar animación del modelo 3D">{availableAnimations.map((name) => <option key={name} value={name}>{name}</option>)}</select>}
        <span>{availableAnimations.length} {availableAnimations.length === 1 ? "clip detectado" : "clips detectados"}</span>
      </div>}
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
  return <section className="vehicle-video-showcase" aria-label={`Video de ${vehicle.brand} ${vehicle.model}`}><div className="vehicle-studio-heading"><div><span className="eyebrow">AUTHENTIQ / MOTION FILM</span><h2>Verlo en movimiento.</h2></div><span className="vehicle-3d-status">VIDEO OFICIAL</span></div><div className="vehicle-video-frame"><video controls playsInline preload="metadata" poster={video.posterUrl || vehicle.images?.[0]?.url} aria-label={`Video de ${vehicle.brand} ${vehicle.model}`} onError={() => setFailed(true)}><source src={video.url} onError={() => setFailed(true)} /></video></div></section>;
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
  const image = images[activeFrame]?.url || images[0]?.url;
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
    <div className="vehicle-studio-controls"><button className="icon-action" type="button" onClick={() => changeFrame(-1)} aria-label="Vista anterior">←</button><div className="vehicle-studio-frames">{images.map((item, index) => <button key={item.id || item.url} className={index === activeFrame ? "vehicle-studio-frame active" : "vehicle-studio-frame"} type="button" onClick={() => setActiveFrame(index)} aria-label={`Vista ${index + 1}`}><img src={item.url} alt="" /></button>)}</div><button className="icon-action" type="button" onClick={() => changeFrame(1)} aria-label="Vista siguiente">→</button></div>
    </section>
  </>;
}

const brandLogoSlugs = { Acura: "acura", "Alfa Romeo": "alfaromeo", Audi: "https://cdn.freebiesupply.com/logos/large/2x/audi-14-logo-png-transparent.png", Bentley: "bentley", BMW: "https://cdn.freebiesupply.com/logos/large/2x/bmw-logo-png-transparent.png", Buick: "buick", BYD: "byd", Cadillac: "cadillac", Changan: "changan", Chevrolet: "chevrolet", Chrysler: "chrysler", Citroen: "citroen", Daihatsu: "daihatsu", Dodge: "dodge", Ferrari: "ferrari", Fiat: "fiat", Ford: "ford", GMC: "gmc", Porsche: "https://cdn.freebiesupply.com/logos/large/2x/porsche-logo-png-transparent.png", "Mercedes-AMG": "https://cdn.freebiesupply.com/logos/large/2x/mercedes-benz-logo-png-transparent.png", "Mercedes-Benz": "https://cdn.freebiesupply.com/logos/large/2x/mercedes-benz-logo-png-transparent.png" };

const brandDirectory = ["Acura", "Alfa Romeo", "Audi", "Bentley", "BMW", "Buick", "BYD", "Cadillac", "Changan", "Chevrolet", "Chrysler", "Citroen", "Daihatsu", "Dodge", "Ferrari", "Fiat", "Ford", "GMC", "Mercedes-AMG", "Porsche"];

function BrandLogo({ brand, logoUrl = "", size = "normal" }) {
  const slug = brandLogoSlugs[brand];
  const source = logoUrl || (slug?.startsWith("http") ? slug : slug ? `https://cdn.simpleicons.org/${slug}` : "");
  const [failed, setFailed] = useState(!source);
  return <span className={`brand-logo brand-logo-${size}`} aria-label={`Logo de ${brand}`}>{!failed && <img src={source} alt="" onError={() => setFailed(true)} />}{failed && <b>{brand?.slice(0, 2).toUpperCase()}</b>}</span>;
}

function VehicleCard({ vehicle, onOpen, onToggleCompare, isCompared, isFavorite, onToggleFavorite, imageLoading = "lazy" }) {
  const image = vehicle.images?.[0]?.url || "/assets/hero-highway.webp";
  // La vista de ficha se registra al cambiar de ruta (cubre también los enlaces directos),
  // así que aquí no se emite un segundo vehicle_view para no duplicar la métrica.
  const open = () => onOpen(vehicle);
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
  const [status, setStatus] = useState({ loading: false, error: "", success: false });
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault(); setStatus({ loading: true, error: "", success: false });
    const body = { vehicleId: vehicle.id, ...form, amountUsd: Number(form.amountUsd) };
    try {
      const response = await fetch(`${apiUrl}/api/offers`, { method: "POST", headers: { "Content-Type": "application/json", ...(customerToken ? { Authorization: `Bearer ${customerToken}` } : {}) }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar la solicitud");
      trackEvent("offer_submitted", { vehicleId: vehicle.id });
      setStatus({ loading: false, error: "", success: true });
    } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  return <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }}><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>{status.success ? <div className="lead-success"><span className="eyebrow">OFERTA RECIBIDA</span><h2>Tu oferta está en revisión.</h2><p>El equipo de AUTHENTIQ revisará los datos y se pondrá en contacto contigo.</p><button className="primary-action" type="button" onClick={onClose}>Cerrar</button></div> : <><span className="eyebrow">CONTACTO COMERCIAL</span><h2 id="lead-title">Hacer una oferta.</h2><p className="modal-vehicle">{vehicle.brand} {vehicle.model} · {formatPrice(vehicle.priceUsd)}</p><form className="lead-form" onSubmit={submit}><label>Nombre<input value={form.buyerName} onChange={(event) => change("buyerName", event.target.value)} required /></label><div className="lead-form-grid"><label>Correo<input type="email" value={form.buyerEmail} onChange={(event) => change("buyerEmail", event.target.value)} /></label><label>Teléfono<input value={form.buyerPhone} onChange={(event) => change("buyerPhone", event.target.value)} /></label></div><label>Monto de oferta USD<input type="number" min="1" step="0.01" value={form.amountUsd} onChange={(event) => change("amountUsd", event.target.value)} required /></label><label>Mensaje<textarea value={form.message} onChange={(event) => change("message", event.target.value)} placeholder="Cuéntanos algo sobre tu propuesta..." /></label><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => change("privacyConsent", event.target.checked)} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para esta solicitud.</span></label>{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando..." : "Enviar oferta"}</button></form></>}</motion.section></motion.div>;
}

function TestDriveModal({ vehicle, onClose }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", date: "", time: "", privacyConsent: false });
  const [status, setStatus] = useState({ loading: false, error: "", success: false });
  const [availability, setAvailability] = useState({ loading: false, slots: [], message: "Selecciona una fecha para ver los horarios disponibles." });
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
    try { const response = await fetch(`${apiUrl}/api/appointments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, vehicleId: vehicle.id }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "No se pudo registrar la cita"); trackEvent("appointment_submitted", { vehicleId: vehicle.id }); setStatus({ loading: false, error: "", success: true }); } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  const minDate = new Date().toISOString().slice(0, 10);
  return <motion.div className="lead-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.section className="lead-modal test-drive-modal" role="dialog" aria-modal="true" aria-labelledby="test-drive-title" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: .2, ease: "easeOut" }}><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>{status.success ? <div className="lead-success"><span className="eyebrow">CITA RECIBIDA</span><h2>Tu cita está en revisión.</h2><p>Un asesor confirmará el horario y te contactará con los detalles de tu visita.</p><button className="primary-action" type="button" onClick={onClose}>Cerrar</button></div> : <><span className="eyebrow">AGENDA AUTHENTIQ</span><h2 id="test-drive-title">Agenda tu cita.</h2><p className="modal-vehicle">{vehicle.brand} {vehicle.model} · {vehicle.year}</p><form className="lead-form" onSubmit={submit}><label>Nombre<input value={form.name} onChange={(event) => change("name", event.target.value)} autoComplete="name" required /></label><div className="lead-form-grid"><label>Correo<input type="email" value={form.email} onChange={(event) => change("email", event.target.value)} autoComplete="email" required /></label><label>Teléfono<input value={form.phone} onChange={(event) => change("phone", event.target.value)} autoComplete="tel" required /></label></div><div className="lead-form-grid"><label>Fecha<input type="date" min={minDate} value={form.date} onChange={(event) => { change("date", event.target.value); change("time", ""); }} required /></label><label>Horario<select value={form.time} onChange={(event) => change("time", event.target.value)} disabled={!form.date || availability.loading} required><option value="">{availability.loading ? "Consultando…" : "Selecciona un horario"}</option>{availability.slots.filter((slot) => slot.available).map((slot) => <option value={slot.time} key={slot.time}>{slot.time}</option>)}</select></label></div><p className={`appointment-availability-note${availability.slots.length && !availability.slots.some((slot) => slot.available) ? " is-full" : ""}`}>{availability.message}</p><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => change("privacyConsent", event.target.checked)} required /><span>Acepto la política de privacidad y autorizo el uso de mis datos para coordinar la visita.</span></label>{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading || availability.loading || !form.time}>{status.loading ? "Registrando…" : "Solicitar cita"}</button></form></>}</motion.section></motion.div>;
}

function CustomerAccountModal({ customer, form, mode, status, favoriteCount, activity = { offers: [], quotes: [], notifications: [] }, onChange, onSubmit, onMode, onClose, onLogout, onReadNotifications }) {
  return <motion.div className="quote-overlay" role="dialog" aria-modal="true" aria-label="Cuenta de comprador" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <section className="customer-account-modal">
      <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar cuenta">×</button>
      {customer ? <>
        <span className="eyebrow">AUTHENTIQ · MI CUENTA</span>
        <h2>Tu selección, <em>guardada.</em></h2>
        <p className="account-welcome">Hola, {customer.name}. Tus vehículos favoritos estarán disponibles cuando vuelvas.</p>
        <div className="account-summary"><div><strong>{favoriteCount}</strong><span>favoritos</span></div><div><strong>{activity.offers.length + activity.quotes.length}</strong><span>solicitudes</span></div></div>
        {!!activity.notifications.length && <div className="account-notifications"><div className="account-activity-head"><span className="eyebrow">AVISOS</span>{activity.notifications.some((item) => !item.readAt) && <button type="button" onClick={onReadNotifications}>Marcar como leídos</button>}</div>{activity.notifications.slice(0, 4).map((item) => <article className={item.readAt ? "account-notification" : "account-notification unread"} key={item.id}><strong>{item.title}</strong><span>{item.body}</span><small>{new Date(item.createdAt).toLocaleDateString("es-DO", { day: "2-digit", month: "short" })}</small></article>)}</div>}
        <div className="account-activity"><div className="account-activity-head"><span className="eyebrow">ACTIVIDAD COMERCIAL</span><span>Últimas solicitudes</span></div>{activity.offers.length || activity.quotes.length ? <>{activity.offers.slice(0, 3).map((item) => <article className="account-activity-row" key={`offer-${item.id}`}><div><strong>{item.brand} {item.model}</strong><span>Oferta · {formatPrice(item.amountUsd)}</span></div><b className={`status-pill ${item.status}`}>{item.status === "accepted" ? "Aceptada" : item.status === "rejected" ? "Rechazada" : "Pendiente"}</b></article>)}{activity.quotes.slice(0, 3).map((item) => <article className="account-activity-row" key={`quote-${item.id}`}><div><strong>{item.quoteNumber}</strong><span>Cotización · {formatPrice(item.totalUsd)}</span></div><b className={`status-pill ${item.status}`}>{item.status === "accepted" ? "Aceptada" : item.status === "sent" ? "Enviada" : item.status === "cancelled" ? "Cancelada" : item.status === "expired" ? "Vencida" : "Borrador"}</b></article>)}</> : <p className="account-activity-empty">Todavía no tienes ofertas ni cotizaciones registradas.</p>}</div>
        <div className="quote-actions"><button className="primary-action" type="button" onClick={onClose}>Seguir explorando</button><button className="secondary-action" type="button" onClick={onLogout}>Cerrar sesión</button></div>
      </> : <>
        <span className="eyebrow">AUTHENTIQ · CUENTA DE COMPRADOR</span>
        <h2>{mode === "login" ? <>Vuelve a tu <em>selección.</em></> : <>Guarda lo que te <em>mueve.</em></>}</h2>
        <p className="account-welcome">{mode === "login" ? "Accede a tus favoritos desde cualquier dispositivo." : "Crea una cuenta para conservar tus favoritos y continuar tu búsqueda."}</p>
        <form className="customer-account-form" onSubmit={onSubmit}>
          {mode === "register" && <label>Nombre completo<input value={form.name} onChange={(event) => onChange("name", event.target.value)} autoComplete="name" required /></label>}
          <label>Correo<input type="email" value={form.email} onChange={(event) => onChange("email", event.target.value)} autoComplete="email" required /></label>
          {mode === "register" && <label>Teléfono <span>(opcional)</span><input value={form.phone} onChange={(event) => onChange("phone", event.target.value)} autoComplete="tel" /></label>}
          <label>Contraseña<input type="password" minLength="8" value={form.password} onChange={(event) => onChange("password", event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></label>
          {status.error && <p className="state-message error">{status.error}</p>}
          <button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Procesando…" : mode === "login" ? "Entrar a mi cuenta" : "Crear mi cuenta"}</button>
        </form>
        <button className="account-mode-switch" type="button" onClick={() => onMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "¿Aún no tienes cuenta? Crear una" : "Ya tengo una cuenta · Entrar"}</button>
      </>}
    </section>
  </motion.div>;
}

function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", privacyConsent: false });
  const [status, setStatus] = useState({ loading: false, error: "", success: false });
  const submit = async (event) => {
    event.preventDefault(); setStatus({ loading: true, error: "", success: false });
    try {
      const response = await fetch(`${apiUrl}/api/leads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo enviar el mensaje");
      setStatus({ loading: false, error: "", success: true }); trackEvent("contact_submitted"); setForm({ name: "", email: "", phone: "", message: "", privacyConsent: false });
    } catch (error) { setStatus({ loading: false, error: error.message, success: false }); }
  };
  return <section className="contact-section" id="contact"><div><span className="eyebrow">CONTACTO DIRECTO</span><h2>Hablemos de tu próximo vehículo.</h2><p>Déjanos tus datos y un asesor de {getBrandName()} se pondrá en contacto contigo.</p></div><form className="contact-form" onSubmit={submit}><label>Nombre<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><div className="lead-form-grid"><label>Correo<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Teléfono<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label></div><label>Mensaje<textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} required /></label><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => setForm({ ...form, privacyConsent: event.target.checked })} required /><span>Acepto la politica de privacidad y autorizo el uso de mis datos para responder este mensaje.</span></label>{status.success && <p className="form-message success-message">Mensaje recibido. Te contactaremos pronto.</p>}{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando..." : "Enviar mensaje"}</button></form></section>;
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
  return <main className="article-page"><button className="back-button" onClick={onBack}>← Volver al catálogo</button><article className="article-body"><header><span className="eyebrow">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("es-DO", { day: "2-digit", month: "long", year: "numeric" }) : "AUTHENTIQ · JOURNAL"}</span><h1>{post.title}</h1>{post.summary && <p className="article-summary">{post.summary}</p>}</header>{post.coverImageUrl && <img className="article-cover" src={post.coverImageUrl} alt={post.title} /> }<div className="article-content">{post.content.split(/\r?\n/).map((paragraph, index) => paragraph.trim() ? <p key={`${post.id}-${index}`}>{paragraph}</p> : <br key={`${post.id}-space-${index}`} />)}</div></article></main>;
}

function DetailTrustStrip() {
  return <section className="detail-trust-strip" aria-label="Compromisos AUTHENTIQ"><div><span className="detail-trust-mark">01</span><strong>Inventario verificado</strong><p>Informacion clara antes de decidir.</p></div><div><span className="detail-trust-mark">02</span><strong>Atencion 1:1</strong><p>Un asesor acompana el siguiente paso.</p></div><div><span className="detail-trust-mark">03</span><strong>Cotizacion transparente</strong><p>Sin sorpresas en la propuesta.</p></div></section>;
}

function similarityScore(source, candidate) {
  if (!source || source.id === candidate.id) return -Infinity;
  const sourcePrice = Number(source.priceUsd) || 0;
  const candidatePrice = Number(candidate.priceUsd) || 0;
  const priceDistance = sourcePrice ? Math.abs(candidatePrice - sourcePrice) / sourcePrice : 1;
  const yearDistance = Math.abs(Number(source.year || 0) - Number(candidate.year || 0));
  return (source.category && source.category === candidate.category ? 5 : 0)
    + (source.brand && source.brand === candidate.brand ? 3 : 0)
    + (source.fuelType && source.fuelType === candidate.fuelType ? 1 : 0)
    + (source.transmission && source.transmission === candidate.transmission ? 1 : 0)
    + (priceDistance <= 0.15 ? 4 : priceDistance <= 0.25 ? 2 : 0)
    + (yearDistance <= 2 ? 1 : 0);
}

function similarityReason(source, candidate) {
  const sourcePrice = Number(source.priceUsd) || 0;
  const candidatePrice = Number(candidate.priceUsd) || 0;
  if (source.category && source.category === candidate.category) return `Misma categoria${candidatePrice < sourcePrice ? " · precio menor" : ""}`;
  if (Math.abs(candidatePrice - sourcePrice) / Math.max(sourcePrice, 1) <= 0.15) return "Precio similar";
  if (Number(candidate.year) > Number(source.year)) return "Modelo mas reciente";
  if (source.fuelType && source.fuelType === candidate.fuelType) return `Mismo combustible · ${candidate.fuelType}`;
  return "Alternativa de la seleccion";
}

function SimilarVehicles({ vehicle, vehicles, compareVehicles, favoriteIds, onOpen, onToggleCompare, onToggleFavorite }) {
  const similar = useMemo(() => vehicles
    .filter((candidate) => ["published", "reserved"].includes(candidate.status))
    .map((candidate) => ({ vehicle: candidate, score: similarityScore(vehicle, candidate) }))
    .filter((item) => Number.isFinite(item.score) && item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.vehicle), [vehicle, vehicles]);
  if (!similar.length) return null;
  return <section className="similar-vehicles" aria-label="Vehículos similares"><div className="section-head"><div><span className="eyebrow">SIGUE EXPLORANDO</span><h2>Si te gusta este, mira estos.</h2></div><p>Alternativas seleccionadas desde el inventario actual.</p></div><div className="similar-vehicle-grid">{similar.map((candidate, index) => <div className="similar-vehicle-item" key={candidate.id}><span className="similar-vehicle-reason">{similarityReason(vehicle, candidate)}</span><VehicleCard vehicle={candidate} isCompared={compareVehicles.some((item) => item.id === candidate.id)} isFavorite={favoriteIds.includes(candidate.id)} onOpen={onOpen} onToggleCompare={onToggleCompare} onToggleFavorite={onToggleFavorite} imageLoading={index < 2 ? "eager" : "lazy"} /></div>)}</div></section>;
}

function VehicleDecisionSummary({ vehicle }) {
  const categoryLabel = { suv: "SUV", sports: "Deportivo", sedan: "Sedán", coupe: "Coupé", truck: "Pickup" }[vehicle.category] || vehicle.category || "Selección premium";
  const categoryCopy = { suv: "Espacio, altura y presencia para moverte con confianza.", sports: "Respuesta, diseño y una experiencia más emocionante.", sedan: "Confort y equilibrio para el uso diario.", coupe: "Una silueta especial para disfrutar cada trayecto.", truck: "Capacidad y carácter para trabajar o salir de ruta." }[vehicle.category] || "Un modelo elegido por su carácter y configuración.";
  const conditionLabel = vehicle.condition === "new" ? "Unidad nueva" : "Inventario certificado";
  const conditionCopy = vehicle.condition === "new" ? "Configuración actual y entrega sujeta a disponibilidad." : "Una alternativa revisada para comprar con mayor tranquilidad.";
  const usageLabel = vehicle.transmission || vehicle.fuelType || "Configuración premium";
  const usageCopy = vehicle.transmission ? `Una conducción ${vehicle.transmission.toLowerCase()} para el día a día.` : "Especificaciones pensadas para una experiencia premium.";
  return <section className="detail-decision-summary" aria-label="Resumen de decisión"><div className="detail-decision-summary-head"><span className="eyebrow">POR QUÉ CONSIDERARLO</span><p>Una lectura rápida antes de revisar cada especificación.</p></div><div className="detail-decision-summary-grid"><article><span>01</span><strong>{categoryLabel}</strong><p>{categoryCopy}</p></article><article><span>02</span><strong>{conditionLabel}</strong><p>{conditionCopy}</p></article><article><span>03</span><strong>{usageLabel}</strong><p>{usageCopy}</p></article></div></section>;
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

function VehicleDetail({ vehicle, vehicles = [], onBack, isFavorite = false, onToggleFavorite = () => {}, customerToken = "", compareVehicles = [], favoriteIds = [], onOpenVehicle = () => {}, onToggleCompare = () => {} }) {
  const [activeImage, setActiveImage] = useState(0);
  const [leadType, setLeadType] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const images = vehicle.images?.length ? vehicle.images : [{ url: "/assets/hero-highway.webp" }];
  const image = images[activeImage]?.url || images[0].url;
  const structuredData = JSON.stringify({ "@context": "https://schema.org", "@type": "Vehicle", name: `${vehicle.brand} ${vehicle.model}`, model: vehicle.model, vehicleConfiguration: vehicle.variant || undefined, fuelType: vehicle.fuelType || undefined, color: vehicle.exteriorColor || undefined, brand: { "@type": "Brand", name: vehicle.brand }, vehicleModelDate: String(vehicle.year), image: images.map((item) => new URL(item.url, window.location.origin).href), mileageFromOdometer: { "@type": "QuantitativeValue", value: Number(vehicle.mileageKm), unitCode: "KMT" }, offers: { "@type": "Offer", priceCurrency: "USD", price: Number(vehicle.priceUsd), availability: vehicle.status === "published" ? "https://schema.org/InStock" : "https://schema.org/LimitedAvailability" } }).replace(/</g, "\\u003c");
  useEffect(() => {
    const model = vehicle.media?.find((item) => item.type === "model_3d");
    if (model?.posterUrl) ensurePreload(publicMediaUrl(model.posterUrl), "image");
  }, [vehicle.id, vehicle.media]);

  return (
    <motion.main
      className="detail-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <div className="detail-topbar"><button className="back-button" onClick={onBack}>Volver al catálogo</button><span className="detail-topbar-context">{vehicle.brand} · {vehicle.model}</span><a href="#similar-vehicles" className="detail-topbar-link">Ver similares ↓</a></div>
      <section className="detail-grid">
        <div>
          <div className="detail-image-wrap" role="button" tabIndex="0" aria-label="Ampliar imagen" onClick={() => setLightboxOpen(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setLightboxOpen(true); }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={image}
                src={image}
                alt={`${vehicle.brand} ${vehicle.model}`}
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
                <img src={item.url} alt="" />
              </button>
            ))}
          </div>
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
              ["Potencia", vehicle.power],
              ["Transmisión", vehicle.transmission],
              ["Tracción", vehicle.drive],
              ["Combustible", vehicle.fuelType],
              ["Exterior", vehicle.exteriorColor],
              ["Interior", vehicle.interiorColor],
              ["Puertas / asientos", vehicle.doors || vehicle.seats ? `${vehicle.doors || "—"} / ${vehicle.seats || "—"}` : null],
              ["Kilometraje", `${Number(vehicle.mileageKm).toLocaleString("en-US")} km`],
              ["Ubicación", vehicle.location],
              ["Inventario", vehicle.stockNumber],
              ["Garantía", vehicle.warranty],
            ].map(([label, value]) => <div className="spec-row" key={label}><span>{label}</span><strong>{value || "—"}</strong></div>)}
          </div>
          <FinanceCalculator price={vehicle.priceUsd} />
          <button className="detail-utility-action test-drive-link" type="button" onClick={() => setLeadType("test-drive")}>Agenda tu cita →</button>
          <button className="detail-utility-action studio-jump" type="button" onClick={() => document.getElementById(vehicle.media?.some((item) => item.type === "model_3d") ? "vehicle-3d-viewer" : "vehicle-studio")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{vehicle.media?.some((item) => item.type === "model_3d") ? "Explorar modelo 3D ↓" : "Explorar Studio ↓"}</button>
          <div className="detail-actions">
            <button className="primary-action" type="button" onClick={() => setLeadType("offer")} disabled={vehicle.status === "reserved"}>{vehicle.status === "reserved" ? "Vehículo reservado" : "Hacer una oferta"}</button>
            <button className="secondary-action" type="button" onClick={() => setQuoteOpen(true)}>Generar cotización PDF</button>
          </div>
          <div className="detail-utilities"><ShareAction vehicle={vehicle} /><button className={`detail-utility-action favorite-detail-action ${isFavorite ? "is-selected" : ""}`} type="button" onClick={() => onToggleFavorite(vehicle)}>{isFavorite ? "Guardado en favoritos ♥" : "Guardar en favoritos ♡"}</button><a className="detail-utility-action" href={`https://wa.me/?text=${encodeURIComponent(`Mira este ${vehicle.brand} ${vehicle.model} en AUTHENTIQ: ${window.location.origin}${vehiclePath(vehicle)}`)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp ↗</a></div>
          {vehicle.description && <div className="detail-description"><span className="eyebrow">SOBRE ESTE VEHÍCULO</span><p>{vehicle.description}</p></div>}
          {!!vehicle.features?.length && <div className="detail-features"><span className="eyebrow">EQUIPAMIENTO DESTACADO</span><div>{vehicle.features.map((feature) => <span key={feature}>{feature}</span>)}</div></div>}
          <VehicleDecisionSummary vehicle={vehicle} />
          <p className="phase-note">Las solicitudes se guardan y aparecen en el backoffice para revisión.</p>
        </div>
      </section>
      <SectionBoundary name="estudio visual" message="El visor multimedia no pudo mostrarse. Los datos y la galería del vehículo siguen disponibles."><VehicleStudio vehicle={vehicle} images={images} /></SectionBoundary>
      <DetailTrustStrip />
      <div id="similar-vehicles"><SimilarVehicles vehicle={vehicle} vehicles={vehicles} compareVehicles={compareVehicles} favoriteIds={favoriteIds} onOpen={onOpenVehicle} onToggleCompare={onToggleCompare} onToggleFavorite={onToggleFavorite} /></div>
      <aside className="detail-decision-bar" aria-label="Acciones principales del vehículo">
        <div>
          <span className="eyebrow">SIGUIENTE PASO</span>
          <strong>{formatPrice(vehicle.priceUsd)}</strong>
          <p>{vehicle.status === "reserved" ? "Este vehículo está reservado. Podemos avisarte si vuelve a estar disponible." : "Un asesor responde tu solicitud con la información completa del vehículo."}</p>
        </div>
        <span className="detail-decision-vehicle">{vehicle.brand} {vehicle.model} · {vehicle.year}</span>
        <div className="detail-decision-actions">
          <button className="primary-action" type="button" onClick={() => setLeadType("offer")} disabled={vehicle.status === "reserved"}>{vehicle.status === "reserved" ? "Reservado" : "Hacer una oferta"}</button>
          <button className="secondary-action" type="button" onClick={() => setQuoteOpen(true)}>Cotización</button>
        </div>
      </aside>
      <div className="detail-mobile-actions" aria-label="Acciones rápidas del vehículo">
        <button className="primary-action" type="button" onClick={() => setLeadType("offer")} disabled={vehicle.status === "reserved"}>{vehicle.status === "reserved" ? "Reservado" : "Hacer una oferta"}</button>
        <button className="secondary-action" type="button" onClick={() => setLeadType("test-drive")}>Agendar cita</button>
        <a className="detail-mobile-whatsapp" href={`https://wa.me/?text=${encodeURIComponent(`Mira este ${vehicle.brand} ${vehicle.model} en AUTHENTIQ: ${window.location.origin}${vehiclePath(vehicle)}`)}`} target="_blank" rel="noreferrer" aria-label="Enviar vehículo por WhatsApp">WhatsApp</a>
      </div>
      <AnimatePresence>{leadType === "offer" && <LeadForm vehicle={vehicle} customerToken={customerToken} onClose={() => setLeadType(null)} />}</AnimatePresence>
      <AnimatePresence>{leadType === "test-drive" && <TestDriveModal vehicle={vehicle} onClose={() => setLeadType(null)} />}</AnimatePresence>
      <AnimatePresence>{quoteOpen && <QuoteModal vehicle={vehicle} onClose={() => setQuoteOpen(false)} />}</AnimatePresence>
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
  const configuredSections = type === "location" ? [["Showroom", settings.address || "La direccion del showroom sera publicada cuando el negocio confirme esos datos."], ["Horario", settings.hours || "Horario pendiente de confirmacion."]] : type === "privacy" ? [["Politica vigente", settings.privacyText || content.sections[0][1]]] : type === "terms" ? [["Terminos vigentes", settings.termsText || content.sections[0][1]]] : content.sections;
  return <motion.main className="institutional-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24, ease: "easeOut" }}>
    <button className="back-button" onClick={onBack}>← Volver al catálogo</button>
    <section className="institutional-hero"><span className="eyebrow">{content.eyebrow.replace(/AUTHENTIQ/g, brand)}</span><h1>{content.title}</h1><p>{content.intro.replace(/AUTHENTIQ/g, brand)}</p></section>
    <section className="institutional-sections">{configuredSections.map(([heading, text]) => <article key={heading}><span className="eyebrow">{heading}</span><p>{text}</p></article>)}</section>
  </motion.main>;
}

function LegacyCompareDock({ vehicles, onRemove, onClear }) {
  if (!vehicles.length) return null;
  return <aside className="compare-dock" aria-label="Comparador de vehículos"><div className="compare-dock-head"><div><span className="eyebrow">SELECCIÓN INTELIGENTE</span><strong>Comparar vehículos <small>{vehicles.length}/3</small></strong></div><button className="text-button" type="button" onClick={onClear}>Limpiar</button></div><div className="compare-grid">{vehicles.map((vehicle) => <article key={vehicle.id} className="compare-item"><button type="button" className="compare-remove" onClick={() => onRemove(vehicle.id)} aria-label={`Quitar ${vehicle.model}`}>×</button><img src={vehicle.images?.[0]?.url || "/assets/hero-highway.webp"} alt="" loading="lazy" decoding="async" /><strong>{vehicle.brand} {vehicle.model}</strong><span>{formatPrice(vehicle.priceUsd)}</span></article>)}</div><div className="compare-summary"><span>{vehicles.length > 1 ? "Revisa precio, potencia y kilometraje de tus favoritos." : "Añade un modelo más para activar la comparación."}</span>{vehicles.length > 1 ? <a href="#compare-table">Ver comparación ↓</a> : <a href="#catalog">Seguir explorando ↓</a>}</div></aside>;
}

function CompareDock({ vehicles, onRemove, onClear }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!vehicles.length) return null;
  return <aside className={`compare-dock ${collapsed ? "is-collapsed" : ""}`} aria-label="Comparador de vehículos"><div className="compare-dock-head"><div><span className="eyebrow">SELECCIÓN INTELIGENTE</span><strong>Comparar vehículos <small>{vehicles.length}/3</small></strong></div><div className="compare-dock-actions"><button className="compare-collapse" type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? "Desplegar comparador" : "Plegar comparador"}><NavIcon name={collapsed ? "chevronUp" : "chevronDown"} /></button><button className="text-button" type="button" onClick={onClear}>Limpiar</button></div></div>{!collapsed && <><div className="compare-grid">{vehicles.map((vehicle) => <article key={vehicle.id} className="compare-item"><button type="button" className="compare-remove" onClick={() => onRemove(vehicle.id)} aria-label={`Quitar ${vehicle.model}`}>×</button><img src={vehicle.images?.[0]?.url || "/assets/hero-highway.webp"} alt="" loading="lazy" decoding="async" /><strong>{vehicle.brand} {vehicle.model}</strong><span>{formatPrice(vehicle.priceUsd)}</span></article>)}</div><div className="compare-summary"><span>{vehicles.length > 1 ? "Revisa precio, potencia y kilometraje de tus favoritos." : "Añade un modelo más para activar la comparación."}</span>{vehicles.length > 1 ? <a href="#compare-table">Ver comparación ↓</a> : <a href="#catalog">Seguir explorando ↓</a>}</div></>}</aside>;
}

function CompareTable({ vehicles }) {
  if (vehicles.length < 2) return <section className="compare-table-section compare-table-empty" id="compare-table"><div className="compare-empty-mark">{vehicles.length ? "01" : "00"}</div><div><span className="eyebrow">COMPARACIÓN / {vehicles.length}/2 MÍNIMO</span><h2>{vehicles.length ? "Elige un modelo más." : "Compara antes de decidir."}</h2><p>{vehicles.length ? "Ya tienes un vehículo seleccionado. Añade otro desde cualquier tarjeta para ver precio, potencia, kilometraje y ficha técnica en paralelo." : "Selecciona hasta tres vehículos y revisa sus diferencias en una sola vista, sin perder tu selección."}</p><a className="detail-utility-action" href="#catalog">Explorar inventario ↓</a></div></section>;
  const rows = [["Precio", (vehicle) => formatPrice(vehicle.priceUsd)], ["Año", (vehicle) => vehicle.year], ["Versión", (vehicle) => vehicle.variant || "—"], ["Combustible", (vehicle) => vehicle.fuelType || "—"], ["Transmisión", (vehicle) => vehicle.transmission || "—"], ["Potencia", (vehicle) => vehicle.power || "—"], ["Kilometraje", (vehicle) => `${Number(vehicle.mileageKm || 0).toLocaleString("en-US")} km`], ["Tracción", (vehicle) => vehicle.drive || "—"], ["Ubicación", (vehicle) => vehicle.location || "—"]];
  return <section className="compare-table-section" id="compare-table"><div className="section-head"><div><span className="eyebrow">COMPARACIÓN</span><h2>Decide con claridad.</h2></div><p>{vehicles.length} vehículos seleccionados</p></div><div className="compare-vehicle-rail" style={{ "--compare-columns": vehicles.length }} aria-label="Modelos seleccionados para comparar">{vehicles.map((vehicle, index) => <article className="compare-vehicle-card" key={vehicle.id}><img src={vehicle.images?.[0]?.url || "/assets/hero-highway.webp"} alt={`${vehicle.brand} ${vehicle.model}`} loading="lazy" decoding="async" /><div><span className="eyebrow">0{index + 1} · {vehicle.year} · {vehicle.condition === "new" ? "NUEVO" : "CERTIFICADO"}</span><h3>{vehicle.brand} {vehicle.model}</h3><strong>{formatPrice(vehicle.priceUsd)}</strong><p><b>{vehicle.power || "—"}</b><span>Potencia</span></p></div></article>)}</div><div className="compare-table" style={{ "--compare-columns": vehicles.length }}><div className="compare-table-labels"><span>Modelo</span>{rows.map(([label]) => <span key={label}>{label}</span>)}</div>{vehicles.map((vehicle) => <div className="compare-column" key={vehicle.id}><strong>{vehicle.brand} {vehicle.model}</strong>{rows.map(([_label, value]) => <span key={_label}>{value(vehicle)}</span>)}</div>)}</div></section>;
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

function ShowroomTrustRail() {
  return <section className="showroom-trust-rail" aria-label="Razones para comprar en AUTHENTIQ"><div><span>01</span><strong>Inventario verificado</strong><p>Información clara antes de decidir.</p></div><div><span>02</span><strong>Precio transparente</strong><p>Sin sorpresas en la conversación comercial.</p></div><div><span>03</span><strong>Atención 1:1</strong><p>Un asesor acompaña el siguiente paso.</p></div></section>;
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
  return <section id="models" className="model-lines-section" aria-label="Explorar lineas y modelos"><div className="section-head"><div><span className="eyebrow">LINEAS DE MODELO</span><h2>Encuentra la version correcta.</h2></div><p>Explora por familia y llega directo al inventario disponible.</p></div><div className="model-line-rail">{lines.map((vehicle, index) => { const count = vehicles.filter((item) => item.brand === vehicle.brand && item.model === vehicle.model).length; return <button className="model-line-card" type="button" key={`${vehicle.brand}-${vehicle.model}`} onClick={() => onChooseLine(vehicle)}><span className="model-line-index">0{index + 1}</span><span className="model-line-copy"><strong>{vehicle.brand} {vehicle.model}</strong><small>{vehicle.category || "Vehiculo premium"} · {vehicle.year} · {count} disponible{count === 1 ? "" : "s"}</small></span><span className="model-line-arrow">→</span></button>; })}</div></section>;
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
  const paymentLabel = numericPrice > 0 ? formatPrice(payment) : "Introduce un precio";
  if (!vehicles.length) return null;
  return <section className="financing-spotlight" aria-label="Calculadora de financiamiento"><div className="financing-copy"><span className="eyebrow">COMPRA A TU RITMO</span><h2>Calcula una cuota orientativa.</h2><p>Hazte una idea del presupuesto mensual antes de hablar con un asesor. La aprobación final depende de la entidad financiera.</p><button type="button" className="secondary-action" onClick={onExplore}>Ver vehículos disponibles →</button></div><div className="financing-controls"><label>Precio del vehículo<input type="number" min="0" value={price ?? ""} aria-label="Precio del vehículo" onChange={(event) => setPrice(event.target.value === "" ? null : Number(event.target.value))} /></label><label>Inicial <output>{downPayment}%</output><input type="range" min="0" max="70" step="5" value={downPayment} aria-label="Porcentaje de inicial" onChange={(event) => setDownPayment(Number(event.target.value))} /></label><label>Plazo <output>{months} meses</output><input type="range" min="12" max="84" step="12" value={months} aria-label="Plazo de financiamiento en meses" onChange={(event) => setMonths(Number(event.target.value))} /></label><div className={`financing-result${numericPrice > 0 ? "" : " is-empty"}`}><span>Cuota estimada</span>{numericPrice > 0 ? <><strong>{paymentLabel}</strong><small>12% anual · sin seguros ni gastos adicionales</small></> : <p>Introduce un precio para calcular.</p>}</div></div></section>;
}

function NavIcon({ name }) {
  const paths = { inventory: "M3 5h18M5 5v14h14V5M8 9h8M8 13h5", brands: "M4 6h16v12H4zM8 6v12M16 6v12", compare: "M5 5h5v14H5zM14 5h5v14h-5z", explore: "M12 3l2.8 5.7L21 10l-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 10l6.2-1.3z", menu: "M4 7h16M4 12h16M4 17h16", chevronUp: "m6 15 6-6 6 6", chevronDown: "m6 9 6 6 6-6", power: "M12 3v9m5.66-6.66a8 8 0 1 1-11.32 0" };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.inventory} /></svg>;
}

function LegacyShowroomNav({ theme, setTheme, customer, onAccount, onBackoffice }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 36);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const links = [["inventory", "Inventario", "#catalog"], ["brands", "Marcas", "#brands"], ["explore", "Modelos", "#models"], ["compare", "Comparar", "#compare-table"]];
  const closeMenu = () => setMenuOpen(false);
  return <nav className={`top-nav showroom-nav ${scrolled ? "is-scrolled" : ""}`} aria-label="Navegación principal"><a className="brand-mark showroom-nav-brand" href="#top" onClick={closeMenu}>AUTHENTIQ<span>°</span></a><div className={`showroom-nav-links ${menuOpen ? "is-open" : ""}`}>{links.map(([icon, label, href]) => <a key={href} href={href} onClick={closeMenu}><NavIcon name={icon} /><span>{label}</span></a>)}<button className="nav-admin-link" type="button" onClick={() => { setTheme((current) => current === "dark" ? "light" : "dark"); closeMenu(); }}>{theme === "dark" ? "CLARO" : "OSCURO"}</button><button className="nav-admin-link account-launch" type="button" onClick={() => { onAccount(); closeMenu(); }}>{customer ? `CUENTA · ${customer.name.split(" ")[0].toUpperCase()}` : "MI CUENTA"}</button><button className="nav-admin-link nav-backoffice-link" type="button" onClick={() => { onBackoffice(); closeMenu(); }}>BACKOFFICE →</button></div><button className="showroom-nav-toggle" type="button" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}><NavIcon name={menuOpen ? "explore" : "menu"} /></button></nav>;
}

function ShowroomNav({ theme, setTheme, customer, onAccount, onBackoffice, businessName = "AUTHENTIQ", logoUrl = "" }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { const onScroll = () => setScrolled(window.scrollY > 36); onScroll(); window.addEventListener("scroll", onScroll, { passive: true }); return () => window.removeEventListener("scroll", onScroll); }, []);
  const links = [["inventory", "Inventario", "#catalog"], ["brands", "Marcas", "#brands"], ["explore", "Modelos", "#models"], ["compare", "Comparar", "#compare-table"]];
  const closeMenu = () => setMenuOpen(false);
  return <nav className={`top-nav showroom-nav ${scrolled ? "is-scrolled" : ""}`} aria-label="Navegación principal"><a className="brand-mark showroom-nav-brand" href="#top" onClick={closeMenu}>{logoUrl ? <img src={logoUrl} alt={businessName} /> : businessName}<span>°</span></a><div className={`showroom-nav-links ${menuOpen ? "is-open" : ""}`}>{links.map(([icon, label, href]) => <a key={href} href={href} onClick={closeMenu}><NavIcon name={icon} /><span>{label}</span></a>)}<button className="nav-admin-link" type="button" onClick={() => { setTheme((current) => current === "dark" ? "light" : "dark"); closeMenu(); }}>{theme === "dark" ? "CLARO" : "OSCURO"}</button><button className="nav-admin-link account-launch" type="button" onClick={() => { onAccount(); closeMenu(); }}>{customer ? `CUENTA · ${customer.name.split(" ")[0].toUpperCase()}` : "MI CUENTA"}</button><button className="nav-admin-link nav-backoffice-link" type="button" onClick={() => { onBackoffice(); closeMenu(); }}>BACKOFFICE →</button></div><button className="showroom-nav-toggle" type="button" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}><NavIcon name={menuOpen ? "explore" : "menu"} /></button></nav>;
}

function PresentationMode({ vehicles, loading, onExit, onOpenVehicle }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const featured = vehicles.filter((vehicle) => vehicle.status === "published");
  const active = featured[activeIndex] || featured[0];
  if (loading) return <main className="presentation-page"><p className="state-message">Cargando seleccion...</p></main>;
  if (!active) return <main className="presentation-page"><button className="presentation-exit" onClick={onExit}>Salir</button><section className="presentation-empty"><span className="eyebrow">AUTHENTIQ · PRESENTACION</span><h1>No hay vehiculos publicados.</h1></section></main>;
  const image = active.images?.[0]?.url || "/assets/taycan-turbo-s-2.webp";
  return <main className="presentation-page"><header className="presentation-header"><span className="brand-mark">AUTHENTIQ</span><span className="presentation-mode-label">SHOWROOM · PRESENTATION MODE</span><button className="presentation-exit" onClick={onExit}>Salir de presentacion</button></header><section className="presentation-intro"><div><span className="eyebrow">SELECCION PRIVADA · {String(featured.length).padStart(2, "0")} MODELOS</span><h1>Una seleccion que se explica sola.</h1><p>Vehiculos verificados, informacion clara y una experiencia pensada para decidir con confianza.</p></div><div className="presentation-metrics"><span><strong>100%</strong> inventario verificado</span><span><strong>1:1</strong> atencion privada</span></div></section><section className="presentation-stage"><img src={image} alt={`${active.brand} ${active.model}`} /><div className="presentation-stage-overlay" /><div className="presentation-stage-copy"><span className="eyebrow">{active.brand} · {active.year}</span><h2>{active.model}</h2><p>{active.power || "Alto rendimiento"} · {active.transmission || "Especificacion premium"}</p><strong>{formatPrice(active.priceUsd)}</strong><button className="primary-action" onClick={() => onOpenVehicle(active)}>Explorar ficha →</button></div><div className="presentation-stage-index">{String(activeIndex + 1).padStart(2, "0")} / {String(featured.length).padStart(2, "0")}</div></section><section className="presentation-rail"><div className="presentation-rail-head"><span className="eyebrow">CATALOGO DESTACADO</span><span>Selecciona un modelo para cambiar la escena</span></div><div className="presentation-vehicle-list">{featured.map((vehicle, index) => <button className={index === activeIndex ? "presentation-vehicle active" : "presentation-vehicle"} key={vehicle.id} onClick={() => setActiveIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{vehicle.brand} {vehicle.model}</strong><small>{formatPrice(vehicle.priceUsd)}</small></button>)}</div></section></main>;
}

export default function App() {
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
  const [customerActivity, setCustomerActivity] = useState({ offers: [], quotes: [], notifications: [] });
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [previewVehicle] = useState(() => { if (window.location.pathname !== "/preview") return null; try { return JSON.parse(sessionStorage.getItem("authentiq_vehicle_preview") || "null"); } catch { return null; } });
  const [brand, setBrand] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [condition, setCondition] = useState("all");
  const [fuelType, setFuelType] = useState("all");
  const [transmission, setTransmission] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minYear, setMinYear] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [screen, setScreen] = useState("catalog");
  const [posts, setPosts] = useState([]);
  const [businessSettings, setBusinessSettings] = useState({ businessName: "AUTHENTIQ", logoUrl: "", phone: "", whatsapp: "", email: "", address: "", hours: "", instagramUrl: "", facebookUrl: "", privacyText: "", termsText: "" });
  const [theme, setTheme] = useState(() => localStorage.getItem("authentiq_theme") || "light");
  publicBrandName = businessSettings.businessName || "AUTHENTIQ";
  useEffect(() => {
    const brand = businessSettings.businessName || "AUTHENTIQ";
    document.title = document.title.replace(/AUTHENTIQ/g, brand);
  }, [businessSettings.businessName]);

  const customerRequest = async (path, options = {}) => {
    const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}`, ...(options.headers || {}) } });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(payload?.error || "La operación no pudo completarse");
    return payload;
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("authentiq_theme", theme); }, [theme]);
  useEffect(() => { localStorage.setItem("authentiq_favorite_vehicles", JSON.stringify(favoriteIds)); }, [favoriteIds]);
  useEffect(() => { localStorage.setItem("authentiq_recent_vehicles", JSON.stringify(recentVehicleIds)); }, [recentVehicleIds]);
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
    window.history.pushState({}, "", path);
    setPathname(path);
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const refreshVehicles = async () => {
    try {
      const response = await fetch(`${apiUrl}/api/vehicles`, { cache: "no-store" });
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
  useEffect(() => { fetch(`${apiUrl}/api/settings`).then((response) => response.ok ? response.json() : { data: null }).then((payload) => payload.data && setBusinessSettings((current) => ({ ...current, ...payload.data }))).catch(() => {}); }, []);
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
    document.title = activeVehicle ? (activeVehicle.seoTitle || `${activeVehicle.brand} ${activeVehicle.model} · AUTHENTIQ`) : "AUTHENTIQ · Vehículos premium";
    const description = activeVehicle?.seoDescription || activeVehicle?.description || "Una selección precisa de vehículos premium. Cada modelo, verificado.";
    const title = activeVehicle ? `${activeVehicle.brand} ${activeVehicle.model} · AUTHENTIQ` : "AUTHENTIQ · Conducir es elegir";
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
    setCanonical(window.location.href.split("#")[0]);
    // Los vehículos en borrador o la vista previa nunca deben indexarse.
    setRobots(pathname !== "/preview" && (!activeVehicle || ["published", "reserved"].includes(activeVehicle.status)));
    if (!loading) trackEvent(activeVehicle ? "vehicle_view" : "catalog_view", { vehicleId: activeVehicle?.id || null });
  }, [activeVehicle?.id, pathname, loading]);

  const brands = useMemo(() => [...new Set(vehicles.map((vehicle) => vehicle.brand))].sort(), [vehicles]);
  const recentVehicles = useMemo(() => [...vehicles].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0)), [vehicles]);
  const recentlyViewedVehicles = useMemo(() => recentVehicleIds.map((id) => vehicles.find((vehicle) => vehicle.id === id)).filter(Boolean), [recentVehicleIds, vehicles]);
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
      const response = await fetch(`${apiUrl}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: accountForm.name, email: accountForm.email, phone: accountForm.phone, password: accountForm.password }) });
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
  const logoutCustomer = () => { localStorage.removeItem("authentiq_customer_token"); localStorage.removeItem("authentiq_customer_user"); setCustomerToken(""); setCustomer(null); setCustomerActivity({ offers: [], quotes: [], notifications: [] }); setAccountStatus({ loading: false, error: "" }); };
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

  if (screen === "admin") return <Suspense fallback={<main className="admin-page"><p className="state-message">Cargando backoffice…</p></main>}><Backoffice onBack={() => { setScreen("catalog"); refreshVehicles(); }} onVehiclesChanged={syncCatalogVehicle} /></Suspense>;
  if (pathname === "/presentacion") return <PresentationMode vehicles={vehicles} loading={loading} onExit={() => navigate("/")} onOpenVehicle={(vehicle) => navigate(vehiclePath(vehicle))} />;
  if (pathname.startsWith("/cotizaciones/") && pathname.slice("/cotizaciones/".length)) return <PublicQuotePage token={pathname.slice("/cotizaciones/".length)} />;
  if (pathname === "/preview") return previewVehicle ? <VehicleDetail vehicle={{ ...previewVehicle, status: "draft" }} onBack={() => navigate("/")} /> : <main className="article-page"><button className="back-button" onClick={() => navigate("/")}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">AUTHENTIQ · PREVIEW</span><h1>No hay una ficha para previsualizar.</h1><p>Regresa al backoffice, completa el formulario y vuelve a abrir la vista previa.</p></section></main>;
  if (pathname.startsWith("/blog/")) return <BlogArticle slug={pathname.slice("/blog/".length)} onBack={() => navigate("/")} />;
  if (pathname.startsWith("/vehiculos/") && loading) return <main className="article-page"><p className="state-message">Cargando vehículo…</p></main>;
  if (pathname.startsWith("/vehiculos/") && !routeVehicle) return <main className="article-page"><button className="back-button" onClick={() => navigate("/")}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">AUTHENTIQ · INVENTARIO</span><h1>Este vehículo no está disponible.</h1><p>Puede haber sido vendido, archivado o la dirección puede haber cambiado.</p></section></main>;
  if (["contact", "location", "privacy", "terms"].includes(screen)) return <InstitutionalPage type={screen} settings={businessSettings} onBack={() => setScreen("catalog")} />;
  if (activeVehicle) return <VehicleDetail vehicle={activeVehicle} vehicles={vehicles} onBack={() => navigate("/")} isFavorite={favoriteIds.includes(activeVehicle.id)} onToggleFavorite={toggleFavorite} customerToken={customerToken} compareVehicles={compareVehicles} favoriteIds={favoriteIds} onOpenVehicle={(vehicle) => navigate(vehiclePath(vehicle))} onToggleCompare={toggleCompare} />;

  const heroVideoUrl = String(import.meta.env.VITE_HERO_VIDEO_URL || "").trim();
  return (
    <main id="top">
      <ShowroomNav theme={theme} setTheme={setTheme} customer={customer} businessName={businessSettings.businessName} logoUrl={businessSettings.logoUrl} onAccount={() => { setAccountOpen(true); setAccountStatus({ loading: false, error: "" }); }} onBackoffice={() => setScreen("admin")} />
      <section className="hero">
        {heroVideoUrl ? <video className="hero-background hero-video" autoPlay muted loop playsInline preload="metadata" poster="/assets/authentiq-hero-v1.webp" aria-label="Vehículo premium en movimiento"><source src={heroVideoUrl} /></video> : <img src="/assets/authentiq-hero-v1.webp" alt="Coupé premium AUTHENTIQ recorriendo una carretera costera" className="hero-background" loading="eager" fetchPriority="high" decoding="async" />}
        <div className="hero-overlay" />
        <div className="hero-content">
          <span className="eyebrow">{getBrandName()} / CURATED MOTION</span>
          <h1>Elige lo que <em>te mueve.</em></h1>
          <p>Vehículos con carácter, información clara y una atención diseñada alrededor de tu próxima historia.</p>
          <a href="#catalog" className="hero-link primary-action hero-primary-action">Explorar inventario ↓</a>
        </div>
        <div className="hero-proof" aria-label={`Pilares de ${getBrandName()}`}><span><strong><AnimatedMetric value={1} suffix="" /></strong> selección con criterio</span><span><strong><AnimatedMetric value={100} suffix="%" /></strong> inventario verificado</span><span><strong><AnimatedMetric value={1} suffix=":1" /></strong> atención privada</span></div>
        <a className="hero-scroll-cue" href="#catalog" aria-label="Bajar al catalogo"><span /> SCROLL</a>
      </section>
      <Reveal className="showroom-signal"><div className="showroom-signal-inner"><span className="showroom-signal-label">AUTHENTIQ / PRIVATE SELECTION</span><p>No llenamos el catalogo. Seleccionamos lo que merece ser conducido.</p><a href="#catalog">Entrar a la seleccion <span>→</span></a></div></Reveal>
      <IntentRail categories={categories} conditions={conditions} fuelTypes={fuelTypes} onChoose={chooseIntent} />
      <CompareDock vehicles={compareVehicles} onRemove={(id) => setCompareVehicles((current) => current.filter((item) => item.id !== id))} onClear={() => setCompareVehicles([])} />

      <section className="catalog" id="catalog" aria-busy={loading}>
        <div className="section-head"><div><span className="eyebrow">INVENTARIO · {vehicles.length.toString().padStart(2, "0")} MODELOS</span><h2>Catálogo activo.</h2></div><p>Inventario actualizado para ayudarte a decidir mejor.</p></div>
         <div className="catalog-intro-note">Una seleccion breve, pensada para decidir mejor.</div>
         <div className="filters-heading"><div><span className="eyebrow">BUSQUEDA AVANZADA</span><strong>Filtra por lo que importa.</strong></div><span>Marca, precio, año y especificaciones</span><button className="filters-toggle" type="button" onClick={() => setFiltersOpen((current) => !current)} aria-expanded={filtersOpen}>{filtersOpen ? "Ocultar filtros" : "Más filtros"} <span>{filtersOpen ? "↑" : "↓"}</span></button></div>
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
         <div className="catalog-toolbar"><span>{loading ? "Consultando inventario" : <><AnimatedMetric value={filteredVehicles.length} /> de <AnimatedMetric value={vehicles.length} /> vehiculos visibles</>}</span><span className="catalog-toolbar-line" /><span>Desliza para explorar</span><button className={`favorites-filter ${favoritesOnly ? "is-active" : ""}`} type="button" onClick={() => setFavoritesOnly((current) => !current)} aria-pressed={favoritesOnly}>♡ Favoritos {favoriteIds.length ? <>· <AnimatedMetric value={favoriteIds.length} /></> : ""}</button></div>
        {loading && <CatalogSkeleton />}
        {error && <CatalogError message={`${error}. Verifica que la API esté corriendo en el puerto 3001.`} onRetry={() => { setLoading(true); refreshVehicles(); }} />}
        {!loading && !error && (filteredVehicles.length ? <div className="vehicle-grid"><AnimatePresence mode="popLayout" initial={false}>{filteredVehicles.map((vehicle, index) => <VehicleCard key={vehicle.id} vehicle={vehicle} isCompared={compareVehicles.some((item) => item.id === vehicle.id)} isFavorite={favoriteIds.includes(vehicle.id)} onToggleFavorite={toggleFavorite} onToggleCompare={toggleCompare} onOpen={(item) => navigate(vehiclePath(item))} imageLoading={index < 6 ? "eager" : "lazy"} />)}</AnimatePresence></div> : <div className="catalog-empty"><h3>No encontramos vehículos con esos criterios.</h3><p>Prueba limpiando la búsqueda o seleccionando otros filtros.</p><button className="secondary-action" onClick={clearFilters}>Limpiar filtros</button></div>)}
        <ShowroomTrustRail />
        <RecentlyViewed vehicles={recentlyViewedVehicles} compareVehicles={compareVehicles} favoriteIds={favoriteIds} onOpen={(vehicle) => navigate(vehiclePath(vehicle))} onToggleCompare={toggleCompare} onToggleFavorite={toggleFavorite} />
        <RecentSelection vehicles={recentVehicles} compareVehicles={compareVehicles} favoriteIds={favoriteIds} onOpen={(vehicle) => navigate(vehiclePath(vehicle))} onToggleCompare={toggleCompare} onToggleFavorite={toggleFavorite} />
        <FinancingSpotlight vehicles={vehicles} onExplore={() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
        <BrandRail vehicles={vehicles} brands={brands} onChooseBrand={chooseBrand} />
        <ModelLineRail vehicles={vehicles} selectedBrand={brand} onChooseLine={chooseModelLine} />

        <CompareTable vehicles={compareVehicles} />
        <ContactForm />
        <BlogSection posts={posts} />
        <footer className="site-footer">
          {(businessSettings.phone || businessSettings.whatsapp || businessSettings.email || businessSettings.instagramUrl || businessSettings.facebookUrl) && <div className="site-footer-contact">{businessSettings.phone && <a href={`tel:${businessSettings.phone}`}>{businessSettings.phone}</a>}{businessSettings.whatsapp && <a href={`https://wa.me/${businessSettings.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>}{businessSettings.email && <a href={`mailto:${businessSettings.email}`}>{businessSettings.email}</a>}{businessSettings.instagramUrl && <a href={businessSettings.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a>}{businessSettings.facebookUrl && <a href={businessSettings.facebookUrl} target="_blank" rel="noreferrer">Facebook ↗</a>}</div>}
          <div><span className="brand-mark">{businessSettings.businessName || "AUTHENTIQ"}</span><p>Vehículos premium · inventario verificado.</p></div>
          <nav aria-label="Enlaces institucionales">
            <button onClick={() => setScreen("contact")}>Contacto</button>
            <button onClick={() => setScreen("location")}>Ubicación</button>
            <button onClick={() => setScreen("privacy")}>Privacidad</button>
            <button onClick={() => setScreen("terms")}>Términos</button>
          </nav>
        </footer>
      </section>
      <AnimatePresence>{accountOpen && <CustomerAccountModal customer={customer} form={accountForm} mode={accountMode} status={accountStatus} favoriteCount={favoriteIds.length} activity={customerActivity} onChange={changeAccountForm} onSubmit={submitAccount} onMode={(mode) => { setAccountMode(mode); setAccountStatus({ loading: false, error: "" }); }} onClose={() => setAccountOpen(false)} onLogout={logoutCustomer} onReadNotifications={markCustomerNotificationsRead} />}</AnimatePresence>
    </main>
  );
}

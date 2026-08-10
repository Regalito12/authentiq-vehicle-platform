import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";

class SectionBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error(`[AUTHENTIQ] Fallo en la sección "${this.props.name || "desconocida"}"`, error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;
    return <section className="section-fallback" role="status"><span className="eyebrow">AUTHENTIQ</span><p>{this.props.message || "Esta sección no pudo mostrarse. El resto de la página sigue disponible."}</p></section>;
  }
}

const Backoffice = lazy(() => import("./admin/Backoffice.jsx"));

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";

const analyticsSessionId = (() => { const key = "authentiq_analytics_session"; const current = localStorage.getItem(key); if (current) return current; const next = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(key, next); return next; })();
function trackEvent(eventName, payload = {}) { fetch(`${apiUrl}/api/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventName, path: window.location.pathname, sessionId: analyticsSessionId, ...payload }) }).catch(() => {}); }

function formatPrice(value) {
  return `$${Number(value).toLocaleString("en-US")} USD`;
}

function Reveal({ children, className = "" }) {
  const ref = useRef(null);
  const visible = useInView(ref, { once: true, amount: 0.12 });
  return <motion.div ref={ref} className={className} initial={{ opacity: 1, y: 14 }} animate={visible ? { opacity: 1, y: 0 } : { opacity: 1, y: 14 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>;
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
  const share = async (event) => { event.stopPropagation(); const url = `${window.location.origin}${vehiclePath(vehicle)}`; try { if (navigator.share) await navigator.share({ title: `${vehicle.brand} ${vehicle.model}`, text: `Mira este ${vehicle.brand} ${vehicle.model} en AUTHENTIQ`, url }); else { await navigator.clipboard.writeText(url); setShared(true); window.setTimeout(() => setShared(false), 1600); } trackEvent("vehicle_share", { vehicleId: vehicle.id }); } catch { setShared(false); } };
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
  return <motion.div className="quote-overlay" role="dialog" aria-modal="true" aria-label="Cotización del vehículo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><section className="quote-modal"><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar cotización">×</button><div className="quote-brand">AUTHENTIQ <span>COTIZACIÓN DE VEHÍCULO</span></div><div className="quote-heading"><span className="eyebrow">PROPUESTA COMERCIAL</span><h2>{vehicle.brand} <em>{vehicle.model}</em></h2><p>{vehicle.year} · {vehicle.condition === "new" ? "Nuevo" : "Certificado"}</p></div><div className="quote-price"><span>Precio de lista</span><strong>{formatPrice(vehicle.priceUsd)}</strong></div><div className="quote-specs"><span>Motor <b>{vehicle.engine || "—"}</b></span><span>Potencia <b>{vehicle.power || "—"}</b></span><span>Transmisión <b>{vehicle.transmission || "—"}</b></span></div><p className="quote-note">Esta cotización es informativa y está sujeta a disponibilidad, inspección y aprobación comercial.</p><div className="quote-actions"><button className="primary-action" type="button" onClick={() => window.print()}>Imprimir / guardar PDF</button><button className="secondary-action" type="button" onClick={onClose}>Cerrar</button></div></section></motion.div>;
}

function Vehicle3DViewer({ vehicle, media }) {
  const viewerRef = useRef(null);
  const [state, setState] = useState("loading");
  const model = media.find((item) => item.type === "model_3d");
  // "procedural://" fue un marcador de una versión anterior; nunca representa un archivo real.
  const isProcedural = model?.url?.startsWith("procedural://");
  useEffect(() => {
    if (!model || isProcedural) return undefined;
    let cleanup = () => {};
    let cancelled = false;
    setState("loading");
    import("@google/model-viewer").then(() => {
      if (cancelled) return;
      const viewer = viewerRef.current;
      if (!viewer) return;
      const handleLoad = () => setState("ready");
      const handleError = () => setState("error");
      // El elemento puede haber terminado de cargar antes de que se registren los listeners.
      if (viewer.loaded) { setState("ready"); return; }
      viewer.addEventListener("load", handleLoad);
      viewer.addEventListener("error", handleError);
      cleanup = () => { viewer.removeEventListener("load", handleLoad); viewer.removeEventListener("error", handleError); };
    }).catch(() => setState("error"));
    // Si el archivo nunca responde, no dejamos al comprador en "cargando" para siempre.
    const timeout = window.setTimeout(() => setState((current) => current === "loading" ? "error" : current), 30000);
    return () => { cancelled = true; window.clearTimeout(timeout); cleanup(); };
  }, [model?.url, isProcedural]);
  if (!model || isProcedural) return null;
  return <section id="vehicle-3d-viewer" className="vehicle-3d-viewer" aria-label={`Modelo 3D de ${vehicle.brand} ${vehicle.model}`}>
    <div className="vehicle-studio-heading"><div><span className="eyebrow">AUTHENTIQ / REAL 3D</span><h2>Explóralo en detalle.</h2></div><span className="vehicle-3d-status">{state === "ready" ? "MODELO LISTO" : state === "error" ? "NO DISPONIBLE" : "CARGANDO MODELO"}</span></div>
    <div className="vehicle-3d-stage">
      <div className="vehicle-3d-backdrop" />
      <model-viewer ref={viewerRef} src={model.url} poster={model.posterUrl || vehicle.images?.[0]?.url} alt={model.altText || `${vehicle.brand} ${vehicle.model}, modelo 3D`} camera-controls auto-rotate shadow-intensity="1" exposure="1" loading="eager" reveal="auto" ar ar-modes="webxr scene-viewer quick-look" />
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const render = () => {
        frame = requestAnimationFrame(render);
        if (!dragging && !reducedMotion) longitude += 0.03; // deriva lenta mientras nadie interactúa
        const phi = THREE.MathUtils.degToRad(90 - latitude);
        const theta = THREE.MathUtils.degToRad(longitude);
        camera.lookAt(new THREE.Vector3(
          50 * Math.sin(phi) * Math.cos(theta),
          50 * Math.cos(phi),
          50 * Math.sin(phi) * Math.sin(theta),
        ));
        renderer.render(scene, camera);
      };
      render();

      cleanup = () => {
        cancelAnimationFrame(frame);
        container.removeEventListener("pointerdown", onDown);
        container.removeEventListener("pointermove", onMove);
        container.removeEventListener("pointerup", onUp);
        container.removeEventListener("pointercancel", onUp);
        container.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", onResize);
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
  const dragStart = useRef(0);
  const image = images[activeFrame]?.url || images[0]?.url;
  const frameCount = images.length;
  const changeFrame = (direction) => setActiveFrame((current) => (current + direction + frameCount) % frameCount);
  const handleMove = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    setTilt({ x: (0.5 - y / bounds.height) * 8, y: (x / bounds.width - 0.5) * 12 });
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
      <motion.div className="vehicle-studio-object" animate={{ rotateX: tilt.x, rotateY: tilt.y }} transition={{ type: "spring", stiffness: 170, damping: 22 }}>
        <div className="vehicle-studio-image-frame"><AnimatePresence mode="wait" initial={false}><motion.img key={image} src={image} alt={`${vehicle.brand} ${vehicle.model}, vista de estudio`} initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: .24 }} /></AnimatePresence></div>
        <div className="vehicle-studio-reflection" />
      </motion.div>
      <span className="vehicle-studio-hint">{frameCount > 1 ? "Arrastra para explorar" : "Mueve el cursor para explorar"}</span>
    </div>
    <div className="vehicle-studio-controls"><button className="icon-action" type="button" onClick={() => changeFrame(-1)} aria-label="Vista anterior">←</button><div className="vehicle-studio-frames">{images.map((item, index) => <button key={item.id || item.url} className={index === activeFrame ? "vehicle-studio-frame active" : "vehicle-studio-frame"} type="button" onClick={() => setActiveFrame(index)} aria-label={`Vista ${index + 1}`}><img src={item.url} alt="" /></button>)}</div><button className="icon-action" type="button" onClick={() => changeFrame(1)} aria-label="Vista siguiente">→</button></div>
    </section>
  </>;
}

function VehicleCard({ vehicle, onOpen, onToggleCompare, isCompared, isFavorite, onToggleFavorite }) {
  const image = vehicle.images?.[0]?.url || "/assets/hero-highway.jpg";
  // La vista de ficha se registra al cambiar de ruta (cubre también los enlaces directos),
  // así que aquí no se emite un segundo vehicle_view para no duplicar la métrica.
  const open = () => onOpen(vehicle);

  return (
    <motion.article
      className="vehicle-card"
      layout
      exit={{ opacity: 0, scale: .98 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div className="vehicle-image-wrap">
        <button className="vehicle-card-image-button" type="button" onClick={open} aria-label={`Abrir ficha de ${vehicle.brand} ${vehicle.model}`}>
          <img src={image} alt={`${vehicle.brand} ${vehicle.model}`} className="vehicle-image" loading="lazy" />
          <span className={`vehicle-tag ${vehicle.status === "reserved" ? "reserved" : vehicle.condition}`}>
            {vehicle.status === "reserved" ? "RESERVADO" : vehicle.condition === "new" ? "NUEVO" : "CERTIFICADO"}
          </span>
        </button>
        <button className={`favorite-toggle ${isFavorite ? "is-selected" : ""}`} type="button" aria-label={isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"} onClick={() => onToggleFavorite(vehicle)}>{isFavorite ? "♥" : "♡"}</button>
        <button className={`compare-toggle ${isCompared ? "is-selected" : ""}`} type="button" role="checkbox" aria-checked={isCompared} onClick={() => onToggleCompare(vehicle)}>{isCompared ? "Comparando ✓" : "Comparar"}</button>
      </div>
      <button className="vehicle-card-body vehicle-card-open" type="button" onClick={open}>
        <div>
          <h3>{vehicle.brand} {vehicle.model}</h3>
          <span className="vehicle-meta">{vehicle.year} · {vehicle.variant || vehicle.fuelType || vehicle.power || "—"}</span>
        </div>
        <strong>{formatPrice(vehicle.priceUsd)}</strong>
        <span className="vehicle-card-cta">Abrir ficha <span>↗</span></span>
      </button>
    </motion.article>
  );
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
  return <section className="contact-section" id="contact"><div><span className="eyebrow">CONTACTO DIRECTO</span><h2>Hablemos de tu próximo vehículo.</h2><p>Déjanos tus datos y un asesor de AUTHENTIQ se pondrá en contacto contigo.</p></div><form className="contact-form" onSubmit={submit}><label>Nombre<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><div className="lead-form-grid"><label>Correo<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Teléfono<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label></div><label>Mensaje<textarea value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} required /></label><label className="consent-check"><input type="checkbox" checked={form.privacyConsent} onChange={(event) => setForm({ ...form, privacyConsent: event.target.checked })} required /><span>Acepto la politica de privacidad y autorizo el uso de mis datos para responder este mensaje.</span></label>{status.success && <p className="form-message success-message">Mensaje recibido. Te contactaremos pronto.</p>}{status.error && <p className="state-message error">{status.error}</p>}<button className="primary-action" type="submit" disabled={status.loading}>{status.loading ? "Enviando..." : "Enviar mensaje"}</button></form></section>;
}

function BlogSection({ posts }) {
  if (!posts.length) return null;
  return <section className="blog-public" id="journal"><div className="section-head"><div><span className="eyebrow">JOURNAL · AUTHENTIQ</span><h2>Ideas para conducir mejor.</h2></div><p>Guías, historias y cultura automotriz.</p></div><div className="blog-public-grid">{posts.map((post) => <article className="blog-public-card" key={post.id}>{post.coverImageUrl && <img src={post.coverImageUrl} alt="" />}{!post.coverImageUrl && <div className="blog-public-placeholder" />}<div><span className="eyebrow">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" }) : "AUTHENTIQ"}</span><h3>{post.title}</h3>{post.category && <span className="blog-category">{post.category}</span>}{post.tags?.length > 0 && <small className="blog-tags">{post.tags.join(" · ")}</small>}<p>{post.summary}</p><a href={`/blog/${post.slug}`}>Leer artículo →</a></div></article>)}</div></section>;
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
    const image = post.coverImageUrl || "/assets/hero-highway.jpg";
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

function VehicleDetail({ vehicle, onBack, isFavorite = false, onToggleFavorite = () => {}, customerToken = "" }) {
  const [activeImage, setActiveImage] = useState(0);
  const [leadType, setLeadType] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const images = vehicle.images?.length ? vehicle.images : [{ url: "/assets/hero-highway.jpg" }];
  const image = images[activeImage]?.url || images[0].url;
  const structuredData = JSON.stringify({ "@context": "https://schema.org", "@type": "Vehicle", name: `${vehicle.brand} ${vehicle.model}`, model: vehicle.model, vehicleConfiguration: vehicle.variant || undefined, fuelType: vehicle.fuelType || undefined, color: vehicle.exteriorColor || undefined, brand: { "@type": "Brand", name: vehicle.brand }, vehicleModelDate: String(vehicle.year), image: images.map((item) => new URL(item.url, window.location.origin).href), mileageFromOdometer: { "@type": "QuantitativeValue", value: Number(vehicle.mileageKm), unitCode: "KMT" }, offers: { "@type": "Offer", priceCurrency: "USD", price: Number(vehicle.priceUsd), availability: vehicle.status === "published" ? "https://schema.org/InStock" : "https://schema.org/LimitedAvailability" } }).replace(/</g, "\\u003c");

  return (
    <motion.main
      className="detail-page"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <button className="back-button" onClick={onBack}>← Volver al catálogo</button>
      <section className="detail-grid">
        <div>
          <div className="detail-image-wrap" role="button" tabIndex="0" aria-label="Ampliar imagen" onClick={() => setLightboxOpen(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setLightboxOpen(true); }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={image}
                src={image}
                alt={`${vehicle.brand} ${vehicle.model}`}
                className="detail-image"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              />
            </AnimatePresence>
          </div>
          <div className="thumbs">
            {images.map((item, index) => (
              <button key={item.id || item.url} className={index === activeImage ? "thumb active" : "thumb"} onClick={() => setActiveImage(index)}>
                <img src={item.url} alt="" />
              </button>
            ))}
          </div>
        </div>
        <div className="detail-copy">
          <span className="eyebrow">{vehicle.condition === "new" ? "NUEVO INVENTARIO" : "INVENTARIO CERTIFICADO"}</span>
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
          <button className="detail-utility-action studio-jump" type="button" onClick={() => document.getElementById(vehicle.media?.some((item) => item.type === "model_3d") ? "vehicle-3d-viewer" : "vehicle-studio")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{vehicle.media?.some((item) => item.type === "model_3d") ? "Explorar modelo 3D ↓" : "Explorar Studio ↓"}</button>
          <div className="detail-actions">
            <button className="primary-action" type="button" onClick={() => setLeadType("offer")} disabled={vehicle.status === "reserved"}>{vehicle.status === "reserved" ? "Vehículo reservado" : "Hacer una oferta"}</button>
            <button className="secondary-action" type="button" onClick={() => setQuoteOpen(true)}>Generar cotización PDF</button>
          </div>
          <div className="detail-utilities"><ShareAction vehicle={vehicle} /><button className={`detail-utility-action favorite-detail-action ${isFavorite ? "is-selected" : ""}`} type="button" onClick={() => onToggleFavorite(vehicle)}>{isFavorite ? "Guardado en favoritos ♥" : "Guardar en favoritos ♡"}</button><a className="detail-utility-action" href={`https://wa.me/?text=${encodeURIComponent(`Mira este ${vehicle.brand} ${vehicle.model} en AUTHENTIQ: ${window.location.origin}${vehiclePath(vehicle)}`)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp ↗</a></div>
          {vehicle.description && <div className="detail-description"><span className="eyebrow">SOBRE ESTE VEHÍCULO</span><p>{vehicle.description}</p></div>}
          {!!vehicle.features?.length && <div className="detail-features"><span className="eyebrow">EQUIPAMIENTO DESTACADO</span><div>{vehicle.features.map((feature) => <span key={feature}>{feature}</span>)}</div></div>}
          <p className="phase-note">Las solicitudes se guardan y aparecen en el backoffice para revisión.</p>
        </div>
      </section>
      <SectionBoundary name="estudio visual" message="El visor multimedia no pudo mostrarse. Los datos y la galería del vehículo siguen disponibles."><VehicleStudio vehicle={vehicle} images={images} /></SectionBoundary>
      <DetailTrustStrip />
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
      <AnimatePresence>{leadType && <LeadForm vehicle={vehicle} customerToken={customerToken} onClose={() => setLeadType(null)} />}</AnimatePresence>
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
  const configuredSections = type === "location" ? [["Showroom", settings.address || "La direccion del showroom sera publicada cuando el negocio confirme esos datos."], ["Horario", settings.hours || "Horario pendiente de confirmacion."]] : type === "privacy" ? [["Politica vigente", settings.privacyText || content.sections[0][1]]] : type === "terms" ? [["Terminos vigentes", settings.termsText || content.sections[0][1]]] : content.sections;
  return <motion.main className="institutional-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .24, ease: "easeOut" }}>
    <button className="back-button" onClick={onBack}>← Volver al catálogo</button>
    <section className="institutional-hero"><span className="eyebrow">{content.eyebrow}</span><h1>{content.title}</h1><p>{content.intro}</p></section>
    <section className="institutional-sections">{configuredSections.map(([heading, text]) => <article key={heading}><span className="eyebrow">{heading}</span><p>{text}</p></article>)}</section>
  </motion.main>;
}

function CompareDock({ vehicles, onRemove, onClear }) {
  if (!vehicles.length) return null;
  return <aside className="compare-dock" aria-label="Comparador de vehículos"><div className="compare-dock-head"><div><span className="eyebrow">SELECCIÓN INTELIGENTE</span><strong>Comparar vehículos <small>{vehicles.length}/3</small></strong></div><button className="text-button" type="button" onClick={onClear}>Limpiar</button></div><div className="compare-grid">{vehicles.map((vehicle) => <article key={vehicle.id} className="compare-item"><button type="button" className="compare-remove" onClick={() => onRemove(vehicle.id)} aria-label={`Quitar ${vehicle.model}`}>×</button><img src={vehicle.images?.[0]?.url || "/assets/hero-highway.jpg"} alt="" /><strong>{vehicle.brand} {vehicle.model}</strong><span>{formatPrice(vehicle.priceUsd)}</span></article>)}</div><div className="compare-summary"><span>{vehicles.length > 1 ? "Revisa precio, potencia y kilometraje de tus favoritos." : "Añade un modelo más para activar la comparación."}</span>{vehicles.length > 1 ? <a href="#compare-table">Ver comparación ↓</a> : <a href="#catalog">Seguir explorando ↓</a>}</div></aside>;
}

function CompareTable({ vehicles }) {
  if (vehicles.length < 2) return <section className="compare-table-section compare-table-empty" id="compare-table"><div className="compare-empty-mark">{vehicles.length ? "01" : "00"}</div><div><span className="eyebrow">COMPARACIÓN / {vehicles.length}/2 MÍNIMO</span><h2>{vehicles.length ? "Elige un modelo más." : "Compara antes de decidir."}</h2><p>{vehicles.length ? "Ya tienes un vehículo seleccionado. Añade otro desde cualquier tarjeta para ver precio, potencia, kilometraje y ficha técnica en paralelo." : "Selecciona hasta tres vehículos y revisa sus diferencias en una sola vista, sin perder tu selección."}</p><a className="detail-utility-action" href="#catalog">Explorar inventario ↓</a></div></section>;
  const rows = [["Precio", (vehicle) => formatPrice(vehicle.priceUsd)], ["Año", (vehicle) => vehicle.year], ["Versión", (vehicle) => vehicle.variant || "—"], ["Combustible", (vehicle) => vehicle.fuelType || "—"], ["Transmisión", (vehicle) => vehicle.transmission || "—"], ["Potencia", (vehicle) => vehicle.power || "—"], ["Kilometraje", (vehicle) => `${Number(vehicle.mileageKm || 0).toLocaleString("en-US")} km`], ["Tracción", (vehicle) => vehicle.drive || "—"], ["Ubicación", (vehicle) => vehicle.location || "—"]];
  return <section className="compare-table-section" id="compare-table"><div className="section-head"><div><span className="eyebrow">COMPARACIÓN</span><h2>Decide con claridad.</h2></div><p>{vehicles.length} vehículos seleccionados</p></div><div className="compare-table" style={{ "--compare-columns": vehicles.length }}><div className="compare-table-labels"><span>Modelo</span>{rows.map(([label]) => <span key={label}>{label}</span>)}</div>{vehicles.map((vehicle) => <div className="compare-column" key={vehicle.id}><strong>{vehicle.brand} {vehicle.model}</strong>{rows.map(([_label, value]) => <span key={_label}>{value(vehicle)}</span>)}</div>)}</div></section>;
}


function PresentationMode({ vehicles, loading, onExit, onOpenVehicle }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const featured = vehicles.filter((vehicle) => vehicle.status === "published");
  const active = featured[activeIndex] || featured[0];
  if (loading) return <main className="presentation-page"><p className="state-message">Cargando seleccion...</p></main>;
  if (!active) return <main className="presentation-page"><button className="presentation-exit" onClick={onExit}>Salir</button><section className="presentation-empty"><span className="eyebrow">AUTHENTIQ · PRESENTACION</span><h1>No hay vehiculos publicados.</h1></section></main>;
  const image = active.images?.[0]?.url || "/assets/taycan-turbo-s-2.jpg";
  return <main className="presentation-page"><header className="presentation-header"><span className="brand-mark">AUTHENTIQ</span><span className="presentation-mode-label">SHOWROOM · PRESENTATION MODE</span><button className="presentation-exit" onClick={onExit}>Salir de presentacion</button></header><section className="presentation-intro"><div><span className="eyebrow">SELECCION PRIVADA · {String(featured.length).padStart(2, "0")} MODELOS</span><h1>Una seleccion que se explica sola.</h1><p>Vehiculos verificados, informacion clara y una experiencia pensada para decidir con confianza.</p></div><div className="presentation-metrics"><span><strong>100%</strong> inventario verificado</span><span><strong>1:1</strong> atencion privada</span></div></section><section className="presentation-stage"><img src={image} alt={`${active.brand} ${active.model}`} /><div className="presentation-stage-overlay" /><div className="presentation-stage-copy"><span className="eyebrow">{active.brand} · {active.year}</span><h2>{active.model}</h2><p>{active.power || "Alto rendimiento"} · {active.transmission || "Especificacion premium"}</p><strong>{formatPrice(active.priceUsd)}</strong><button className="primary-action" onClick={() => onOpenVehicle(active)}>Explorar ficha →</button></div><div className="presentation-stage-index">{String(activeIndex + 1).padStart(2, "0")} / {String(featured.length).padStart(2, "0")}</div></section><section className="presentation-rail"><div className="presentation-rail-head"><span className="eyebrow">CATALOGO DESTACADO</span><span>Selecciona un modelo para cambiar la escena</span></div><div className="presentation-vehicle-list">{featured.map((vehicle, index) => <button className={index === activeIndex ? "presentation-vehicle active" : "presentation-vehicle"} key={vehicle.id} onClick={() => setActiveIndex(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{vehicle.brand} {vehicle.model}</strong><small>{formatPrice(vehicle.priceUsd)}</small></button>)}</div></section></main>;
}

export default function App() {
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [compareVehicles, setCompareVehicles] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(() => { try { return JSON.parse(localStorage.getItem("authentiq_favorite_vehicles") || "[]"); } catch { return []; } });
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
  const [businessSettings, setBusinessSettings] = useState({ businessName: "AUTHENTIQ", phone: "", whatsapp: "", email: "", address: "", hours: "", instagramUrl: "", facebookUrl: "", privacyText: "", termsText: "" });
  const [theme, setTheme] = useState(() => localStorage.getItem("authentiq_theme") || "light");

  const customerRequest = async (path, options = {}) => {
    const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}`, ...(options.headers || {}) } });
    const payload = response.status === 204 ? null : await response.json();
    if (!response.ok) throw new Error(payload?.error || "La operación no pudo completarse");
    return payload;
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("authentiq_theme", theme); }, [theme]);
  useEffect(() => { localStorage.setItem("authentiq_favorite_vehicles", JSON.stringify(favoriteIds)); }, [favoriteIds]);
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
      const response = await fetch(`${apiUrl}/api/vehicles`);
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
    // Los artículos del blog publican sus propios metadatos (BlogArticle). Los efectos del
    // hijo corren antes que los del padre, así que aquí hay que apartarse o los pisaríamos.
    if (pathname.startsWith("/blog/")) return;
    document.title = activeVehicle ? (activeVehicle.seoTitle || `${activeVehicle.brand} ${activeVehicle.model} · AUTHENTIQ`) : "AUTHENTIQ · Vehículos premium";
    const description = activeVehicle?.seoDescription || activeVehicle?.description || "Una selección precisa de vehículos premium. Cada modelo, verificado.";
    const title = activeVehicle ? `${activeVehicle.brand} ${activeVehicle.model} · AUTHENTIQ` : "AUTHENTIQ · Conducir es elegir";
    const image = activeVehicle?.images?.[0]?.url || "/assets/hero-highway.jpg";
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
  if (pathname === "/preview") return previewVehicle ? <VehicleDetail vehicle={{ ...previewVehicle, status: "draft" }} onBack={() => navigate("/")} /> : <main className="article-page"><button className="back-button" onClick={() => navigate("/")}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">AUTHENTIQ · PREVIEW</span><h1>No hay una ficha para previsualizar.</h1><p>Regresa al backoffice, completa el formulario y vuelve a abrir la vista previa.</p></section></main>;
  if (pathname.startsWith("/blog/")) return <BlogArticle slug={pathname.slice("/blog/".length)} onBack={() => navigate("/")} />;
  if (pathname.startsWith("/vehiculos/") && loading) return <main className="article-page"><p className="state-message">Cargando vehículo…</p></main>;
  if (pathname.startsWith("/vehiculos/") && !routeVehicle) return <main className="article-page"><button className="back-button" onClick={() => navigate("/")}>← Volver al catálogo</button><section className="article-empty"><span className="eyebrow">AUTHENTIQ · INVENTARIO</span><h1>Este vehículo no está disponible.</h1><p>Puede haber sido vendido, archivado o la dirección puede haber cambiado.</p></section></main>;
  if (["contact", "location", "privacy", "terms"].includes(screen)) return <InstitutionalPage type={screen} settings={businessSettings} onBack={() => setScreen("catalog")} />;
  if (activeVehicle) return <VehicleDetail vehicle={activeVehicle} onBack={() => navigate("/")} isFavorite={favoriteIds.includes(activeVehicle.id)} onToggleFavorite={toggleFavorite} customerToken={customerToken} />;

  const heroVideoUrl = String(import.meta.env.VITE_HERO_VIDEO_URL || "").trim();
  return (
    <main>
      <section className="hero">
        {heroVideoUrl ? <video className="hero-background hero-video" autoPlay muted loop playsInline preload="metadata" poster="/assets/authentiq-hero-v1.png" aria-label="Vehículo premium en movimiento"><source src={heroVideoUrl} /></video> : <img src="/assets/authentiq-hero-v1.png" alt="Coupé premium AUTHENTIQ recorriendo una carretera costera" className="hero-background" />}
        <div className="hero-overlay" />
        <nav className="top-nav"><span className="brand-mark">AUTHENTIQ</span><div className="top-nav-actions"><span className="nav-status">SELECCIÓN PRIVADA · 2026</span><button className="nav-admin-link" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} aria-label="Cambiar tema">{theme === "dark" ? "MODO CLARO" : "MODO OSCURO"}</button><button className="nav-admin-link account-launch" onClick={() => { setAccountOpen(true); setAccountStatus({ loading: false, error: "" }); }} aria-label="Abrir mi cuenta">{customer ? `MI CUENTA · ${customer.name.split(" ")[0].toUpperCase()}` : "MI CUENTA →"}</button><button className="nav-admin-link nav-backoffice-link" onClick={() => setScreen("admin")}>BACKOFFICE →</button></div></nav>
        <div className="hero-content">
          <span className="eyebrow">AUTHENTIQ / CURATED MOTION</span>
          <h1>Elige lo que <em>te mueve.</em></h1>
          <p>Vehículos con carácter, información clara y una atención diseñada alrededor de tu próxima historia.</p>
          <a href="#catalog" className="hero-link">Explorar catálogo ↓</a>
        </div>
        <div className="hero-proof" aria-label="Pilares de AUTHENTIQ"><span><strong>01</strong> selección con criterio</span><span><strong>100%</strong> inventario verificado</span><span><strong>1:1</strong> atención privada</span></div>
        <a className="hero-scroll-cue" href="#catalog" aria-label="Bajar al catalogo"><span /> SCROLL</a>
      </section>
      <Reveal className="showroom-signal"><div className="showroom-signal-inner"><span className="showroom-signal-label">AUTHENTIQ / PRIVATE SELECTION</span><p>No llenamos el catalogo. Seleccionamos lo que merece ser conducido.</p><a href="#catalog">Entrar a la seleccion <span>→</span></a></div></Reveal>
      <CompareDock vehicles={compareVehicles} onRemove={(id) => setCompareVehicles((current) => current.filter((item) => item.id !== id))} onClear={() => setCompareVehicles([])} />

      <section className="catalog" id="catalog">
        <div className="section-head"><div><span className="eyebrow">INVENTARIO · {vehicles.length.toString().padStart(2, "0")} MODELOS</span><h2>Catálogo activo.</h2></div><p>Datos cargados desde PostgreSQL.</p></div>
         <div className="catalog-intro-note">Una seleccion breve, pensada para decidir mejor.</div>
         <div className="filters">
          <input className="catalog-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar marca, modelo o año" aria-label="Buscar vehículos" />
          <select value={brand} onChange={(event) => setBrand(event.target.value)}><option value="all">Todas las marcas</option>{brands.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por tipo"><option value="all">Todos los tipos</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={condition} onChange={(event) => setCondition(event.target.value)} aria-label="Filtrar por condición"><option value="all">Nuevo y certificado</option>{conditions.map((item) => <option key={item} value={item}>{item === "new" ? "Nuevo" : "Certificado"}</option>)}</select>
          <select value={fuelType} onChange={(event) => setFuelType(event.target.value)} aria-label="Filtrar por combustible"><option value="all">Cualquier combustible</option>{fuelTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select value={transmission} onChange={(event) => setTransmission(event.target.value)} aria-label="Filtrar por transmisión"><option value="all">Cualquier transmisión</option>{transmissions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <input className="filter-number" type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="Precio desde" aria-label="Precio mínimo" />
          <input className="filter-number" type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="Precio hasta" aria-label="Precio máximo" />
          <input className="filter-number filter-year" type="number" min="1900" max="2100" value={minYear} onChange={(event) => setMinYear(event.target.value)} placeholder="Año desde" aria-label="Año mínimo" />
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Ordenar vehículos"><option value="newest">Más recientes</option><option value="price-low">Precio menor</option><option value="price-high">Precio mayor</option><option value="year">Año más reciente</option><option value="mileage">Menor kilometraje</option></select>
           {(search || brand !== "all" || category !== "all" || condition !== "all" || fuelType !== "all" || transmission !== "all" || minPrice || maxPrice || minYear || sort !== "newest") && <button className="clear-filters" type="button" onClick={clearFilters}>Limpiar</button>}
         </div>
         <div className="catalog-toolbar"><span>{loading ? "Consultando inventario" : `${filteredVehicles.length} de ${vehicles.length} vehiculos visibles`}</span><span className="catalog-toolbar-line" /><span>Desliza para explorar</span><button className={`favorites-filter ${favoritesOnly ? "is-active" : ""}`} type="button" onClick={() => setFavoritesOnly((current) => !current)} aria-pressed={favoritesOnly}>♡ Favoritos {favoriteIds.length ? `· ${favoriteIds.length}` : ""}</button></div>
        {loading && <p className="state-message">Cargando inventario…</p>}
        {error && <p className="state-message error">{error}. Verifica que la API esté corriendo en el puerto 3001.</p>}
        {!loading && !error && (filteredVehicles.length ? <div className="vehicle-grid">{filteredVehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} isCompared={compareVehicles.some((item) => item.id === vehicle.id)} isFavorite={favoriteIds.includes(vehicle.id)} onToggleFavorite={toggleFavorite} onToggleCompare={toggleCompare} onOpen={(item) => navigate(vehiclePath(item))} />)}</div> : <div className="catalog-empty"><h3>No encontramos vehículos con esos criterios.</h3><p>Prueba limpiando la búsqueda o seleccionando otros filtros.</p><button className="secondary-action" onClick={clearFilters}>Limpiar filtros</button></div>)}
        <CompareTable vehicles={compareVehicles} />
        <ContactForm />
        <BlogSection posts={posts} />
        <footer className="site-footer">
          {(businessSettings.phone || businessSettings.whatsapp || businessSettings.email) && <div className="site-footer-contact">{businessSettings.phone && <a href={`tel:${businessSettings.phone}`}>{businessSettings.phone}</a>}{businessSettings.whatsapp && <a href={`https://wa.me/${businessSettings.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a>}{businessSettings.email && <a href={`mailto:${businessSettings.email}`}>{businessSettings.email}</a>}</div>}
          <div><span className="brand-mark">AUTHENTIQ</span><p>Vehículos premium · inventario verificado.</p></div>
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

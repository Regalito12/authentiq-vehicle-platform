import { ArrowRight, CalendarCheck, ChartLineUp, Check, CircleNotch, ClipboardText, GlobeHemisphereWest, UsersThree } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { createElement, useEffect } from "react";
import "./DealersPage.css";

const steps = [
  { icon: ClipboardText, number: "01", title: "Publica tu inventario", body: "Fichas claras, fotos, precios y disponibilidad en un showroom que representa tu marca." },
  { icon: UsersThree, number: "02", title: "Organiza tus clientes", body: "Cada lead, nota, cita y cotización queda en el mismo lugar para que nadie se pierda." },
  { icon: CalendarCheck, number: "03", title: "Convierte el interés", body: "Da seguimiento, agenda visitas y comparte propuestas con una experiencia más cuidada." },
];

const benefits = [
  "Showroom público con tu identidad",
  "Inventario y publicación sin complicaciones",
  "Clientes, citas y cotizaciones conectados",
  "Enlace propio para compartir en redes y WhatsApp",
];

const faqs = [
  ["¿Necesito conocimientos técnicos?", "No. ZEVROA está pensado para que tu equipo pueda publicar, atender y dar seguimiento desde un panel claro."],
  ["¿Puedo usar mi propio dominio?", "Sí. Cada concesionario puede empezar con un enlace de ZEVROA y conectar su dominio propio cuando esté listo."],
  ["¿Puedo conectar Google Calendar?", "Sí. Cada dealer autoriza su propia cuenta y las citas se sincronizan sin compartir calendarios entre concesionarios."],
  ["¿Cómo empiezo?", "Solicita una demo y revisamos contigo la configuración inicial, la identidad de tu showroom y el primer inventario."],
];

function setMeta(selector, attribute, content) {
  let tag = document.querySelector(selector);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(selector.startsWith("meta[name") ? "name" : "property", attribute);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function PageMetadata() {
  useEffect(() => {
    const title = "ZEVROA para dealers · Software para concesionarios";
    const description = "Gestiona inventario, clientes, citas y cotizaciones con un showroom digital pensado para concesionarios.";
    const canonical = `${window.location.origin}/para-dealers`;
    document.title = title;
    setMeta('meta[name="description"]', "description", description);
    setMeta('meta[property="og:title"]', "og:title", title);
    setMeta('meta[property="og:description"]', "og:description", description);
    setMeta('meta[property="og:type"]', "og:type", "website");
    setMeta('meta[property="og:url"]', "og:url", canonical);
    setMeta('meta[property="og:image"]', "og:image", new URL("/assets/zevroa-hero-v1.webp", window.location.origin).href);
    setMeta('meta[name="twitter:card"]', "twitter:card", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "twitter:description", description);
    setCanonical(canonical);
    setRobots(true);
    const structured = document.createElement("script");
    structured.type = "application/ld+json";
    structured.dataset.zevroaDealersSchema = "true";
    structured.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": ["SoftwareApplication", "WebApplication"], name: "ZEVROA", url: canonical, applicationCategory: "BusinessApplication", operatingSystem: "Web", description },
        { "@type": "FAQPage", mainEntity: faqs.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })) },
      ],
    }).replace(/</g, "\\u003c");
    document.head.appendChild(structured);
    return () => structured.remove();
  }, []);
  return null;
}

function setCanonical(href) {
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
  canonical.href = href;
}

function setRobots(shouldIndex) {
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots); }
  robots.content = shouldIndex ? "index, follow" : "noindex, nofollow";
}

export default function DealersPage({ onBack, onOpenLogin, onRegister }) {
  const prefersReducedMotion = useReducedMotion();
  const reveal = (delay = 0) => ({
    initial: prefersReducedMotion ? false : { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-70px" },
    transition: { duration: prefersReducedMotion ? 0 : 0.55, delay, ease: [0.22, 1, 0.36, 1] },
  });

  return (
    <main className="dealers-page">
      <PageMetadata />
      <nav className="dealers-nav" aria-label="Navegación para concesionarios">
        <button type="button" className="dealers-brand" onClick={onBack} aria-label="Volver a ZEVROA">ZEVROA<span>°</span></button>
        <div className="dealers-nav-actions">
          <button type="button" className="dealers-nav-link" onClick={onOpenLogin}>Entrar al panel</button>
          <button type="button" className="dealers-nav-cta" onClick={onRegister}>Solicitar demo <ArrowRight weight="bold" aria-hidden="true" /></button>
        </div>
      </nav>

      <section className="dealers-hero" aria-labelledby="dealers-title">
        <div className="dealers-hero-copy">
          <motion.span className="dealers-eyebrow" {...reveal(0)}>ZEVROA · PARA CONCESIONARIOS</motion.span>
          <motion.h1 id="dealers-title" {...reveal(0.08)}>Tu concesionario,<br /><em>mejor presentado.</em></motion.h1>
          <motion.p {...reveal(0.16)}>Un showroom digital para publicar tu inventario, atender clientes y convertir cada oportunidad en un próximo paso claro.</motion.p>
          <motion.div className="dealers-hero-actions" {...reveal(0.24)}>
            <button type="button" className="dealers-primary" onClick={onRegister}>Solicitar una demo <ArrowRight weight="bold" aria-hidden="true" /></button>
            <button type="button" className="dealers-secondary" onClick={onOpenLogin}>Ya tengo un showroom</button>
          </motion.div>
          <motion.div className="dealers-hero-proof" {...reveal(0.32)}><Check weight="bold" aria-hidden="true" /><span>Inventario, clientes y seguimiento en un mismo lugar.</span></motion.div>
        </div>
        <motion.div className="dealers-hero-visual" initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: prefersReducedMotion ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }} aria-label="Vista del sistema ZEVROA">
          <div className="dealers-visual-window"><div className="dealers-window-bar"><span /><span /><span /><b>ESPACIO DE TRABAJO</b></div><div className="dealers-visual-body"><aside><strong>ZEVROA</strong><span className="is-active">Inicio</span><span>Inventario</span><span>Clientes</span><span>Citas</span></aside><div className="dealers-visual-content"><small>HOY · TU OPERACIÓN</small><h2>Todo listo para<br /><em>vender mejor.</em></h2><div className="dealers-metrics"><div><span>Leads nuevos</span><strong>12</strong><i>+24% esta semana</i></div><div><span>Citas próximas</span><strong>08</strong><i>3 requieren atención</i></div></div><div className="dealers-visual-list"><span /><span /><span /></div></div></div></div>
          <div className="dealers-visual-label"><GlobeHemisphereWest aria-hidden="true" /><span>Tu marca, tu inventario,<br />tu siguiente oportunidad.</span></div>
        </motion.div>
      </section>

      <section className="dealers-intro" aria-labelledby="dealers-intro-title"><motion.div {...reveal()}><span className="dealers-eyebrow">MENOS HERRAMIENTAS SUELTAS</span><h2 id="dealers-intro-title">Una operación más clara<br /><em>para tu equipo.</em></h2></motion.div><motion.p {...reveal(0.1)}>ZEVROA reúne lo que ocurre antes, durante y después de una visita. Así tu equipo sabe qué atender, el comprador recibe respuestas y cada vehículo tiene una historia comercial completa.</motion.p></section>

      <section className="dealers-steps" aria-labelledby="dealers-steps-title"><div className="dealers-section-heading"><span className="dealers-eyebrow">CÓMO FUNCIONA</span><h2 id="dealers-steps-title">Del inventario a la venta.</h2></div><div className="dealers-step-grid">{steps.map(({ icon, number, title, body }, index) => <motion.article className="dealers-step" key={number} {...reveal(index * 0.08)}><div className="dealers-step-top">{createElement(icon, { size: 25, weight: "light", "aria-hidden": true })}<span>{number}</span></div><h3>{title}</h3><p>{body}</p></motion.article>)}</div></section>

      <section className="dealers-benefits" aria-labelledby="dealers-benefits-title"><motion.div className="dealers-benefits-copy" {...reveal()}><span className="dealers-eyebrow">HECHO PARA EL DÍA A DÍA</span><h2 id="dealers-benefits-title">Lo importante,<br /><em>sin ruido.</em></h2><p>Una base sólida para que puedas concentrarte en vender y atender, no en perseguir información.</p><button type="button" className="dealers-text-action" onClick={onRegister}>Conocer ZEVROA <ArrowRight weight="bold" aria-hidden="true" /></button></motion.div><motion.ul className="dealers-benefit-list" {...reveal(0.1)}>{benefits.map((benefit) => <li key={benefit}><Check weight="bold" aria-hidden="true" /><span>{benefit}</span></li>)}</motion.ul></section>

      <section className="dealers-faq" id="preguntas" aria-labelledby="dealers-faq-title"><div className="dealers-section-heading"><span className="dealers-eyebrow">PREGUNTAS FRECUENTES</span><h2 id="dealers-faq-title">Antes de empezar.</h2></div><div className="dealers-faq-list">{faqs.map(([question, answer], index) => <motion.details key={question} {...reveal(index * 0.05)}><summary><span>{String(index + 1).padStart(2, "0")}</span><strong>{question}</strong><CircleNotch weight="bold" aria-hidden="true" /></summary><p>{answer}</p></motion.details>)}</div></section>

      <section className="dealers-final-cta" aria-labelledby="dealers-final-title"><motion.span className="dealers-eyebrow" {...reveal()}>EL SIGUIENTE PASO</motion.span><motion.h2 id="dealers-final-title" {...reveal(0.08)}>Haz que tu showroom<br /><em>trabaje por ti.</em></motion.h2><motion.p {...reveal(0.16)}>Cuéntanos cómo opera tu concesionario y te enseñamos qué puede ordenar ZEVROA.</motion.p><motion.button type="button" className="dealers-primary" {...reveal(0.24)} onClick={onRegister}>Solicitar demo <ArrowRight weight="bold" aria-hidden="true" /></motion.button></section>

      <footer className="dealers-footer"><button type="button" onClick={onBack}>ZEVROA<span>°</span></button><span>Software para concesionarios.</span><div><button type="button" onClick={onOpenLogin}>Entrar al panel</button><button type="button" onClick={onRegister}>Solicitar demo</button></div></footer>
    </main>
  );
}
